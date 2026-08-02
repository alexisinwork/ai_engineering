# Theory — Local Inference, and How It Compares to Everything Else

This app is ~25 lines: an Express route that forwards `?question=` to a Mistral
model running on your own machine through Ollama. The code is small; the ideas
underneath it are the ones that decide how every AI feature you build gets
served. This file covers what Ollama is, and then the comparison the rest of
this repo keeps bumping into — **local vs. self-hosted serving vs. inference
providers vs. routers vs. first-party model APIs.**

---

## 1. What Ollama is

Ollama is a local model runner. It downloads model weights to your disk, loads
them into RAM or VRAM, and exposes them over a small HTTP API on
`localhost:11434`. There is no network call to anyone's GPU, no API key, and no
per-token bill.

```
ollama pull mistral      # download weights (~4 GB) into ~/.ollama
ollama run mistral       # interactive REPL
ollama serve             # background HTTP daemon (usually already running)
```

`index.js` talks to that daemon through the `ollama` npm package:

```js
const response = await ollama.chat({
  model: 'mistral',
  messages: [{ role: 'user', content: question }],
});
```

The `messages` array with `role`/`content` is the same shape you send to
OpenAI or Hugging Face — this convention has become the de-facto standard
across the whole ecosystem. Ollama also exposes an OpenAI-compatible endpoint
at `http://localhost:11434/v1`, so you can point the `openai` SDK at it by
setting `baseURL` and passing any non-empty string as the key. That is worth
knowing: it means swapping a cloud provider for a local model can be a
one-line config change, which is exactly what the `AI_URL` environment
variable does in the AskGenie, PollyGlot, and DreamCatcher projects in this
repo.

### What's under the hood

Ollama is a friendly wrapper around **llama.cpp**, a C++ inference engine
written to run transformer models efficiently on CPUs and consumer GPUs. Two
concepts come with it:

**GGUF** is the file format llama.cpp uses. A single file containing the
weights, the tokenizer, and the metadata needed to run the model. Contrast
with `safetensors`, the Hugging Face format, which stores weights only and
expects a Python library to supply everything else. GGUF is designed for
"download one file, run it."

**Quantization** is the reason a 7-billion-parameter model fits on a laptop.
Trained weights are typically 16-bit floats — 7B parameters × 2 bytes ≈ 14 GB,
before you count the memory needed for the conversation itself. Quantization
stores each weight in fewer bits:

| Precision | Bytes/param | ~Size of a 7B model | Quality |
| --- | --- | --- | --- |
| FP16 | 2 | ~14 GB | Reference |
| Q8_0 (8-bit) | 1 | ~7 GB | Nearly indistinguishable |
| Q4_K_M (4-bit) | ~0.5 | ~4 GB | Slightly degraded, usually fine |
| Q2 (2-bit) | ~0.25 | ~2.5 GB | Noticeably worse |

Ollama's default tags are 4-bit builds, which is the sweet spot for consumer
hardware — run `ollama show mistral` to see exactly which quantization and
context length you pulled. The trade is real but small: 4-bit models are
measurably worse on hard reasoning, and mostly fine for summarizing, drafting,
and Q&A.

**Mistral 7B** itself is an open-weights model released under Apache 2.0 by
Mistral AI. "Open weights" means you can download and run it; it does not mean
the training data or training code is public. It uses grouped-query attention
and sliding-window attention to keep memory use down, which is part of why it
punches above its size class.

### What "local" actually buys you

- **Privacy.** The prompt never leaves the machine. For medical, legal, or
  internal-document work, this is often the deciding factor.
- **Zero marginal cost.** After the electricity, the ten-thousandth request
  costs the same as the first: nothing.
- **No rate limits, no outages, no deprecations.** The model on your disk will
  behave identically next year. Nothing in this repo's cloud projects can
  promise that — see the `410 deprecated` note in `../HuggingFaceDemo`.
- **Offline.** Works on a plane.

### What it costs you

- **Capability.** A 4-bit 7B model is not in the same league as a frontier
  model. It is genuinely useful for classification, extraction, summarization,
  and simple chat; it is not the tool for multi-step reasoning or agentic
  coding.
- **Throughput.** Ollama serves requests essentially one at a time. It is built
  for one developer at a laptop, not for concurrent users.
