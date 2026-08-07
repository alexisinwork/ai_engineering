# AI App Engineering — Principles That Transfer

A portable distillation of what this repo learned the expensive way. It is
written to be dropped into *any* AI project as a reference, and to be read by
an agent before it writes a pipeline.

The `THEORY.md` files in this repo explain each idea against the corpus that
produced it. This file is the part that survives leaving that corpus.

**If you take one thing from this document, take §4.** An AI app you cannot
test end to end, with a quality score you can state and defend, is not a
product — its behaviour is a distribution nobody has measured, and users
experience that as randomness. Everything else here exists to make that score
trustworthy.

---

## How to read this — epistemic status

This document is written to be read by an agent that already knows the general
theory. It therefore carries three kinds of claim, and **conflating them is how
a reference like this starts causing errors instead of preventing them**:

| Label | Means | How to use it |
| --- | --- | --- |
| **MEASURED** | A number from one corpus in this repo, with the method that produced it | Copy the *method*. **Never copy the number** — it is a property of that data, not a default |
| **METHOD** | A procedure that transfers unchanged | Apply directly |
| **VERIFIED-AT** | True of a specific library version on a specific date | Re-check against the installed version before relying on it |

Two rules that follow:

**No number here is a default.** `0.68`, `chunkSize: 700`, `MATCH_THRESHOLD =
0.5` are measurements from named corpora. Reusing one as a starting value is
precisely the mistake §1 exists to prevent. If you find yourself reaching for a
figure from this document, you are using it wrong.

**This file deliberately does not re-explain general theory** — what an
embedding is, how attention degrades over long contexts, what MCP primitives
are. That knowledge is already in the model. Restating it here would add tokens
without adding information, and a slightly-off paraphrase sitting in context can
override a correct understanding. Where general background is needed, the
`THEORY.md` files in this repo carry it against a real corpus, and existing
skills carry the rest — for MCP mechanics specifically, use
`mcp-server-dev:build-mcp-server` rather than this document's §11.

---

## 0. The premise: AI code fails plausibly

Ordinary software fails loudly. A null dereference raises. A type error won't
compile. A failing test goes red.

AI pipelines have no such courtesy:

| Mistake | What you'd expect | What actually happens |
| --- | --- | --- |
| Threshold too high | error, warning | zero rows, silently |
| Threshold too low | error | irrelevant context, answered confidently |
| Chunk size too large | truncation warning | two records merge, retrieve as neither |
| Chunk size too small | error | fragment with no title, retrieves as nothing |
| Wrong corpus routed | 404 | fluent, grounded answer about the wrong thing |
| Embedding model swapped | dimension error *(if lucky)* | every stored vector now meaningless |
| Eval runs as admin | — | passes, while the real app returns nothing |
| Retrieval tool has no threshold | fallback fires | fallback is **unreachable**; every query reports "covered" |
| Prompt names a tool that isn't registered | `NoSuchTool` | the rule degrades to a suggestion, silently |
| Step budget exhausted | error | empty final answer |
| Sanitizer dependency missing | error | renders unsanitized |
| `console.log` in a stdio MCP server | log line appears | protocol stream corrupts; client disconnects citing no line of your code |
| MCP tool throws instead of `isError` | model retries | model never sees it; run ends |
| Tool annotated `readOnlyHint` but writes | — | host skips the confirmation prompt it should have shown |
| Resource template without `list`/`complete` | — | resource works, but nobody can discover its URI |

**Every row above passes code review.** The code is correct in each case; the
*number* or the *path* is wrong. This is why AI work needs a different
discipline from ordinary software, and why "it looks right" is not evidence.

**The corollary that matters most:** an LLM will produce a fluent answer from
whatever context it is given. Retrieval failures therefore do not surface as
errors — they surface as confident wrong answers, which is strictly worse than
an error, because nobody investigates them.

**Which is why §4 is the section that matters.** If failures are invisible to
inspection, the only way to know your app's quality is to measure it against
labelled data. Read §4 first if you read nothing else here; §§1–3 are how you
get a score worth having, and §§5–10 are how you keep it.

---

## 1. Every magic number is an unvalidated claim

