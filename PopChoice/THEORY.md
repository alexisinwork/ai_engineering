# Theory — Ranking, Rank Fusion, and Group Recommendation

> **Note on scope:** this is the companion to `../EmbeddingsAndVectorDB/THEORY.md`
> and deliberately does not repeat it. What an embedding *is*, how cosine
> similarity works, what an HNSW index does, how chunking is decided — all of
> that is there, and sections 1–4 of that document are the prerequisite for this
> one. What is here is what PopChoice needed and that project did not: the
> difference between a system that must be able to refuse and one that must
> always rank, what happens when several people want different things, and how
> to evaluate a recommender without fooling yourself.
>
> Sections 1–7 are general. Section 8 is this specific app, decision by
> decision.

---

## 1. Two shapes of retrieval problem

The sibling project and this one sit on the same vector store, use the same
embedding model, and are almost nothing alike. The difference is one question:
**must the system be able to say no?**

| | `EmbeddingsAndVectorDB` | PopChoice |
| --- | --- | --- |
| The question | "What do you have about X?" | "What should we watch?" |
| A correct empty answer | yes — "nothing about X" | never |
| Central number | a similarity **threshold** | none |
| What can go wrong | a confident answer about nothing | a bad film at the top |
| What the eval measures | where the floor sits | what order things come in |

A question-answering system has a **precision** problem. Given a query with no
answer in the corpus, retrieval will still return the nearest rows — near is
relative, and something is always nearest. The system needs a floor below which
it refuses, and finding that floor is most of the work. That project has a whole
section on the fact that no such floor may exist.

A recommender has a **ranking** problem. There is no query without an answer:
the user wants a film, there are nine films, and one of them is going to be the
best available. Nothing needs rejecting, so a threshold has nothing to do.
Everything depends on the order.

This is not a small distinction and it propagates everywhere. It decides what
the eval measures, what the failure modes look like, and whether a "relevance
gate" is a safety feature or an obstacle. **Work out which shape you have before
building anything**, because most retrieval advice online silently assumes the
first shape.

### The tell

Ask what should happen for a query the corpus cannot serve. If the honest answer
is "say so", you need calibration. If the honest answer is "give them the least
bad option", you need ranking. If it is "say so *and* offer the least bad
option", you need both, and they are separate mechanisms rather than one
threshold doing double duty.

---

## 2. Not every signal belongs in a vector

PopChoice asks four questions. Two produce free text, two produce facts, and
putting all four through the embedding model would be the obvious mistake.

```
favourite film & why    →  embedding    "what kind of thing do they like"
mood (Fun/Serious/…)    →  embedding    a genuine semantic modifier
New or Classic          →  a number     release year
how much time           →  a number     runtime in minutes
```

**Why not embed "classic".** The word would go into a vector and be compared
against film descriptions. That searches for films whose *prose sounds classic*
— which is a different question from "released earlier", and one the corpus
cannot answer, because the description of a 2022 film does not say it is old. A
structured fact compared with `<=` gives the right answer every time and costs
nothing.

The general rule: **embed what is fuzzy, filter what is crisp.** A vector is a
compression of meaning, and it is very good at "things like this" and very bad
at "before 2010", "under 100 minutes", "not by this director", "in stock". Those
are comparisons over values, and a database already does comparisons over values
perfectly.

This is the same family as the caution in `../EmbeddingsAndVectorDB/THEORY.md`
§2 that embeddings capture aboutness rather than negation or precise conditions.
The corollary is architectural: **anything you can express as a column, express
as a column.**

### Where it gets subtle

Mood is the interesting case. "Scary" *is* embedded, and it works, because it
genuinely describes content — horror films read as frightening. "Classic" does
not, because age is not a property of the text. Two words in the same UI, in
adjacent boxes, one belonging in the vector and one in a `WHERE` clause. The
distinction is not "is it a word" but **"is this fact present in the text I
embedded?"**

---

## 3. Filtering and approximate search interact badly

Adding `WHERE runtime <= 120` to a vector search looks free. It is not, and the
reason is worth understanding before a corpus grows large enough for it to bite.

An **approximate** index — HNSW, IVF — finds neighbours by walking a structure
built over the vectors. It does not know about your `WHERE` clause. Two orders of
operation are possible and both have a defect:

