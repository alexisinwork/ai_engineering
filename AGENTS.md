# AGENTS.md

Umbrella repo for AI engineering work. Ten projects are git submodules with
their own repos; `PopChoice` and `OllamaPracticeMistral` live directly here.

## Setup

```bash
git clone --recurse-submodules https://github.com/alexisinwork/ai_engineering.git
# already cloned:
git submodule update --init --recursive
```

Each project installs and runs on its own -- there is no build at this level.

## Working across submodules

A submodule is a separate repository. Commit and push **inside** it first, then
record the new pointer here:

```bash
cd <project> && git add -A && git commit && git push
cd .. && git add <project> && git commit -m "Bump <project> to latest" && git push
```

Never commit a submodule pointer that has not been pushed -- it produces a
clone that cannot be fetched.

## Layout

| Path | Repo |
| --- | --- |
| `AskGenie` | `openAPI_ask_jinny` -- gift suggestions with web search |
| `PollyGlot` | `PollyGlot` -- chat translator plus AI illustrations |
| `DreamCatcher` | `dreamcatcher` -- dream journal, deployment practice on Render |
| `HuggingFaceDemo` | `hf_demo_BART` -- HF Inference API over Express |
| `TransformersJs` | `TransformrsJS` -- in-browser object detection, no token |
| `EmbeddingsAndVectorDB` | `embeds-vectors` -- RAG over two corpora |
| `AI_Agents` | `ai_agents` -- tool-calling agent, built twice |
| `Context_Engineering` | `ContextEngineering` -- context window management |
| `CustomerSupport` | `customer_support` -- Vercel AI SDK |
| `ModelContextProtocol` | `MCP` -- task-board MCP server |
| `PopChoice` | in this repo -- group film recommender |
| `OllamaPracticeMistral` | in this repo -- local Mistral via Ollama |

`PopChoice` and `EmbeddingsAndVectorDB` share one Supabase project. Read them
together: one must be able to refuse and is built around a calibrated
threshold, the other always recommends and is built around ranking.

## Nested AGENTS.md

Every project has its own `AGENTS.md`, and the nearest file to the code being
edited wins. The **Non-negotiables** block below is repeated verbatim in each
one rather than referenced, because each submodule is cloned standalone and a
reference would resolve to nothing. That duplication is deliberate; if the
block changes, change it everywhere in the same pass.

## Non-negotiables

- **Complexity and development time are not factors.** Never scope work down,
  pick a simpler approach, or skip a step because it is hard or would take
  longer. When there is a right way and a quick way, take the right way. Do not
  offer the quick way as an alternative, and do not cite effort, complexity or
  time as a reason for any decision.
- **Measure, do not guess.** Thresholds, chunk sizes, limits and model choices
  are derived from the data and the number is recorded. A guessed value that
  appears to work is the specific failure this codebase is built to prevent.
- **Evals call the real function.** Never test a copy of a code path. If a stage
  cannot be reached from Node because it reads `import.meta.env`, restructure it
  -- pass the client in as an argument -- rather than writing a second copy.
- **A prompt rule is a tendency; code is a guarantee.** Anything that must hold
  goes in code. Keep the prompt rule as well where it also shapes what the model
  *adds*, which code cannot do.
- **Failures must be visible.** Prefer a loud failure to a plausible one. An
  invented answer and a real one read identically, so silence is the dangerous
  outcome, not an error.
- **Document the failure, not just the fix.** READMEs and `THEORY.md` record
  what was tried, what it cost, and why it did not work. Do not delete that
  history when editing.

## Documentation

Every project here carries a `THEORY.md` explaining the concepts it implements,
cross-referenced with its siblings. When behaviour changes, update `THEORY.md`
and the README in the same commit as the code. Both are written to be read --
prose and tables, not bullet dumps.