Any numeric literal in a pipeline — similarity threshold, chunk size, top-k,
temperature, `max_tokens`, overlap — is an assertion about *your* data.
Defaults are assertions about someone else's.

**Rule: measure it against the real corpus, or state plainly that you guessed.**

The three worst offenders, in order of how often they are wrong:

1. **Similarity threshold.** Almost always copied. Almost always wrong.
2. **Chunk size.** Copied from a blog. See §3.
3. **top-k.** Rarely examined; interacts with the threshold.

### Calibration: the floor and the ceiling  *(METHOD)*

A threshold is a claim about two distributions:

- **floor** — the lowest score a query gets on the document it *should* find
- **ceiling** — the highest score anything gets on a query that should match *nothing*

A valid threshold sits strictly between them.

```
        ceiling                    floor
   ────────┼──────── gap ────────────┼────────►  similarity
        (noise)     threshold      (signal)
           lives here
```

**If floor < ceiling, no threshold exists.** Do not split the difference. The
distributions overlap, which means retrieval itself is broken — usually
chunking (§3). Picking a number inside the overlap guarantees both false
positives and false negatives, permanently.

### Calibration is a command, not a measurement  *(METHOD)*

Re-runnable, ideally wired to ingest (`postingest`) and to CI.

The reason is asymmetric drift: **the ceiling is a max over the corpus.** Every
document you add is another chance for some unrelated query to land near it, so
corpus growth can only push the ceiling *up*, never down. Meanwhile the floor
drifts down as later documents cover vaguer topics. The gap closes over time,
by itself, and nothing errors when it does — searches just begin returning
confident nonsense, or silently returning nothing.

A threshold measured once is a threshold that was correct once.

---

## 2. Measure per corpus, not per app

A threshold is a property of the *documents* as much as of the model. Longer
records score lower against a short query, because more of the vector is spent
on material the query never mentions.

**MEASURED** — from `EmbeddingsAndVectorDB`. The windows are the point; the
chosen sizes are properties of these two corpora and transfer to nothing:

| Corpus | Record length | Chunk size |
| --- | --- | --- |
| podcasts | 734–883 chars | 1000 |
| movies | 324–678 chars | 700 |

One number cannot describe both distributions. Two corpora means two
thresholds, two chunk sizes, and one config file that owns both — because
writing those facts out twice is how the halves drift apart, and a movie
searched against the podcast threshold produces no error at all.

**Design rule:** one module is the single source of truth per corpus (source
file, table, match function, chunk size, threshold, prompt nouns). Everything
downstream is generic over that entry. See `corpora.js`.

---

## 3. Chunking decides retrieval quality before retrieval runs

**METHOD.** Chunk size has to clear two bars simultaneously, and splitters that *merge*
adjacent pieces while they fit make both bars real:

```
>= longest record        or it splits mid-record, stranding a fragment
                            with no title attached — retrieves as nothing
<  two shortest combined or they merge into one chunk holding two
                            unrelated records — retrieves as neither
```

Measure your records, compute the window, pick inside it. If the window is
empty, the corpus is too heterogeneous for one chunk size — split it into two
corpora (§2).

Prefer landing **low** in the window: the failure modes are not symmetric.
Overshooting leaves a record whole and usually warns; undershooting silently
strands fragments.

### The dilution failure, measured

Embedding many topics into one vector puts that vector near the centroid of the
space — close to everything, specific to nothing.

**MEASURED** — same model and query, one corpus. Read the *ratio*, not the values:

| Setup | Best similarity |
| --- | --- |
| 1 document, 7 unrelated topics, one embedding | **0.23** |
| Same content, chunked | **0.68** |

The 0.23 case was a query taken nearly verbatim from the document's own
heading. Under a `0.3` threshold it returned **nothing at all**, for a document
that answered it perfectly.

**The tell:** a query quoting your source text still scores low. That is
dilution, not a threshold problem, and lowering the threshold to compensate
converts a silent-empty failure into a confident-wrong one.

### One record, one chunk

Where records are natural units (an FAQ entry, an episode, a film), split on
the record boundary rather than a character count. Splitting finer strands
content: a chunk holding only a quotation tells you a memorable sentence exists
but not what it belongs to.

---

## 4. The eval is the app