**Post-filtering** — let the index find the nearest `k`, then discard rows
failing the filter. Fast, and it silently under-returns. Ask for five films under
two hours and the index returns the five nearest overall; if four are long, you
get one result. Not an error, just a short list, and the user has no way to tell
"only one match" from "the filter ate the rest".

**Pre-filtering** — evaluate the filter first, then search only survivors
exactly. Always correct, and it throws away the index; on a large table with a
selective filter you are back to a full scan.

Real systems compromise. pgvector 0.8 added *iterative index scans*, which keep
pulling from the index until enough rows survive the filter. Purpose-built
databases expose the same trade under names like filtered search or pre-filter
hints.

**At PopChoice's size none of this applies** — nine rows means Postgres scans the
table and the answer is exact whatever the plan says. It is documented because
the failure is invisible: nothing errors, results just quietly get shorter, and
the code that was correct at nine rows is the code that will be wrong at nine
hundred thousand.

The related decision in the sibling project was to give each corpus its own table
rather than one table with a `source` column, partly for this reason: a filter
you never have to apply cannot interact with anything.

---

## 4. Group recommendation is a voting problem

This is the part that is genuinely different from single-user retrieval, and it
has a century of theory behind it that has nothing to do with machine learning.

Five people each have a preference order over nine films. You need one film. That
is **social choice**: aggregating individual rankings into a collective one. The
same mathematics governs elections, and the results are not encouraging.

### Three ways to aggregate, and what they cost

**Take the most first-place votes** (plurality). Cheap, and it ignores everything
except the top of each list. A film adored by two people and loathed by three
wins over one that is everyone's comfortable second. For a group deciding on an
evening together, that is precisely the wrong answer.

**Look for a Condorcet winner** — the film that beats every other film in
head-to-head majority comparisons. When one exists it is a genuinely strong
answer. The problem is that one often does not: preferences can cycle, so A beats
B, B beats C, and C beats A, with no film beating all others. This is the
**Condorcet paradox**, and it is not exotic — three people with rotated
preferences produce it.

**Score by position** (positional / Borda methods). Every rank contributes
points, so the whole list matters rather than just its head. A Condorcet winner
is not guaranteed to win, but an answer always exists and it reflects broad
acceptability, which is the thing a group actually wants.

PopChoice uses a positional method, because "least objectionable to the most
people" is a better description of choosing a film together than "the favourite
of the largest faction".

### Arrow's theorem, and why there is no right answer

**Arrow's impossibility theorem** (1951): for three or more options, no
rank-aggregation rule can simultaneously satisfy

- **unrestricted domain** — it works for any set of individual preferences,
- **Pareto efficiency** — if everyone prefers A to B, so does the result,
- **independence of irrelevant alternatives (IIA)** — whether A beats B depends
  only on how people rank A and B, not on some third option C,
- **non-dictatorship** — no single person's ranking decides regardless of others.

Every method gives up one. Positional methods — Borda, RRF — give up **IIA**.
That has a concrete, observable consequence here: **adding a film to the corpus
can reorder two films that were already in it.** If a new title outranks A for
one person and not for another, it shifts their relative contributions and can
flip A and B, even though nobody's opinion of A versus B changed.

So "Next Movie" walks a list whose order is not a fact about the group's
preferences alone — it is a fact about the group's preferences *and the corpus*.
This is not a bug to be fixed. It is a theorem, and the honest response is to
know it, not to hunt for the rule that escapes it.

### What is not modelled

Real group choice has more in it than rankings. **Fairness over time** — if one
person's taste won last week, they might reasonably yield this week — needs
history the app does not keep. **Intensity** — mild preference versus hatred —
does not survive a rank; "I would rather not" and "absolutely not" both read as
last place. Some group recommenders take explicit vetoes for this reason, and
that is a straightforward extension: filter before fusing.

---

## 5. Rank fusion

**Reciprocal Rank Fusion** is the positional method PopChoice uses. Each ranked
list contributes to every item it contains:

```
score(item) = Σ  1 / (k + rank of item in list i)
              i
```

Simple to implement, hard to break, and it originated in information retrieval
for combining the outputs of different search systems — which is exactly the
structure here, with "different search systems" replaced by "different people".

### Why ranks and not scores

