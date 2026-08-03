/**
 * Combines several people's ranked film lists into one group ranking.
 *
 * Pure — no clients, no network, no I/O. That is deliberate: this is the only
 * part of PopChoice that decides *which film wins*, and a function with no
 * dependencies is one the eval can call directly with hand-built inputs and no
 * API spend. The lesson is borrowed from ../EmbeddingsAndVectorDB, where every
 * stage that could not be called from a test turned out to be the stage with
 * the bugs in it.
 *
 * **Why fuse rankings instead of averaging tastes.** The cheap alternative is
 * to paste everybody's answers into one block of text and embed that once. It
 * fails for the reason THEORY §4 gives for not embedding whole documents: a
 * vector averaging five different tastes lands near the centre of the space and
 * close to nothing in particular. Five people who like horror, musicals,
 * documentaries, Bollywood and animation do not average into a person who likes
 * anything. Ranking each person separately and combining the *positions* keeps
 * every taste intact and asks a different, answerable question — which film is
 * least objectionable to the most people.
 *
 * The method is Reciprocal Rank Fusion: each person contributes 1/(k + rank) to
 * every film they ranked. It needs no score calibration, which matters here
 * because cosine similarities are not comparable between queries (§2) — one
 * person's enthusiastic 0.44 and another's lukewarm 0.31 are not on the same
 * scale, but "first" and "third" always are.
 */

/**
 * How sharply the fusion favours a person's top pick.
 *
 * The published RRF constant is 60, and it is wrong for this corpus. That value
 * comes from search evaluations over thousands of results, where the job is to
 * stop one system's runaway top hit from dominating. Against nine films it
 * flattens everything: 1/61 versus 1/69 is a 12% spread across the entire list,
 * so a film everyone ranked last scores nearly what a film someone ranked first
 * does, and the fusion stops discriminating.
 *
 * 10 keeps first place meaningfully ahead of ninth (1/11 vs 1/19, a 42% spread)
 * while still rewarding broad acceptability over one person's favourite. It is
 * a measured choice — eval.js has group cases that fail if it moves far.
 */
export const RRF_K = 10;

/**
 * What matching someone's New/Classic preference is worth: exactly one rank
 * position, derived from RRF_K rather than picked.
 *
 * The intent is that an era match should be able to promote a film past the one
 * directly above it and no further — enough to settle a near-tie, not enough to
 * overturn a film that is genuinely better matched. That is a statement about
 * the gap between adjacent ranks, so it should be computed from the gap between
 * adjacent ranks. Written as a constant it silently stops meaning that the
 * moment k changes; the first version was 0.004 against an adjacent-rank gap of
 * 0.0076, so it claimed one rank of influence and had half of one, and a group
 * unanimously asking for New got a film from the wrong year by a margin of
 * 0.3%.
 *
 * Small in absolute terms on purpose too. Every film in this corpus is from
 * 2022 or 2023, so "classic" means one year older, which is not a generation
 * gap. If the corpus ever gains genuinely older films this deserves revisiting,
 * and the group cases in eval.js are where that would show up first.
 */
export const ERA_BONUS = 1 / (RRF_K + 1) - 1 / (RRF_K + 2);

/**
 * Splits the candidate years into "new" and "classic".
 *
 * Derived from the films actually in play rather than hardcoded to 2023,
 * because a hardcoded year silently stops meaning anything the moment the
 * corpus changes. With a single year present, nothing counts as classic and the
 * bonus cancels out of every score, which is the correct degenerate behaviour.
 */
function eraSplit(films) {
  const years = [...new Set(films.map((film) => Number(film.release_year ?? film.releaseYear)))];
  return { newest: Math.max(...years) };
}

/**
 * `people` is one entry per person:
 *
 *   { films: [...ranked best first], era: 'new' | 'classic' | null }
 *
 * Returns every film that appeared for anyone, best first, each carrying the
 * score and the per-person ranks that produced it. Those ranks are kept because
 * a group recommendation nobody can explain is a group recommendation nobody
 * trusts — the eval prints them, and they are what you read when a result looks
 * wrong.
 */
export function fuse(people, { k = RRF_K, eraBonus = ERA_BONUS } = {}) {
  const everyFilm = people.flatMap((person) => person.films);
  if (!everyFilm.length) return [];

  const { newest } = eraSplit(everyFilm);
  const byTitle = new Map();

  for (const [personIndex, person] of people.entries()) {
    for (const [index, film] of person.films.entries()) {
      const rank = index + 1;
      const entry = byTitle.get(film.title) ?? { ...film, score: 0, ranks: [] };

      entry.score += 1 / (k + rank);

      // Era preference is applied per person, alongside that person's rank
      // contribution, so a group split three-to-two on New versus Classic nets
      // out instead of one preference winning outright.
      if (person.era) {
        const isNew = Number(film.release_year ?? film.releaseYear) === newest;
        if ((person.era === 'new') === isNew) entry.score += eraBonus;
      }

      entry.ranks[personIndex] = rank;
      byTitle.set(film.title, entry);
    }
  }

  return [...byTitle.values()].sort(
    // Title as the final tiebreak so an unchanged corpus produces an unchanged
    // order. Without it two films on an identical score swap places between
    // runs and an eval failure becomes unreproducible.
    (a, b) => b.score - a.score || a.title.localeCompare(b.title)
  );
}