> **If you cannot test the pipeline end to end and state a quality score, you
> have not built a product. You have built a slot machine.**

This is the most important section in this document. Everything else is in
service of it.

In this repo the evals are **~39% of the code** in the two retrieval projects —
1,500 lines against 3,875. That ratio is the point, not an accident.

### Quality is a distribution, not a value

An AI feature does not have *a* quality. It has a distribution: same input,
different day, different model version, different temperature draw, different
answer. Manual testing samples that distribution a handful of times — and you
choose the samples, so they flatter it.

**Users do not experience your average case. Each user experiences one sample.**

And because failures come out fluent rather than loud (§0), the user cannot
tell which sample they got. There is no error message, no empty state, no
signal to distrust the answer. They get a confident paragraph and no way to
know whether it is the good one.

A pipeline that is right 70% of the time does not feel "mostly right." **It
feels random.** That is a different and much worse product experience than
being consistently limited:

| System | User's mental model | Outcome |
| --- | --- | --- |
| Reliably says "I don't know" for 30% | "It knows its limits" | trusted, used |
| Confidently wrong 30% of the time, unpredictably | "I can't tell when to believe it" | abandoned |

Users forgive limitations. They do not forgive unpredictability, because
nothing they learn about the system stays true. Trust collapses faster than
accuracy does — one memorable confident error poisons a hundred good answers,
since the user now knows the good answers looked identical.

### Without an eval you cannot improve, only change

This is the practical half, and it bites even when quality is acceptable.

Tweak the prompt. Raise the chunk size. Upgrade the model. Add a reranker. With
no score, **you cannot tell whether any of them helped.** You are performing a
random walk over your own codebase and calling it iteration.

The eval is the gradient. Without it there is no direction to move in, so
effort stops compounding — every change is a coin flip that also costs a day.
With it, every change produces a number, and the numbers accumulate into
something that only goes up.

This is also why the eval must exist *before* the tuning it is meant to guide.
An eval written after the fact tends to encode whatever the system already
does, which measures nothing.

### What counts as a score

A score is a **percentage against a labelled set, stated next to its random
baseline.**

- "It works" — not a score.
- "9 of 10 passed" — not yet a score. Against nine candidates, random guessing
  scores ~11%; against two, it scores 50%. The baseline is what makes the
  number mean anything.
- "83% top-1 on 18 labelled profiles, random baseline 11%" — a score. It can be
  defended, compared across changes, and regressed against.

An AI pipeline without an eval is a pipeline whose quality is unknown. Not
"probably fine" — *unknown*, because the failure modes in §0 are all invisible
to inspection.

### Start small rather than not at all

Ten labelled cases beat zero by an enormous margin, and the first ten usually
find something. The excuse "a proper eval is a lot of work" smuggles in the
assumption that a partial eval is worthless. It is not — it is the difference
between an unknown distribution and a roughly known one.

### Six properties of an eval that actually works

**1. It runs on the app's own path.** Same credentials, same client, same
policies. An eval running as a service role bypasses RLS and can pass while the
real app — using the anon key — returns nothing. Test the path users take.

**2. Its queries have the shape the pipeline emits.** If a condenser rewrites
user text before embedding, the eval must measure *condensed* queries. Testing
hand-written natural queries measures a shape the pipeline never produces and
inflates every score together.

**3. It is guarded against leakage, by assertion.** Do not trust yourself not
to leak the answer into the question. Two of seven test profiles in `PopChoice`
leaked, and *neither was obvious on reading*:

> "I loved Titanic for how immersive the **water** felt" → target: *The Way of the **Water***

Add a section that mechanically asserts no test input contains a word from its
target. Distinctive nationality, era, and genre labels leak the same way.

**4. Its sample size is justified.** Compute the random baseline. Seven cases
against nine candidates is an 11% random hit rate, where a single flaky result
is indistinguishable from a regression.

**5. It fails loudly with the number to paste back.** The eval that computes
the new threshold and *fails* until you record it is better than one that
prints a suggestion. A corpus with a guessed threshold looks like it works.

**6. It runs automatically.** `postingest`, CI, or both. An eval that runs when
remembered decays into documentation.

### Negatives are not optional