The alternative is **score fusion**: add up the cosine similarities each person's
search produced. It uses more information, and it is a trap.

Similarity scores are **not calibrated** (`../EmbeddingsAndVectorDB/THEORY.md`
§2). A cosine of 0.44 does not mean "44% relevant", and — critically — it does
not mean the same thing across two different queries. Someone who wrote three
sentences about their taste gets a different score distribution from someone who
wrote five words. Summing them lets the more verbose person dominate for reasons
that have nothing to do with preference.

**Ranks are scale-free.** First is first regardless of how the query was
phrased. Giving up the magnitude information is the price of not being at the
mercy of an uncalibrated scale, and in practice it is a bargain.

That project's whole calibration saga is the same lesson from the other
direction: it spent enormous effort establishing what a score *means* for one
fixed corpus, and the number still moved when document length changed. Anything
that avoids depending on absolute scores avoids that entire class of problem.

### The `k` parameter is not decoration

`k` controls how sharply the method favours the top of each list.

```
k = 1     rank 1 = 0.500   rank 2 = 0.333   rank 9 = 0.100     top-heavy
k = 10    rank 1 = 0.091   rank 2 = 0.083   rank 9 = 0.053     balanced
k = 60    rank 1 = 0.016   rank 2 = 0.016   rank 9 = 0.014     nearly flat
```

The published value is **60**, and it is quoted everywhere as if it were a
constant of nature. It is not: it was chosen for TREC-scale evaluations over
thousands of results, where the job is to stop one system's runaway top hit from
dominating a fused list.

Against nine films, `k = 60` spreads the entire list across 12% — a film everyone
ranked last scores almost what a film someone ranked first does, and the method
stops discriminating. **A constant borrowed from a paper is a constant borrowed
from that paper's corpus size.** PopChoice uses 10, which keeps first place 42%
ahead of ninth while still letting broad acceptability beat a single fan.

This is the same failure the sibling project hit with an absolute margin
inherited from a corpus of one-line summaries. Numbers do not transfer between
corpora just because they transfer between codebases.

### Relation to Borda

Borda count assigns linear weights: with `n` items, first gets `n-1`, second
`n-2`, and so on. RRF's weights are **convex** — they fall away quickly at first
and then flatten. The difference in behaviour is real: Borda treats the gap
between 1st and 2nd as identical to the gap between 8th and 9th, while RRF says
the top of a list carries more information than its tail. For preferences that is
usually right, since people have opinions about their favourites and are mostly
indifferent between their eighth and ninth choices.

As `k → ∞` RRF's weights approach uniform and it stops distinguishing anything;
as `k → 0` it approaches "only first place matters", which is plurality voting
and brings back the tyranny-of-the-largest-faction problem. `k` slides between
two known-bad extremes, which is a good reason to choose it deliberately.

---

## 6. Why not just average the vectors

The tempting shortcut is to skip all of this: concatenate everyone's answers into
one block of text, embed it once, search once. One API call regardless of group
size, no fusion code.

It fails, and the reason is geometric.

Embeddings live on a high-dimensional sphere (most models return unit vectors).
The average of several unit vectors points somewhere between them and is
**shorter** than any of them — and after renormalising, it points at a direction
that may correspond to no real document at all. For a few closely-related
vectors this is fine and is why averaging word vectors to represent a sentence
works passably. For genuinely different directions it is not.

```
horror fan          →  ↑
children's cartoon  →  →        centroid ↗ : a region where
sombre documentary  →  ↓            nothing actually lives
```

Five people who like horror, musicals, documentaries, Bollywood and animation do
not average into a person who likes anything. They average into a point in
low-density space whose nearest neighbour is arbitrary — the film that happens to
be blandest, or nearest the corpus centre, which is a property of the corpus and
not of the group.

This is the same argument `../EmbeddingsAndVectorDB/THEORY.md` §4 makes for not
embedding a whole document: a single vector cannot faithfully represent fifty
pages, because averaging that much meaning produces something near the centre of
everything and close to nothing. **A group is a document with several authors,
and the same geometry applies.**

### Measure it rather than believing it

PopChoice's eval builds the naive version for real and compares. The result is
more interesting than the argument:

| group | fusion | naive | same pick? |
| --- | --- | --- | --- |
| animation + comedy + spectacle | Spider-Verse | Spider-Verse | yes |
| history + drama | Oppenheimer | Oppenheimer | yes |
| horror + cartoon + documentary | The Fabelmans (worst rank 5) | Troll (worst rank 6) | **no** |

**On groups that broadly agree the two methods are identical.** The centroid only
lands somewhere useless when the inputs genuinely disagree — which is exactly
when it matters, and exactly the case that a small test set of agreeable groups
would never surface.

The honest summary is narrower than the argument implies: fusion is not
*generally* better, it is better *when tastes conflict*, and it is never worse.
That is enough to justify it, and it is not what the comment in the code said
before anyone checked.

---

## 7. Evaluating a recommender

Ranking systems fail in ways that classification metrics hide, and test sets for
them fail in ways that are almost impossible to spot by reading.

### The metrics, and which one to use

- **Precision@1** — is the top result right? Brutal, and correct when the product
  shows one thing. PopChoice shows one film, so this is the primary number.
- **Recall@k** — is the right item in the top `k`? The right metric when the UI
  shows a list.
- **MRR** — mean of `1/rank`. Rewards near-misses, appropriate with one correct
  answer per query.
- **nDCG** — the standard when relevance is graded rather than binary and
  position matters. Overkill when there is exactly one right answer.

PopChoice uses precision@1 as the headline, **mean rank** as a secondary, and a
hard cap on worst rank. The secondary earns its place: accuracy is a step
function and hides drift. A system whose targets slide from first to a
consistent second scores identically on precision@1 until the moment it
collapses, while mean rank moves smoothly and gives warning.

### Baselines, or the number means nothing

"85% accurate" is not a fact until you know what chance looks like. With nine
films and one right answer, random guessing scores **11%**. A number without its
baseline is decoration.

Better still is a **competing-method baseline** — here, naive concatenation. It
answers a question the random baseline cannot: is the complicated thing earning
its complexity? If naive had matched fusion on the conflicting-tastes case too,
the honest conclusion would have been to delete `rank.js`.

### Sample size

With `n` labelled cases, one flip moves accuracy by `1/n`. At `n = 7` that is 14
percentage points — larger than most regressions you would want to catch, so a
single flaky result and a real regression are indistinguishable. The standard
error of a proportion around 0.85 is roughly 13pp at `n = 7` and 8pp at
`n = 18`. Neither is *good*; the second is at least readable. Hand-labelled sets
are expensive, so the practical advice is: know your noise floor, and do not
report changes smaller than it.

### Leakage, the failure that flatters you

The one to actually fear. A test query that contains a token identifying its
target does not measure retrieval quality — it measures string matching, and it
will keep passing after retrieval breaks.

PopChoice's own test set had two, neither visible on reading:

```
"I loved Titanic for how immersive the water felt"
                                    ^^^^^  → Avatar: The Way of the Water

"a stunt choreographer from a South Indian action set"
                              ^^^^^^^^^^^^  → the one South Indian film
```

Both passed. Both would have kept passing with the embeddings replaced by
keyword search over titles. Removing them dropped the score from 18/18 to
**15/18** — meaning three of the eighteen passes had been bought rather than
earned.

Two lessons. First, **enforce it in code**: the check is free, and relying on
whoever writes the next case to remember is how the first two got in. Second,
the distinction is subtler than "do not name the film". A film's *nationality*
identifies it as surely as its title while looking like ordinary description,
and a plot summary does not, even though both are text about the film. The test
is not "is this word in the record" but **"would a keyword matcher get this right
for free?"**

### Do not tune the test until it passes

When the de-leaked profiles started landing second, the available responses were
to sharpen them until they went green, or to record 15/18 and move on.

The first is how the leak got in. A test set edited until it agrees with the
system has stopped being a measurement. The second is uncomfortable and correct:
the number is now a **baseline** that fails if it drops, with a hard cap
alongside it so a genuine matching bug — the right film landing fifth — still
fails loudly while an honest tie between two similar films does not masquerade as
one.

---

## 8. How this app is actually built

### 8.1 The pipeline

```
per person:  four answers → profile text → embedding → ranked films (time-filtered)
all people:  ranked lists → rank.js fuse → group ranking
on screen:   top film → pitch grounded in that film's record → "Next Movie" walks the list
```

