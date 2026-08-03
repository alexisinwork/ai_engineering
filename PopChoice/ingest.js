/**
 * Seeds public.popchoice_movies with embeddings. Run: npm run ingest
 *
 * Node only. Uses the service_role key, which bypasses RLS — that is why the
 * write path lives here instead of in the browser app, where anon has a SELECT
 * policy, no write policy, and no write grant either.
 *
 * Builds its own clients rather than importing config.js / supabaseClient.js,
 * because those read import.meta.env, which only exists under Vite.
 *
 * There is no chunking step. Every film is a single short record that is
 * already one retrievable thing, and splitting it would strand the plot in a
 * chunk with no title on it — the failure the sibling project's chunk.js is
 * arranged to avoid. The longest record here is comfortably inside the model's
 * input limit, so there is nothing to solve.
 */
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { MODEL } from './embeddingModel.js';
import movies from './movies.js';

const {
  VITE_OPENAI_API_KEY: openaiKey,
  VITE_SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
} = process.env;

const missing = Object.entries({
  VITE_OPENAI_API_KEY: openaiKey,
  VITE_SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length) {
  console.error(`Missing env var(s): ${missing.join(', ')}\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

const openai = new OpenAI({ apiKey: openaiKey });
const supabase = createClient(supabaseUrl, serviceRoleKey);

/**
 * Whether a stored row still matches movies.js *and* the model in use.
 *
 * Two independent ways to go stale. A data edit — a fixed typo, a new poster —
 * leaves the row describing something that is no longer being ingested. A model
 * change leaves the vector describing a different space entirely, which is the
 * quieter of the two: every query still runs and every result is meaningless.
 */
function isCurrent(stored, film) {
  return (
    stored.content === film.content &&
    stored.release_year === Number(film.releaseYear) &&
    stored.runtime_minutes === film.runtimeMinutes &&
    stored.poster_url === film.poster &&
    stored.embedding_model === MODEL
  );
}

async function main() {
  const runtimes = movies.map((film) => film.runtimeMinutes);
  console.log(
    `${movies.length} film(s) in movies.js, ${Math.min(...runtimes)}–${Math.max(...runtimes)} min.`
  );

  const { data: existing, error: readError } = await supabase
    .from('popchoice_movies')
    .select('id, title, content, release_year, runtime_minutes, poster_url, embedding_model')
    .order('id');

  if (readError) throw readError;

  const wanted = new Map(movies.map((film) => [film.title, film]));

  // A stored row survives only if it is still in movies.js and still current.
  // Dropping rows that no longer appear is what stops an old edit of a film
  // sitting in the index alongside the new one, competing with it for the same
  // queries — no error, just a corpus holding two versions of the same thing.
  const obsolete = existing.filter(
    (row) => !wanted.has(row.title) || !isCurrent(row, wanted.get(row.title))
  );

  if (obsolete.length) {
    const wrongModel = obsolete.filter((row) => row.embedding_model !== MODEL).length;
    console.log(
      `  deleting ${obsolete.length} stale row(s): ${wrongModel} from another model, ` +
        `${obsolete.length - wrongModel} no longer matching movies.js.`
    );
    const { error } = await supabase
      .from('popchoice_movies')
      .delete()
      .in('id', obsolete.map((row) => row.id));
    if (error) throw error;
  }

  const obsoleteIds = new Set(obsolete.map((row) => row.id));
  const current = new Set(
    existing.filter((row) => !obsoleteIds.has(row.id)).map((row) => row.title)
  );
  const pending = movies.filter((film) => !current.has(film.title));

  if (!pending.length) {
    console.log(`  nothing to embed — all ${movies.length} films stored, embedded by ${MODEL}.`);
    return;
  }

  // One batched call rather than one request per film.
  const response = await openai.embeddings.create({
    model: MODEL,
    input: pending.map((film) => film.content),
  });

  // Pair each embedding with its input by index rather than trusting response
  // order. Pairing by array position mis-stores every row if the response comes
  // back out of order, and does it silently and permanently.
  const rows = response.data.map((item) => ({
    title: pending[item.index].title,
    release_year: Number(pending[item.index].releaseYear),
    runtime_minutes: pending[item.index].runtimeMinutes,
    poster_url: pending[item.index].poster,
    content: pending[item.index].content,
    embedding: item.embedding,
    // Stamp the model so a future swap can find these rows and redo them.
    embedding_model: MODEL,
  }));

  const { error: writeError } = await supabase.from('popchoice_movies').insert(rows);
  if (writeError) throw writeError;

  console.log(`  inserted ${rows.length} film(s) embedded by ${MODEL}; ${current.size} already current.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
