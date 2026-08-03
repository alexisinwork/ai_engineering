/**
 * Turns a group's answers into a ranked list of films, and writes the pitch for
 * whichever one is on screen.
 *
 * Clients are injected rather than imported. index.js passes the Vite-configured
 * pair from config.js and supabaseClient.js; eval.js passes Node ones. That is
 * the same arrangement the sibling project arrived at the hard way — a stage
 * that can only run in the browser is a stage the eval has to reimplement, and
 * the reimplementation passes its own tests while the real one drifts.
 *
 * The pipeline:
 *
 *   per person: answers → profile text → embedding → ranked films (time-filtered)
 *   all people: ranked lists → rank.js fuse → group ranking
 *   on screen:  top film → pitch grounded in that film's record
 *
 * Note what the chat model is *not* asked to do: it never chooses the film. By
 * the time it runs the winner is already decided by embeddings and by a pure
 * function, both of which can be inspected and tested. Handing the choice to a
 * prompt would be less code and no way to measure it.
 */
import { MODEL } from './embeddingModel.js';
import { CHAT_MODEL, PITCH_SYSTEM } from './chatModel.js';
import { fuse } from './rank.js';

/** Every film, so fusion sees complete rankings rather than truncated ones. */
const MATCH_COUNT = 50;

/**
 * The three answers that describe taste, joined into the text that gets
 * embedded.
 *
 * The fourth answer — New or Classic — is deliberately absent. It is a fact
 * about release year, and release year is a column; embedding the word "classic"
 * would search for films whose *description* sounds classic, which is a
 * different and wronger question. Time is left out for the same reason. Free
 * text goes to the vector, structured facts go to SQL and to rank.js.
 *
 * The stranded-with answer is included even though it names a person, because
 * here that name is the point: "Tom Hanks because he is funny" is a statement
 * about taste in the same way "I loved Shawshank" is. The sibling project had
 * to learn to tell a person-as-subject from a person-as-taste; PopChoice only
 * ever gets the second kind, because the question asks for it.
 */
export function profileText(person) {
  return [person.favourite, person.mood && `In the mood for something ${person.mood}.`, person.strandedWith]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(' ');
}

async function rankFor(supabase, embedding, maxRuntime) {
  const { data, error } = await supabase.rpc('match_popchoice_movies', {
    query_embedding: embedding,
    match_count: MATCH_COUNT,
    max_runtime: maxRuntime,
  });
  if (error) throw error;
  return data;
}

/**
 * `people` is one entry per person:
 *
 *   { favourite, era: 'new' | 'classic' | null, mood, strandedWith }
 *
 * `minutes` is the time available, or null for no limit.
 *
 * Returns `{ ranking, relaxed, shortest }`. `relaxed` is true when the time
 * limit excluded everything and was dropped — the corpus runs 101 to 190
 * minutes, so any answer under an hour and three quarters empties it. Returning
 * nothing would be technically correct and useless; the UI says so instead and
 * shows the closest fit.
 */
export async function recommend(openai, supabase, { people, minutes = null }) {
  const profiles = people.map(profileText).filter(Boolean);
  if (!profiles.length) return { ranking: [], relaxed: false, shortest: null };

  // One batched call rather than one request per person.
  const response = await openai.embeddings.create({ model: MODEL, input: profiles });

  // Pair each embedding with its input by index rather than trusting response
  // order — the same guard ingest.js uses.
  const vectors = [];
  for (const item of response.data) vectors[item.index] = item.embedding;

  let relaxed = false;
  let lists = await Promise.all(vectors.map((vector) => rankFor(supabase, vector, minutes)));

  // The filter emptied the corpus. Drop it, and remember that we did.
  if (minutes !== null && lists.every((list) => list.length === 0)) {
    relaxed = true;
    lists = await Promise.all(vectors.map((vector) => rankFor(supabase, vector, null)));
  }

  const ranking = fuse(
    lists.map((films, index) => ({ films, era: people[index]?.era ?? null }))
  );

  const shortest = ranking.length
    ? Math.min(...ranking.map((film) => film.runtime_minutes))
    : null;

  return { ranking, relaxed, shortest };
}

/**
 * Writes the two or three sentences under the poster.
 *
 * The film record goes in as a system message after the user turn, so the
 * freshest instruction sits nearest the generation — and so the group's answers
 * are visibly *the user's*, while the record is visibly reference material.
 */
export async function pitch(openai, film, people) {
  const tastes = people
    .map(profileText)
    .filter(Boolean)
    .map((text, index) => `Person ${index + 1}: ${text}`)
    .join('\n');

  const response = await openai.chat.completions.create({
    model: CHAT_MODEL,
    // Low but not zero: two groups with similar answers should not get
    // identical sentences, and neither should wander from the record.
    temperature: 0.4,
    messages: [
      { role: 'system', content: PITCH_SYSTEM },
      { role: 'user', content: tastes || 'No preferences given.' },
      { role: 'system', content: `FILM\n${film.content}` },
    ],
  });

  return response.choices[0].message.content.trim();
}