Half of calibration is queries that *should* return nothing. Without them you
measure only the floor and have no idea where the ceiling sits — which is to
say, no idea whether your threshold means anything.

---

## 5. Structure for testability

**Purity is a testing strategy.** Every stage that cannot be called from a test
is the stage the bugs live in. This is not a guess: in this repo, the condenser
sat outside the eval and produced three separate user-visible bugs in a row,
each found by hand, by a user.

Practical form:

- The component that decides the outcome (ranking, fusion, scoring) should be
  **pure** — no clients, no network, no I/O — so the eval calls it directly
  with hand-built inputs and zero API spend.
- Stages that need a client take it as a **parameter** rather than importing
  one, so the browser passes its client and the eval passes a Node one.
- Anything browser-only (importing a bundler-configured module) is unreachable
  from an eval. Extract the logic to a module that isn't.

**Test boundaries are the real lesson.** A pipeline where 90% is tested and the
untested 10% sits *inside* the request path has an eval that describes a
program nobody runs.

---

## 6. Fail open or fail closed, on purpose

Every gate needs a documented answer for "what happens when this stage errors
or returns garbage?"

**Fail open** (keep everything on parse failure) is usually right for a
*filter* layered over another safeguard: it degrades to the previous behavior
and costs precision, not correctness. Dropping everything on a parse hiccup
turns a good answer into "I don't have anything" and makes the app look broken
for a reason no user can see.

**Fail closed** is right when there is no second layer, or when a wrong answer
is more costly than no answer.

**The test is "what is behind this gate", not "how bad does failing look".** A
relevance filter has retrieval behind it, so failing open costs precision. A
sanitizer has nothing behind it, so failing open costs correctness — and the
failure is invisible, because unsanitized output renders exactly like sanitized
output until the day it doesn't.

The version of this that actually ships looks like a missing dependency, not a
decision:

```js
// Fails open on the last line of defence. The warning is not a safeguard.
if (typeof DOMPurify !== 'undefined') el.innerHTML = DOMPurify.sanitize(html);
else { console.warn('DOMPurify not loaded'); el.innerHTML = html; }
```

A guard whose `else` branch does the unguarded thing is not a guard. If the
dependency is absent, refuse to render — and note that model output is exactly
the case where this matters, since with web search or any retrieval in the
catalogue, that string contains text from outside your process.

Supporting choices for LLM-as-judge stages: `temperature: 0` (a judgement that
varies between identical inputs is the hardest thing in the pipeline to debug)
and a `max_tokens` tight enough that a model writing prose gets truncated onto
the fail path rather than being parsed as a verdict.

---

## 7. Two shapes of retrieval problem

Decide which you have **before building**, because most advice silently assumes
the first.

| | Question answering | Recommendation |
| --- | --- | --- |
| A correct empty answer | yes — "nothing about X" | never |
| Central mechanism | a calibrated **threshold** | **ranking** |
| Failure mode | confident answer about nothing | a bad item at the top |
| Eval measures | where the floor sits | what order things come in |

**The tell:** ask what should happen for a query the corpus cannot serve. "Say
so" → you need calibration. "Give the least bad option" → you need ranking. A
threshold has nothing to do in a system that must always answer.

### Fuse rankings, don't average embeddings

To combine several inputs (multiple users, multiple queries), rank each
separately and fuse the *positions* — Reciprocal Rank Fusion, `1/(k + rank)`.

Averaging the embeddings fails for the §3 reason: a vector averaging five
tastes lands near the centre of the space and close to nothing in particular.
Five people who like horror, musicals, documentaries, Bollywood and animation
do not average into a person who likes anything.

Fusion also sidesteps a subtler problem: **cosine similarities are not
comparable across queries.** One person's enthusiastic 0.44 and another's
lukewarm 0.31 are not on the same scale. "First" and "third" always are.

---

## 8. Context is a budget, not a container

Full treatment in `Context_Engineering/THEORY.md`. The transferable core:

**Model accuracy degrades long before the window fills, and non-uniformly** —
the middle degrades first. A model advertising 1M tokens is telling you what it
will *accept*, not what it will reason over. Filling the window because it is
there is the most common context mistake and is invisible in testing, because
nothing errors.