- **Cold starts.** The first request after idle loads gigabytes into memory.
- **Ops.** "It works on my machine" becomes literal. Shipping this to users
  means shipping GPUs.

That throughput ceiling is why `index.js` has the `try/catch` it does — Express
4 does not catch rejections from async handlers, so an unreachable or
still-loading Ollama would otherwise hang the request until the client gives
up.

---

## 2. The five ways to run a model

Every AI feature is served through one of these. They differ on who owns the
weights, who owns the GPU, and who owns the bill.

| | Who runs the GPU | Who owns the weights | Billing | Examples |
| --- | --- | --- | --- | --- |
| **1. Local runner** | You (your laptop) | Open weights, on your disk | Electricity | Ollama, LM Studio, llama.cpp |
| **2. Self-hosted serving** | You (your cloud GPUs) | Open weights, on your disk | GPU-hours | vLLM, TGI, SGLang, TensorRT-LLM |
| **3. Inference provider** | A vendor | Open weights, theirs to host | Per token | Together, Fireworks, Replicate, HF Inference Providers, Groq |
| **4. Router / aggregator** | Someone else's vendor | Whoever's | Per token + margin | OpenRouter |
| **5. First-party model API** | The model's creator | Closed, never leave their servers | Per token | Anthropic, OpenAI, Google |

### 1. Local runner — Ollama

Covered above. One user, one machine, open weights, no bill.

### 2. Self-hosted serving — vLLM and friends

This is the category people mean by "we run our own models in production," and
it is the one most often confused with Ollama. Both run open weights on
hardware you control. The difference is what they are optimized for.

Ollama optimizes for **one user's convenience**. vLLM optimizes for
**throughput across many concurrent users**, using two techniques worth
knowing by name:

- **Continuous batching.** Naive serving waits for a batch of requests, runs
  them together, and waits for the slowest to finish. vLLM swaps finished
  sequences out and new ones in every step, so the GPU never idles waiting on
  one long generation.
- **PagedAttention.** The KV cache — the model's memory of the conversation so
  far — is the real memory hog in serving. vLLM manages it in fixed-size pages
  like an OS manages virtual memory, instead of pre-allocating a worst-case
  contiguous block per request. Far less waste, so far more concurrent
  sequences fit on one GPU.

The practical outcome: on the same GPU, vLLM serves an order of magnitude more
concurrent users than a naive loop. It also wants unquantized or lightly
quantized `safetensors` weights and a real datacenter GPU — it is not a laptop
tool.

**Rule of thumb:** Ollama for development and single-user local apps; vLLM (or
TGI/SGLang) when open-weight models need to serve real traffic; neither if you
do not want to own GPU capacity planning.

### 3. Inference providers

Vendors who host open-weight models and sell you tokens. You get the open-model
menu without owning GPUs. This is what `../HuggingFaceDemo` uses — and note
that Hugging Face's Inference Providers is itself a *router* across several of
these vendors, which is why that project's `provider:` parameter exists.

The trade: no infrastructure, but you inherit their uptime, their pricing, and
their deprecation schedule. The same weights served by two providers can differ
in speed, in quantization, and even in output formatting — the magic-number
sniffing in `../HuggingFaceDemo/fetchImage.js` exists because one provider
mislabels its image bytes.

### 4. Routers / aggregators — OpenRouter

A router sits *in front of* many providers and first-party APIs and exposes one
OpenAI-compatible endpoint over all of them. You change a model string, not an
SDK, to move between vendors. Useful for price/latency comparison, for
fallback when one provider is down, and for consolidating billing.

**A router is not a provider.** It does not own weights or GPUs — it forwards
your request to whoever actually serves that model and takes a margin. That
means an extra network hop, an extra party seeing your prompts, and pricing and
availability that ultimately track the upstream vendor. Convenience layer,
not a capability layer.

### 5. First-party model APIs — Anthropic, OpenAI, Google

The model's creator serves it directly. The weights are **closed**: they are
never distributed, and there is no local or self-hosted option.

This is the distinction the user of this repo keeps running into: **Anthropic
sells access to Claude, not Claude.** There is no `ollama pull claude`. The
same is true of GPT-5 and Gemini. What you buy is API access to a model running
on the vendor's infrastructure.

What you get for that:

- **Frontier capability.** These are, as of now, the strongest models
  available, and they are not available any other way.