The chat model **never chooses the film**. By the time it runs the winner is
decided by embeddings and by a pure function, both inspectable and testable.
Letting a prompt pick would be less code and no way to measure it — and the
sibling project's experience is that the component nobody can test is the
component with the bugs in it.

### 8.2 What is pure, and why it matters

`rank.js` and `time.js` have no dependencies. `recommend.js` and the router take
their OpenAI and Supabase clients as **arguments** rather than importing them.

This is not tidiness. `index.js` touches `document` on its first line, so
anything living there is unreachable from Node, and the only way to test it is a
second copy — which passes its own tests while the real one drifts. The sibling
project learned this over three user-visible bugs in the one stage it could not
call from a test.

It paid immediately here. `parseMinutes` began inside `index.js`; moving it out
so the eval could reach it caught `"1h30"` parsing as 60 minutes, in a function
that had been read several times and looked obviously correct.

### 8.3 The era bonus, derived rather than typed

New/Classic is worth exactly one rank position:

```js
export const ERA_BONUS = 1 / (RRF_K + 1) - 1 / (RRF_K + 2);
```

The intent — enough to settle a near-tie, not enough to overturn a clearly better
match — is a statement about the gap between adjacent ranks, so it is computed
from the gap between adjacent ranks. Written as a literal it silently stops
meaning that the moment `k` changes.

It was a literal, 0.004, against an adjacent-rank gap of 0.0076. It claimed one
rank of influence and had half of one, and a group unanimously asking for New got
a 2022 film by a margin of 0.3%. **A constant that encodes a relationship should
be computed from the relationship.**

### 8.4 Two things the data cannot do

Every film is from 2022 or 2023, so "Classic" means one year older. The control
works and is deliberately weak.

Nothing runs under 101 minutes, so a 90-minute answer empties the corpus. The
limit gives way and the screen says why. The three available responses were:
return nothing (correct and useless), silently ignore the answer (the worst
option, because the user believes it was honoured), or relax it and say so.

**When a constraint cannot be satisfied, saying so beats both obeying it and
ignoring it.** The general principle: a system that quietly discards user input
is worse than one that admits it cannot comply.

### 8.5 Grounding the pitch

The sentence under the poster is written only from the film's stored record,
never from the model's own knowledge — the same discipline as the sibling's
answerer, for the same reason. A model asked to describe a film it "knows"
produces something fluent, plausible, and occasionally invented, and the output
gives no way to tell which you got.

The group framing is the part worth copying: the pitch must explain a fit to
people who did not all ask for the same thing, and the prompt asks it to
acknowledge a compromise rather than oversell. A pitch claiming a film is perfect
for everyone, when it won on being tolerable to everyone, is the same class of
dishonesty as a confident answer from an empty context.

---

## 9. What is not here

Worth knowing as the natural next steps, and as the boundary of what this
implements.

- **No cold start.** Everyone describes their taste every time. Real recommenders
  have profiles and histories, which brings its own hard problem: recommending to
  someone with no history at all.
- **No collaborative filtering.** This is purely content-based — films are matched
  on their descriptions. Collaborative filtering instead uses "people who liked X
  liked Y", needs many users, and cannot recommend an item nobody has rated. The
  two are usually combined.
- **No diversity or serendipity handling.** "Next Movie" walks a ranked list, so
  the second suggestion is often much like the first. Production recommenders
  deliberately inject variety, because the most similar item is not always the
  most useful one.
- **No fairness over sessions.** A group where the same person's taste wins every
  time is a group that stops using the app. Fixing it needs history.
- **No explicit vetoes.** "Anything but horror" is a hard constraint the ranking
  cannot express, and it would be a natural extension — filter before fusing.

---

## 10. Related reading in this repo

- `../EmbeddingsAndVectorDB/THEORY.md` — the prerequisite. Embeddings, cosine
  similarity, vector indexes, chunking, RAG, and the calibration problem this
  project deliberately does not have.
- `../HuggingFaceDemo/THEORY.md` — encoder-only models, the architecture behind
  the embeddings both projects rely on.
- `../TransformersJs/THEORY.md` — embedding models small enough to run in the
  browser, which would remove the exposed API key here.
- `../AskGenie/THEORY.md` — grounding against retrieved text, the same discipline
  the pitch prompt uses.
