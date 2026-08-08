# AGENTS.md

Express server querying a local Mistral through Ollama. Lives directly in
`ai_engineering`, not in its own repo.

## Setup

```bash
ollama serve
ollama pull mistral
npm install
npm run dev
```

## Commands

| | |
| --- | --- |
| `npm run dev` | `node --watch index.js` |
| `npm start` | `node index.js` |

## Conventions

- **Needs a running Ollama daemon and a pulled model.** A connection refused on
  `localhost:11434` means `ollama serve` is not running -- report that, do not
  fall back to a hosted API.
- **The comparison with the hosted projects is the point.** Latency, quality and
  the absence of a key are what this exists to demonstrate. Keep it local.

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
