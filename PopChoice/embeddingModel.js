/**
 * The one place the embedding model is named.
 *
 * Vectors from different models are not comparable — they describe different
 * spaces. If ingest.js and the browser ever disagreed about the model, search
 * would not error, it would just quietly return nonsense. Importing the name
 * from here instead of writing it twice makes that drift impossible.
 *
 * Plain ESM with no dependencies, so it loads unchanged in Node and under Vite.
 *
 * DIMENSIONS must match `vector(N)` on public.popchoice_movies. Changing MODEL
 * means re-embedding every film; ingest.js detects that and does it for you.
 *
 * There is no match threshold here, and its absence is a design decision rather
 * than an omission. The sibling project at ../EmbeddingsAndVectorDB answers
 * questions and must be able to say "I have nothing about that", so it needs a
 * floor below which a result is refused. PopChoice always recommends something:
 * the screen has a "Next Movie" button, so what matters is the *order* of nine
 * films, not whether the ninth clears a bar. Ranking is the whole job, which is
 * why eval.js measures ranks and not a floor and ceiling.
 */
export const MODEL = 'text-embedding-3-small';
export const DIMENSIONS = 1536;
