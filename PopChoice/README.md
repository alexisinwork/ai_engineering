# PopChoice

A film recommender for a group. Everyone answers four questions, and the app
picks something they can all live with.

Part of [ai_engineering](https://github.com/alexisinwork/ai_engineering). Built
after `../EmbeddingsAndVectorDB`, and leans on what that project cost to learn.

Film records are embedded with OpenAI `text-embedding-3-small` (1536 dims) and
stored in Supabase Postgres via `pgvector`. Each person's answers are embedded
separately and searched separately; the rankings are then fused into one.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the keys
npm run ingest         # embed + store the nine films (Node, one time)
npm start              # app at localhost:5173
```

`npm run ingest` chains into `npm run eval` automatically. Run it alone with
`npm run eval`.

The Supabase project is shared with `../EmbeddingsAndVectorDB` — PopChoice only
adds a table and a function, so the same URL and keys work for both.

## The three screens

```
SETUP                PERSON n of N              RESULT
🍿 PopChoice         🍿                         Barbie (2023)
[How many people?]   n                         ┌──────────┐
[How much time?]     Favourite film & why      │  poster  │
[    Start    ]      [New] [Classic]           └──────────┘
                     [Fun][Serious][Insp][Scary]  why it suits the group
                     Stranded-with & why        [  Next Movie  ]
                     [ Next Person / Get Movie ]
```

One person is just the group case with `N = 1`, so the core brief and the
stretch goal are the same code path.

## How the four answers are used

Two are free text, two are facts, and they go to different places. Embedding the
word "classic" would search for films whose *description* sounds classic, which
is a different and wronger question than "released earlier".

| answer | where it goes |
|---|---|
| favourite film & why | embedded |
| stranded-with & why | embedded |
| Fun / Serious / Inspiring / Scary | embedded |
| New / Classic | `rank.js`, as a small bonus |
| how much time | SQL, as a hard filter |

## Combining several people

Each person is embedded and searched on their own, and the resulting **rankings**
are fused — never the vectors.

Pasting everyone's answers into one block and embedding that once is cheaper and
wrong for the reason `../EmbeddingsAndVectorDB/THEORY.md` §4 gives for not
embedding whole documents: a vector averaging five tastes lands near the centre
of the space and close to nothing. Five people who like horror, musicals,
documentaries, Bollywood and animation do not average into a person who likes
anything.

The method is **Reciprocal Rank Fusion** — each person contributes `1/(k + rank)`
to every film. It needs no score calibration, which matters because cosine
similarities are not comparable across queries: one person's enthusiastic 0.44
and another's lukewarm 0.31 are not on the same scale, but "first" and "third"
always are.

`k` is **10**, not the published 60. That constant is tuned for search
evaluations over thousands of results; against nine films it flattens everything
to a 12% spread and the fusion stops discriminating. At 10, first place stays
meaningfully ahead of ninth while broad acceptability still beats one person's
favourite — which is the whole point:

```
        person 1   person 2   person 3
A          1st        5th        5th      <- one fan, nobody else
B          2nd        2nd        2nd      <- everyone's second choice  → wins
```

**New/Classic** is worth exactly one rank position, computed as
`1/(k+1) − 1/(k+2)` rather than typed as a constant. It was 0.004 against an
adjacent-rank gap of 0.0076 — claiming one rank of influence and having half of
one — and a group unanimously asking for New got a 2022 film by a margin of
0.3%. Deriving it from `k` keeps the code and the intent in agreement.

## Two things the data cannot do

**Every film is from 2022 or 2023,** so "Classic" means one year older. The
control works and is deliberately weak; it nudges ties rather than deciding
outcomes. If genuinely older films are ever added, `ERA_BONUS` deserves
revisiting and the group cases in `eval.js` are where that shows up first.

**Nothing runs under 101 minutes.** Ask for 90 and the filter empties the
corpus. Returning nothing would be correct and useless, so the limit gives way
and the screen says why — *"Nothing here runs under 90 minutes — the shortest is
101 min."* Silently ignoring the answer would be worse than either.

## Posters

The supplied array had no images and the design shows one, so a `poster` field
was added to each film — Wikipedia article images, each checked to return HTTP
200 with an image content type.

They are third-party URLs on a host that owes us nothing, so every `<img>` falls
back to a rendered card with the title and year. A broken-image icon in a 2:3
box is worse than no image at all.

## How it splits

| | Runs in | Key used | Can write? |
|---|---|---|---|
| `ingest.js` | Node | `service_role` | yes — bypasses RLS |
| `eval.js` | Node | publishable | no — read-only |
| `index.js` + `config.js` + `supabaseClient.js` | Browser | publishable | no — read-only |
| `recommend.js`, `rank.js`, `time.js`, `movies.js`, `embeddingModel.js`, `chatModel.js` | both | — | — |

`index.js` owns the screens and the state and makes no API calls; `recommend.js`
owns the pipeline and holds no DOM.

**Everything with logic in it is callable from Node.** `rank.js` is pure,
`time.js` is pure, and `recommend.js` takes its OpenAI and Supabase clients as
arguments rather than importing them. That is not tidiness — the sibling project
spent three user-visible bugs learning that a stage which cannot be called from a
test is a stage nobody is testing. `parseMinutes` started life inside
`index.js`, where the first line of the module touches `document`; moving it out
so the eval could reach it immediately caught `"1h30"` parsing as 60 minutes.

## Database

- `public.popchoice_movies` — `title`, `release_year`, `runtime_minutes`,
  `poster_url`, `content`, `embedding vector(1536)`, `embedding_model`
- HNSW index on `embedding` using `vector_cosine_ops`; btree on `runtime_minutes`
- `match_popchoice_movies(query_embedding, match_count, max_runtime)` —
  `max_runtime` is a hard filter and nullable, so a caller can opt out, which is
  what `recommend.js` does when the limit would empty the corpus.

`order by embedding <=> query asc`, not `1 - distance desc` — only the first
form can use the HNSW index; the second is not recognised as the indexable
operator and falls back to a sequential scan. `limit least(match_count, 200)`
caps what an anonymous caller can pull. `SECURITY INVOKER` so RLS applies, with
`EXECUTE` granted to `anon`/`authenticated`/`service_role` and `PUBLIC` revoked.

RLS is on with a SELECT policy for `anon` and no write policy, and the table
grants are narrowed to `SELECT` as well — so two independent layers have to fail
before the browser could write.

`embedding_model` is stamped on every row. Vectors from different models
describe different spaces, and mixing them returns quiet nonsense rather than an
error; the stamp is what lets `npm run ingest` find rows from an older model and
redo them.

## What the eval measures

There is **no threshold section**, and that is the main way this differs from
the sibling. That app answers questions and must be able to refuse, so it lives
or dies on a floor below which a result is rejected. PopChoice always
recommends — there is a "Next Movie" button and nine films — so every query
returns the whole corpus in some order, and the only question is whether the
order is right.

| section | what it checks | cost |
|---|---|---|
| TIME | the free-text time box, including unparseable ≠ unlimited | free |
| LEAKAGE | no profile names its target film or where it is from | free |
| FUSION | `rank.js` against hand-built rankings, **whole order** asserted | free |
| CONSTRAINTS | the time filter, asserted against what the database returned | embeddings |
| PROFILES | one person's taste → the film that should come first | embeddings |
| GROUP | several people → the compromise, fusion measured against naive | embeddings |

The profiles are written the way the form is actually filled in — a favourite
film and a reason, a mood, someone to be stranded with. The group cases are
built so the right answer is a *compromise*; a group that agrees tests nothing a
single profile does not.

### Leakage is enforced, not trusted

A profile mentioning "water" retrieves *The Way of the Water* on the token
alone. It scores a pass and proves nothing — it would still pass with the
embeddings replaced by keyword search. Two of the original profiles leaked and
neither was obvious on reading, so the check is now automatic and free:

- **title words** — no profile may contain a word from its target's title
- **origin labels** — "Norwegian", "Bollywood", "South Indian" each single out
  exactly one film, and nobody offers a film's nationality when asked their
  favourite film and why

Plot description stays fair game; that is what a person actually types.

Removing the leaks cost real accuracy: **18/18 became 15/18.** Three profiles
were passing on the leaked token and now land second, each behind a film the
corpus genuinely confuses them with — Oppenheimer behind another wartime drama,
RRR behind the other Indian action epic. The temptation was to sharpen those
three until they went green, which is tuning the measurement to the answer and
is how the leak got in the first time. So the number is recorded as it is:

```
first      15/18   baseline; a regression guard, not an aspiration
mean rank  1.17    degrades before accuracy does
max rank   2       third or worse is a bug, not an ambiguity
```

### The premise is tested, not asserted

`rank.js` exists on the claim that concatenating everyone's answers into one
embedding fails. That claim lived in a comment, which made it an opinion with a
citation — so GROUP now builds the naive version for real and measures it.

On agreeable groups the two are **identical**. The difference only appears when
tastes genuinely conflict, which is the case the section exists for:

| | pick | per-person ranks | worst |
|---|---|---|---|
| fusion | The Fabelmans | 5, 3, 1 | **5** |
| naive | Troll | 1, 6, 5 | **6** |

Naive picks the horror fan's favourite, which is the animation fan's sixth of
nine. Fusion picks something middling for everyone. That is the whole claim, and
it is narrower than the comment implied — fusion is required only to be *no less
fair* than the blob, and the eval fails if naive ever matches more expected
titles than fusion does.

## Keys

`.env` is gitignored — do not commit it.

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — public by design.
- `SUPABASE_SERVICE_ROLE_KEY` — secret. Node only. Never give it a `VITE_`
  prefix, or Vite will inline it into the bundle and hand anyone full
  RLS-bypassing access.
- `VITE_OPENAI_API_KEY` — **exposed to the browser.** Vite inlines it, so anyone
  loading the page can read it from devtools and spend against your account.
  Acceptable for local practice; before deploying, move the embedding and chat
  calls into a Supabase Edge Function and drop the key from the client.