**Ranked best to worst:**

1. **Don't admit junk** — tool output offloading. One large file paste costs
   more than fifty turns of dialogue.
2. **External durable state** — constraints and decisions written to a file the
   agent re-reads. The only technique here that survives compaction.
3. **Retrieval over history** — lossless archive, selective recall.
4. **Sub-agent isolation** — map-reduce over context; the main thread never
   sees the raw tokens.
5. **Compaction** — only when the window is genuinely full.
6. **Sliding window** — compaction with a summarizer that returns the empty
   string.

The top four don't discard anything; they *relocate* it. That is the insight:
the best way to keep a long context is to stop keeping it in context.

**Compaction eats constraints.** A prohibition stated once at turn 3 reads as
low-salience next to forty turns of activity, so summarizers drop it — and the
agent proceeds without a rule it no longer knows it had. Extract constraints to
durable state *continuously*, not at compaction time, when the window is full
and old material is a wall of text.

**Cache economics:** appending is cheap, editing history is not. The KV cache
is valid up to the first changed token. So compact rarely and in large chunks,
order the prompt most-stable-first, and never put a timestamp at the top of a
system prompt.

---

## 9. Operational hygiene

Cheap to do early, painful to retrofit:

- **One API key per project.** A shared key means a leak forces rotation
  everywhere and makes per-project spend unattributable.
- **Never let a privileged key reach a browser bundle.** Bundler prefixes
  (`VITE_`, `NEXT_PUBLIC_`) are a *promise to publish*. A service-role key
  bypasses RLS; it must have no prefix and never be imported client-side.
- **Enable RLS on every table.** Without it, a table in an exposed schema is
  readable *and writable* by anyone holding the publishable key. For a RAG
  corpus that means anyone can insert text your agent will later retrieve and
  repeat as fact — retrieval poisoning through a database default.
- **Return projections, not rows.** A match function returning
  `(id, content, similarity)` keeps the 1536-float embedding off the wire.
- **Cap what a caller can pull.** `limit least(match_count, 200)`.
- **Pin `search_path` on database functions**, and prefer `SECURITY INVOKER` so
  RLS still applies.
- **Ordering must use the indexable form.** `order by embedding <=> query asc`
  uses the HNSW index; `order by 1 - distance desc` does not, and silently
  degrades to a sequential scan and sort.

---

## 10. When retrieval becomes a tool

The same feature has two architectures, and most retrieval advice silently
assumes the first:

| | Pipeline | Agent loop |
| --- | --- | --- |
| Routing | a classifier, then a branch | the model's tool choice |
| Decides | before retrieval runs | after every result |
| Adding a capability | another branch | another entry in `tools` |
| Retrieval is | a stage | a tool with a schema and a return value |

The loop is usually the better default — a classifier commits before it has
evidence, and a misroute is §0's worst row while a wrong tool call is visible in
the trace. But moving retrieval inside a tool changes four things that carry
over from §§1–7, and each one fails plausibly.

### The threshold stops being only a quality filter

In a pipeline, a missing threshold degrades answers. In a loop it also deletes
the signal that would make the model try something else.

> **A retrieval tool must be able to say nothing. `top_k` without a threshold
> cannot.** A nearest-neighbour search asked for *n* rows returns *n* rows
> however far away they are, so the tool reports "covered" on every query — and
> every fallback behind it becomes unreachable.

Unreachable in the worst way: the fallback code exists, reads correctly, passes
review, and never executes. The system prompt says *search the web when the
knowledge base has nothing*; the knowledge base is structurally incapable of
reporting that it has nothing. Nothing errors, and the visible symptom is an
answer to a question the corpus never covered, written from its three nearest
unrelated chunks.

This is the sharpest practical argument for §1. Calibration is not hygiene here
— it is the control flow.

### Return values are addressed to the model

A tool's return value is a message to a reader that can act on it, which makes
`null` a wasted turn:

```js
return [];                                          // the model learns nothing
return { matches: [], note: 'nothing above 0.42' }; // the model can route on this
throw new Error('400');                             // ends the run, or is fed back as noise
return { error: 'lat/long must be numbers. Call getLocation first.' };  // actionable
```

