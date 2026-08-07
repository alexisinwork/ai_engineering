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
get a score worth having, and §§5–9 are how you keep it.

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

### Calibration: the floor and the ceiling

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

### Calibration is a command, not a measurement

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

Worked example from `EmbeddingsAndVectorDB`:

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

Chunk size has to clear two bars simultaneously, and splitters that *merge*
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

From this repo, same document, same model, same query:

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

## 10. Checklist before calling an AI pipeline done

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
- [ ] Every gate has a documented fail-open or fail-closed decision
- [ ] RLS on, privileged keys unprefixed and server-side only
- [ ] Numbers reported in the summary, not the word "working"

---

## Reference implementations in this repo

| Idea | File |
| --- | --- |
| Calibration, eval structure, router assertions | `EmbeddingsAndVectorDB/eval.js` |
| Single source of truth per corpus; chunk windows | `EmbeddingsAndVectorDB/corpora.js` |
| Chunking decisions | `EmbeddingsAndVectorDB/chunk.js` |
| Relevance gate, fail-open | `EmbeddingsAndVectorDB/relevance.js` |
| Query condensation and its failure modes | `EmbeddingsAndVectorDB/condense.js` |
| Rank fusion, purity for testability | `PopChoice/rank.js` |
| Leakage assertions, sample size | `PopChoice/eval.js` |
| Context management | `Context_Engineering/THEORY.md` |
| Retrieval theory, calibration in depth | `EmbeddingsAndVectorDB/THEORY.md` |