- **Managed everything.** Scaling, uptime, safety systems, and continual model
  improvements you get without redeploying.
- **Deep platform features** that only make sense when the vendor controls the
  serving stack — server-side tool use, prompt caching, batch APIs, long-lived
  agent sessions.

What you give up: weights portability, offline operation, and full control over
your data path (though enterprise agreements and zero-retention modes address
much of the last one).

Current Anthropic models and list pricing, per million tokens (input/output):

| Model | ID | Context | Input | Output |
| --- | --- | --- | --- | --- |
| Claude Fable 5 | `claude-fable-5` | 1M | $10 | $50 |
| Claude Opus 5 | `claude-opus-5` | 1M | $5 | $25 |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | $3 | $15 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1 | $5 |

(Sonnet 5 has introductory pricing of $2/$10 through 2026-08-31.)

One wrinkle worth knowing, because it looks like the "router" category but is
not: Claude is also available through **Amazon Bedrock, Google Vertex AI, and
Microsoft Foundry**. Those are partner-operated distribution channels — same
models, different billing relationship, occasionally a lagging feature set and
a prefixed model ID (`anthropic.claude-opus-5` on Bedrock). Anthropic still
owns the weights; you are choosing a procurement path, not a different provider.

---

## 3. How to choose

Work down this list and stop at the first line that applies:

1. **Data cannot leave the building** → local (Ollama) or self-hosted (vLLM),
   in a network you control. This constraint outranks capability.
2. **The task is simple and the volume is enormous** — classification, tagging,
   extraction, cheap summarization → open weights on vLLM, or a small hosted
   model. Per-token pricing on a frontier model is the wrong tool for
   labelling ten million records.
3. **The task needs the best available reasoning** — agentic coding, complex
   multi-step analysis, long-horizon autonomy → first-party frontier API.
   Nothing you can self-host is close, and the token cost is almost always
   less than the engineer-hours saved.
4. **You are prototyping** → whatever has the shortest path to a working
   response. Usually a hosted API; sometimes Ollama, if you want to iterate on
   a plane without a bill.
5. **You need many models cheaply compared** → a router, at least during
   evaluation.

Two things that keep this decision cheap to revisit:

- **Program against the OpenAI-compatible shape.** Ollama, vLLM, most
  providers, and every router speak it. The `AI_URL` / `AI_MODEL` /
  `AI_KEY` triple used across this repo's other projects is exactly this idea:
  the provider is configuration, not code.
- **Isolate the model call.** `DreamCatcher` keeps its provider behind
  `utils/ai-openai.js` and `utils/ai-gemini.js` with an identical exported
  function, so switching vendors touches one file.

The caveat: OpenAI compatibility is a *lowest common denominator*. Anything
distinctive — Anthropic's extended thinking and prompt caching, a provider's
custom sampling parameters — is not in that shape. Portability and depth pull
in opposite directions, and picking a spot on that line is a real architectural
decision rather than a detail.

---

## 4. Reading this app's code with all that in mind

```js
app.get('/', async (req, res) => {
  const question = req.query.question;
  ...
  const response = await ollama.chat({
    model: 'mistral',
    messages: [{ role: 'user', content: question }],
  });
  res.status(200).send(response.message.content);
});
```

Three things this deliberately does not do, each of which is a real concept:

- **No system message.** Only a `user` role is sent, so the model has no
  persona or task framing. Compare `../HuggingFaceDemo/chatCompletion.js`,
  where a `system` message does the work.
- **No conversation history.** Every request is independent. LLM APIs are
  stateless — memory exists only because the client resends the transcript.
- **No streaming.** The request blocks until the full answer is generated. A
  7B model on CPU can take many seconds, which is why the cloud projects in
  this repo stream tokens over Server-Sent Events instead. Ollama supports
  `stream: true` and yields an async iterable of chunks.

Each of those is a one-line change, and each is a good next exercise.

---

## 5. Related reading in this repo

- `../HuggingFaceDemo/THEORY.md` — inference providers, model tasks, and the
  encoder/decoder/diffusion architecture split.
- `../TransformersJs/THEORY.md` — a sixth option: running the model in the
  user's browser.
- `../EmbeddingsAndVectorDB/THEORY.md` — where a small local model earns its
  keep, as the embedding step in a retrieval pipeline.