Same rule for both: write it for the model, not for a log.

### Tool names in prompts are references with no compiler

When the disambiguation between overlapping tools lives in the system prompt
rather than in the tool descriptions — a legitimate choice, and cheaper per step
— the prompt acquires identifiers that nothing validates. A name that drifts
from the registered key degrades that rule into a suggestion, and leaves the
correctly-named tool arguing unopposed.

**Interpolate `Object.keys(tools)` into the prompt, or assert the overlap in the
eval.** Three lines, and it is the only class of prompt bug that is mechanically
checkable.

### "Which tool ran" stops being one lookup

Provider-executed tools — hosted web search, code interpreters, anything the
provider runs on its own side — are not tools in the schema sense. You do not
write their input schema, their name, or their failure text.

| | your tool | provider tool |
| --- | --- | --- |
| Where results arrive | the step's tool results | often a separate top-level field |
| Instrumentable | fully | no logging, no threshold, no output offloading (§8) |
| Portability | change the model string | rewrite |

Two consequences worth deciding rather than discovering: a catalogue mixing both
is only half portable, and provenance reporting needs two lookups whose results
can disagree. If a UI claims to show which source answered — and §4 says it
should — that claim is only as honest as the weaker lookup.

### What the eval asserts changes

Not answer quality: **first tool choice**, against labelled messages. The
baseline is the larger of uniform (`1 / (tools + 1)`, counting "answer
directly") and the majority class. Three capabilities means a 33% floor — high
enough to clear by accident, low enough that clearing it proves little.

Include messages the corpus cannot serve. They are the only ones that measure
whether the empty path works, and they are exactly the ones a thresholdless tool
fails silently.

### A step budget is a correctness parameter

A tool call ends a generation, so a ceiling too low surfaces as an **empty final
answer**, not an error — the loop spent its last step calling a tool and never
got a turn to write prose. Placeholder text ("I used the search tool but didn't
generate a summary") converts a tunable bug into a permanent one. Budget for
*n* tool calls plus one.

---

## 11. Exposing tools over MCP

**Use `mcp-server-dev:build-mcp-server` for the mechanics** — primitives,
annotation semantics, transports, Inspector usage, deployment models. It covers
those well and this section does not repeat them.

What that guidance does not carry, and what cost real debugging time here:

**1. `stdout` is the protocol on stdio.** One `console.log` — yours or a
dependency's — corrupts the stream, and the client disconnects with a parse
error naming no line of your code. Every diagnostic goes to stderr. Over HTTP
the rule does not apply, which is one reason remote is the default for anything
not required to be local.

**2. Assert annotations in a test.** `readOnlyHint`, `destructiveHint`,
`idempotentHint` change host behaviour — whether it prompts for confirmation,
whether a retry after a timeout is safe — and **no return value reveals them**.
A write tool marked read-only silently skips its approval dialog. A test that
reads the flags back is the only place that mistake is visible.

**3. Test with a programmatic client, not only the Inspector.** Spawn the server
over its real transport with the SDK's own `Client` and assert. Not a mock — the
same transport, schemas, and handlers a host uses, with no API key and no model,
so it runs in a second. The Inspector is for looking; it shows one call at a
time and relies on you noticing. Assert what ordinary use never exercises:
annotations, `structuredContent` against `outputSchema`, the empty case, and
`isError` on bad input.

**Two framings worth keeping**, because they decide designs rather than describe
APIs:

- **Resource vs tool is a question about who decides**, not data versus action —
  all three primitives can return the same bytes. Resource = the application
  loads it whether or not the model asks. Tool = the model chooses, and when it
  doesn't choose you get a confident ungrounded answer with no tool call in the
  trace to explain why.
- **Errors have two channels and they are not interchangeable.** A throw is a
  protocol error the host sees and the model does not, so the run ends with no
  chance to recover. `isError: true` puts the text in front of the model, which
  reads it and retries. Protocol errors are for your bugs; `isError` is for the
  caller's mistakes.

**VERIFIED-AT** — SDK `1.30.0`, 2026-08-07: schema violations are returned as
`isError` results, not thrown. That was contrary to expectation and is the
better design, but re-check it against the installed version rather than relying
on this line. A correct server and a correct agent remain separate claims.

Worked implementation: `ModelContextProtocol/` — server, host, and a 27-assertion
protocol test. Its `THEORY.md` carries the full reasoning.

## 12. Checklist before calling an AI pipeline done

**The gate:** can you state a quality score, end to end, against labelled data,
next to its random baseline? If not, the remaining boxes do not matter — you
cannot claim the pipeline works, only that it ran.

- [ ] **A labelled set exists, and the pipeline scores against it end to end**
- [ ] **That score is stated with its random baseline**, and recorded so the
      next change can be compared against it
- [ ] Ran end to end against the real store, using the app's own client
- [ ] Printed **scores**, not verdicts
- [ ] Included at least one query the corpus cannot answer
- [ ] Floor and ceiling measured; threshold sits strictly between
- [ ] Chunk size derived from measured record lengths
- [ ] Eval uses the app's credentials and the pipeline's query shape
- [ ] Eval asserts against leakage; sample size beats the random baseline
- [ ] Eval runs automatically (postingest / CI)
- [ ] Every gate has a documented fail-open or fail-closed decision, and the
      last line of defence fails closed
- [ ] RLS on, privileged keys unprefixed and server-side only
- [ ] Numbers reported in the summary, not the word "working"

If retrieval is a tool rather than a stage (§10):

- [ ] The retrieval tool **can return empty** — a threshold, not just `top_k`
- [ ] Every fallback path has been reached at least once in a test
- [ ] Tool names in prompts come from `Object.keys(tools)`, or the eval checks
- [ ] Tool choice is scored against labelled messages, with its baseline stated
- [ ] Step budget covers the expected tool calls **plus one** for the answer
- [ ] Provenance reporting handles the case where two tools ran
- [ ] Which half of the tool catalogue is provider-locked is written down

If the tools are exposed over MCP (§11):

- [ ] Nothing writes to stdout on a stdio server — dependencies included
- [ ] Caller mistakes return `isError`; only real bugs throw
- [ ] Annotations set on every tool, and **asserted in a test**
- [ ] Resource templates declare `list` and `complete`, or the URI is undiscoverable
- [ ] A programmatic client test runs the real transport, not a mock
- [ ] Chose resource vs tool by *who decides*, not by data vs action

---

## Reference implementations in this repo

| Idea | File |
| --- | --- |
| Calibration, eval structure, router assertions | `EmbeddingsAndVectorDB/eval.js` |
| Single source of truth per corpus; chunk windows | `EmbeddingsAndVectorDB/corpora.js` |
| Chunking decisions | `EmbeddingsAndVectorDB/chunk.js` |
| MCP server: all three primitives, annotations | `ModelContextProtocol/server.js` |
| MCP protocol-level test, Inspector usage | `ModelContextProtocol/test.js`, its `README.md` |
| MCP host: tool loop and the four-line adapter | `ModelContextProtocol/client.js` |
| Relevance gate, fail-open | `EmbeddingsAndVectorDB/relevance.js` |
| Query condensation and its failure modes | `EmbeddingsAndVectorDB/condense.js` |
| Rank fusion, purity for testability | `PopChoice/rank.js` |
| Leakage assertions, sample size | `PopChoice/eval.js` |
| Retrieval as a tool, and the unreachable fallback (§10) | `CustomerSupport/tools/knowledgeBaseTool.js` |
| Pipeline and loop, same feature, side by side (§10) | `CustomerSupport/LearningPhase/agenticRetrieval.js` vs `CustomerSupport/webSearchRetrievalAgent.js` |
| Overlapping tools disambiguated in the prompt (§10) | `CustomerSupport/prompts.js` |
| Context management | `Context_Engineering/THEORY.md` |
| Retrieval theory, calibration in depth | `EmbeddingsAndVectorDB/THEORY.md` |
| Tool calling end to end; the whole-app shape | `CustomerSupport/THEORY.md` |

> Two of the `CustomerSupport` rows are **worked negative examples** — the
> knowledge-base tool has no threshold and `prompts.js` names a tool that is not
> in the catalogue. Both are described in that project's `THEORY.md` §11. They
> earn their place here because they are what these failures look like in code
> that reads correctly.
