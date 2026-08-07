# AI Engineering

Umbrella repo for my AI engineering work. Individual projects live in their own
repos and are tracked here as submodules.

Every project carries a `THEORY.md` explaining the concepts it implements —
inference providers and model architectures, tool use and streaming, reasoning
tokens and prompt injection, on-device inference, embeddings and retrieval,
rank fusion and group recommendation, and how local models compare to hosted
APIs. They cross-reference each other, so any one of them is a reasonable place
to start.

## Projects

| Project | Description | Repo |
| --- | --- | --- |
| [AskGenie](AskGenie) | Gift Genie — AI gift suggestions with web search | [openAPI_ask_jinny](https://github.com/alexisinwork/openAPI_ask_jinny) |
| [PollyGlot](PollyGlot) | Chat translator — French, Spanish, Japanese, plus AI illustrations | [PollyGlot](https://github.com/alexisinwork/PollyGlot) |
| [DreamCatcher](DreamCatcher) | Dream journal with AI interpretations — a small app used to practice deploying AI apps, on Render | [dreamcatcher](https://github.com/alexisinwork/dreamcatcher) |
| [HuggingFaceDemo](HuggingFaceDemo) | Hugging Face Inference API — chat completion, text-to-image and summarization over an Express server | [hf_demo_BART](https://github.com/alexisinwork/hf_demo_BART) |
| [TransformersJs](TransformersJs) | Transformers.js object detection — runs the model in the browser, no API token | [TransformrsJS](https://github.com/alexisinwork/TransformrsJS) |
| [EmbeddingsAndVectorDB](EmbeddingsAndVectorDB) | Semantic search and RAG chat over two corpora — routing, calibration, and a relevance gate | [embeds-vectors](https://github.com/alexisinwork/embeds-vectors) |
| [PopChoice](PopChoice) | Group film recommender — everyone answers four questions, rank fusion picks one film | in this repo |
| [OllamaPracticeMistral](OllamaPracticeMistral) | Express server querying a local Mistral through Ollama | in this repo |
| [AI_Agents](AI_Agents) | AI agents practice — weather lookup and localized activity suggestions | [ai_agents](https://github.com/alexisinwork/ai_agents) |
| [Context_Engineering](Context_Engineering) | Context engineering practice — how what goes into the window shapes what comes back | [ContextEngineering](https://github.com/alexisinwork/ContextEngineering) |
| [CustomerSupport](CustomerSupport) | AI customer support — scaffolding only so far | [customer_support](https://github.com/alexisinwork/customer_support) |

`PopChoice` and `OllamaPracticeMistral` live directly in this repo rather than
in their own — no submodule, nothing to clone separately.

`PopChoice` shares a Supabase project with `EmbeddingsAndVectorDB`, adding its
own table and match function rather than a second database. The two are
otherwise independent, and the pair is worth reading together: one has to be
able to refuse and so is built around a calibrated threshold, while the other
always recommends and so is built around ranking. The same vector store, two
different questions, two different shapes of eval.

## Cloning

Submodules are not fetched by default:

```bash
git clone --recurse-submodules https://github.com/alexisinwork/ai_engineering.git
```

If you already cloned without it:

```bash
git submodule update --init --recursive
```

## Updating a submodule pointer

After committing and pushing inside a project, record the new commit here:

```bash
git add <project>
git commit -m "Bump <project> to latest"
git push
```
