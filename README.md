# AI Engineering

Umbrella repo for my AI engineering work. Individual projects live in their own
repos and are tracked here as submodules.

## Projects

| Project | Description | Repo |
| --- | --- | --- |
| [AskGenie](AskGenie) | Gift Genie — AI gift suggestions with web search | [openAPI_ask_jinny](https://github.com/alexisinwork/openAPI_ask_jinny) |
| [PollyGlot](PollyGlot) | Chat translator — French, Spanish, Japanese, plus AI illustrations | [PollyGlot](https://github.com/alexisinwork/PollyGlot) |
| [DreamCatcher](DreamCatcher) | Dream journal with AI interpretations — a small app used to practice deploying AI apps, on Render | [dreamcatcher](https://github.com/alexisinwork/dreamcatcher) |
| [HuggingFaceDemo](HuggingFaceDemo) | Hugging Face Inference API — chat completion, text-to-image and summarization over an Express server | [hf_demo_BART](https://github.com/alexisinwork/hf_demo_BART) |
| [TransformersJs](TransformersJs) | Transformers.js object detection — runs the model in the browser, no API token | [TransformrsJS](https://github.com/alexisinwork/TransformrsJS) |
| [EmbeddingsAndVectorDB](EmbeddingsAndVectorDB) | Embeddings and vector database practice | [embeds-vectors](https://github.com/alexisinwork/embeds-vectors) |

Not yet a submodule:

| Project | Description |
| --- | --- |
| `OllamaPracticeMistral` | Express server querying a local Mistral through Ollama — local only, no remote repo yet |

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
