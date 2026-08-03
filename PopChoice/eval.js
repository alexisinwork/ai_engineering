/**
 * Checks that PopChoice recommends the right film. Run: npm run eval
 * Runs automatically after `npm run ingest` (package.json `postingest`).
 *
 * There is no threshold section here, and its absence is the main way this eval
 * differs from the sibling project's. That app answers questions and must be
 * able to refuse, so it lives or dies on a floor below which a result is
 * rejected, and most of its eval measures where that floor sits. PopChoice
 * always recommends: the design has a "Next Movie" button and nine films, so
 * every query returns the whole corpus in some order and the only question that
 * matters is whether the order is right.
 *
 * Six sections, cheapest first:
 *
 *   TIME         pure — the free-text time box
 *   LEAKAGE      pure — no profile may contain a word from its target's title
 *   FUSION       pure — rank.js against hand-built rankings, full order asserted
 *   CONSTRAINTS  the time filter, asserted against what the database returned
 *   PROFILES     one person's taste → the film that should come first
 *   GROUP        several people → the compromise, fusion measured against naive
 *
 * Node only, but it connects with the *publishable* key, so it goes through the
 * same RLS policy and EXECUTE grant the browser does. An eval running as
 * service_role could pass while the real app returned nothing.
 */
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { MODEL } from './embeddingModel.js';
import { fuse, RRF_K, ERA_BONUS } from './rank.js';
import { recommend, profileText } from './recommend.js';
import { parseMinutes } from './time.js';
import movies from './movies.js';

/**
 * One person's answers, and the film that should come out first.
 *
 * Written the way the form is actually filled in — a favourite film and a
 * reason, a mood, a person to be stranded with — rather than as keyword queries.
 * A labelled set that tested "Norwegian monster movie" would be measuring a
 * question nobody asks and would pass while the real form failed.
 *
 * Two per film, eighteen in total. Seven was too few to read: one case was 14
 * percentage points of accuracy, against an 11% chance of hitting the right film
 * out of nine at random, so a single flaky result was indistinguishable from a
 * regression.
 *
 * Nothing here may contain a word from its target's title — enforced by the
 * LEAKAGE section rather than trusted, because two of the original seven leaked
 * and neither was obvious on reading. "I loved Titanic for how immersive the
 * **water** felt" pointed at *The Way of the **Water***, and "a stunt
 * choreographer from a **South Indian** action set" pointed at the one South
 * Indian film in the corpus. Both would have passed on a broken matcher.
 *
 * Nationality and origin labels are avoided for the same reason even though they
 * are not in any title: "Bollywood", "Norwegian" and "South Indian" each single
 * out exactly one film, so using one tests a keyword match rather than a taste.
 * Plot description is fair game — that is what a person actually types.
 */
const PROFILES = [
  {
    want: 'Troll',
    person: {
      favourite: 'I loved Jurassic Park because a giant creature smashing through a city is pure spectacle.',
      mood: 'Scary',
      era: null,
      strandedWith: 'A creature effects artist, because they would have the best stories.',
    },
  },
  {
    want: 'Troll',
    person: {
      favourite: 'Something with an enormous monster waking up after centuries and heading for a capital.',
      mood: 'Scary',
      era: null,
      strandedWith: 'A special effects supervisor.',
    },
  },
  {
    want: 'Oppenheimer',
    person: {
      favourite: "I loved Schindler's List for showing an enormous moment in history through one man's conscience.",
      mood: 'Serious',
      era: null,
      strandedWith: 'A theoretical physicist, so we could argue about the ethics of what they build.',
    },
  },
  {
    want: 'Oppenheimer',
    person: {
      favourite: 'A long, heavy biography of a scientist whose work changed the century.',
      mood: 'Serious',
      era: null,
      strandedWith: 'A historian of the 1940s.',
    },
  },
  {
    want: 'The Fabelmans',
    person: {
      favourite: 'I loved Cinema Paradiso — a boy falling in love with movies and it changing his family.',
      mood: 'Inspiring',
      era: null,
      strandedWith: 'A director who could teach me how films get made.',
    },
  },
  {
    want: 'The Fabelmans',
    person: {
      favourite: 'Something autobiographical about growing up and discovering what you want to do with your life.',
      mood: 'Inspiring',
      era: null,
      strandedWith: 'A cinematographer.',
    },
  },
  {
    want: 'Barbie',
    person: {
      favourite: 'I loved Legally Blonde — bright, funny, and secretly about not being taken seriously.',
      mood: 'Fun',
      era: null,
      strandedWith: 'A comedian who could keep things light.',
    },
  },
  {
    want: 'Barbie',
    person: {
      favourite: 'Something pink and hilarious that turns out to be about existential doubt.',
      mood: 'Fun',
      era: null,
      strandedWith: 'A comic actor with impeccable timing.',
    },
  },
  {
    want: 'Everything Everywhere All at Once',
    person: {
      favourite: 'I loved Eternal Sunshine — someone confronting the lives they could have lived.',
      mood: 'Inspiring',
      era: null,
      strandedWith: 'Someone chaotic who does martial arts.',
    },
  },
  {
    want: 'Everything Everywhere All at Once',
    person: {
      favourite: 'A story about parallel lives and the person you might have become, absurd and moving at the same time.',
      mood: 'Inspiring',
      era: null,
      strandedWith: 'A stunt performer who is also very funny.',
    },
  },
  {
    want: 'Avatar: The Way of the Water',
    person: {
      favourite: 'I loved Titanic for how vast and immersive it felt on a big screen.',
      mood: 'Fun',
      era: null,
      strandedWith: 'A concept artist who designs alien worlds.',
    },
  },
  {
    want: 'Avatar: The Way of the Water',
    person: {
      favourite: 'Something set on another moon with an invented species and enormous landscapes.',
      mood: 'Fun',
      era: null,
      strandedWith: 'A world-builder.',
    },
  },
  {
    want: 'RRR',
    person: {
      favourite: 'I loved Braveheart — two men rebelling against an empire, and it runs for hours.',
      mood: 'Serious',
      era: null,
      strandedWith: 'A stunt choreographer who works on enormous action set pieces.',
    },
  },
  {
    want: 'RRR',
    person: {
      favourite: 'An epic about friendship and revolution in the 1920s, and I do not mind a long runtime.',
      mood: 'Serious',
      era: null,
      strandedWith: 'A fight choreographer.',
    },
  },
  {
    want: 'Spider-Man: Across the Spider-Verse',
    person: {
      favourite: 'I love bold animated films where the art style changes from scene to scene.',
      mood: 'Fun',
      era: null,
      strandedWith: 'An illustrator.',
    },
  },
  {
    want: 'Spider-Man: Across the Spider-Verse',
    person: {
      favourite: 'An animated superhero story about a teenager working out what being a hero means.',
      mood: 'Fun',
      era: null,
      strandedWith: 'A comic book artist.',
    },
  },
  {
    want: 'Pathaan',
    person: {
      favourite: 'I love slick spy thrillers where an agent races a countdown to stop a catastrophe.',
      mood: 'Fun',
      era: null,
      strandedWith: 'A stunt driver.',
    },
  },
  {
    want: 'Pathaan',
    person: {
      favourite: 'A glossy action blockbuster with a vengeful mercenary villain threatening a whole country.',
      mood: 'Fun',
      era: null,
      strandedWith: 'An action director.',
    },
  },
];

/**
 * Groups, and the film the fusion should land on.
 *
 * Each case is built so the right answer is a *compromise* — no group here has a
 * unanimous favourite, because a group that agrees does not test anything a
 * single profile does not.
 */
const GROUPS = [
  {
    label: 'animation fan + comedy fan + someone who wants spectacle',
    want: 'Spider-Man: Across the Spider-Verse',
    people: [
      {
        favourite: 'I love bold animated films where the art style is the whole point.',
        mood: 'Fun',
        era: 'new',
        strandedWith: 'An illustrator.',
      },
      {
        favourite: 'I want something funny and colourful that does not take itself seriously.',
        mood: 'Fun',
        era: 'new',
        strandedWith: 'A stand-up comic.',
      },
      {
        favourite: 'I love superhero films with huge set pieces.',
        mood: 'Fun',
        era: 'new',
        strandedWith: 'A stunt performer.',
      },
    ],
  },
  {
    label: 'history buff + drama fan, both serious',
    want: 'Oppenheimer',
    people: [
      {
        favourite: 'I love films about real historical figures and the weight of their decisions.',
        mood: 'Serious',
        era: 'new',
        strandedWith: 'A historian.',
      },
      {
        favourite: 'I want a heavy character drama with a long running time.',
        mood: 'Serious',
        era: 'new',
        strandedWith: 'A biographer.',
      },
    ],
  },
  {
    /*
     * Three tastes with nothing in common, and deliberately no expected title.
     *
     * This is where averaging is supposed to fail: a single vector carrying
     * "monster horror" and "bright cartoon" and "sombre historical drama" has
     * no neighbourhood to land in. Naming a winner here would be inventing one
     * — there is no obviously right answer for this group, which is the point.
     * What can be asserted is the property fusion promises: whatever wins must
     * not be somebody's least favourite.
     */
    label: 'horror fan + animation fan + drama fan, nothing in common',
    want: null,
    people: [
      {
        favourite: 'I want to be frightened — something enormous and hostile crashing through a town.',
        mood: 'Scary',
        era: null,
        strandedWith: 'A horror director.',
      },
      {
        favourite: 'I want something bright and animated I could happily watch with a child.',
        mood: 'Fun',
        era: null,
        strandedWith: 'A voice actor.',
      },
      {
        favourite: 'I want a sombre, slow character study about real events.',
        mood: 'Serious',
        era: null,
        strandedWith: 'A documentary maker.',
      },
    ],
  },
];

/**
 * Time-filter cases. `eligible` is what the corpus says should qualify; the
 * assertion is made against what the *database* returned.
 */
const CONSTRAINTS = [
  { minutes: 200, eligible: 9, relaxed: false, label: 'a long evening admits everything' },
  // 5, not 6: The Fabelmans is 151 minutes and misses by one.
  { minutes: 150, eligible: 5, relaxed: false, label: 'two and a half hours cuts the long films' },
  { minutes: 115, eligible: 2, relaxed: false, label: 'under two hours leaves only the two shortest' },
  { minutes: 90, eligible: 0, relaxed: true, label: 'nothing is that short, so the limit gives way' },
];

const {
  VITE_OPENAI_API_KEY: openaiKey,
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
} = process.env;

const missing = Object.entries({
  VITE_OPENAI_API_KEY: openaiKey,
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length) {
  console.error(`Missing env var(s): ${missing.join(', ')}\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

const openai = new OpenAI({ apiKey: openaiKey });
const supabase = createClient(supabaseUrl, publishableKey);

const failures = [];
const heading = (text) => console.log(`\n${'='.repeat(70)}\n${text}\n${'='.repeat(70)}\n`);

/**
 * The free-text time box.
 *
 * `null` and `NaN` are asserted separately on purpose: an empty box means no
 * limit and unparseable text means tell the user. Collapsing them is how "ages"
 * silently becomes "no limit".
 */
function evaluateTimeParsing() {
  heading('TIME — reading the free-text time box');

  const cases = [
    ['', null, 'empty means no limit'],
    ['2 hours', 120, 'hours in words'],
    ['2h', 120, 'hours abbreviated'],
    ['1 hr 30 min', 90, 'hours and minutes'],
    ['1h30', 90, 'no space'],
    ['90 min', 90, 'minutes in words'],
    ['90', 90, 'bare number, big enough to be minutes'],
    ['2', 120, 'bare number, small enough to be hours'],
    ['12', 720, 'the boundary is inclusive of hours'],
    ['13', 13, 'above the boundary is minutes'],
    ['45 minutes', 45, 'minutes spelled out'],
    ['ages', NaN, 'unparseable is not the same as unlimited'],
  ];

  let correct = 0;
  for (const [input, want, label] of cases) {
    const got = parseMinutes(input);
    const ok = Number.isNaN(want) ? Number.isNaN(got) : got === want;
    if (ok) correct++;
    else failures.push(`time (${label}): ${JSON.stringify(input)} -> ${got}, expected ${want}`);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${JSON.stringify(input).padEnd(14)} -> ${String(got).padEnd(4)}  ${label}`);
  }

  console.log(`\naccuracy   ${correct}/${cases.length}`);
}

/**
 * Words too common to identify a film. Kept deliberately short: the guard is
 * meant to be slightly over-eager, because a false alarm costs one rephrasing
 * and a miss costs a test that passes on a broken matcher.
 */
const TITLE_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'at', 'and', 'in', 'on', 'to', 'all', 'once', 'man']);

/**
 * Origin and nationality labels, each of which singles out one film in this
 * corpus and none of which belongs in a description of taste.
 *
 * A curated list rather than something derived, because the derived version
 * does not work: plenty of legitimate plot words appear in exactly one record
 * too — "revolutionaries" only in RRR, "multiverse" only in the animated one —
 * and those are what a person actually types. The difference is that "South
 * Indian" describes where a film is *from*, which nobody offers when asked
 * their favourite film and why.
 *
 * This exists because the title check alone did not catch the second leak the
 * review found: "a stunt choreographer from a South Indian action set" contains
 * no word from "RRR", and would have gone on passing.
 */
const ORIGIN_LABELS = ['norwegian', 'bollywood', 'south indian', 'indian', 'chinese', 'american'];

/**
 * No profile may contain a word from the title of the film it is aiming at.
 *
 * This is the trap that makes recommender test sets look better than they are.
 * A profile mentioning "water" retrieves *The Way of the Water* on the token
 * alone, scores a pass, and proves nothing about whether taste matching works —
 * it would still pass if the embeddings were replaced with keyword search, or
 * with noise plus a title index.
 *
 * Free, so there is no reason not to run it on every profile every time rather
 * than relying on whoever adds the next one to remember.
 */
function evaluateLeakage() {
  heading('LEAKAGE — no profile may name its target or where it is from');

  const words = (text) => String(text).toLowerCase().match(/[a-z0-9']+/g) ?? [];
  let clean = 0;

  for (const { want, person } of PROFILES) {
    const text = profileText(person).toLowerCase();
    const titleWords = new Set(words(want).filter((word) => !TITLE_STOPWORDS.has(word) && word.length > 2));
    const profileWords = new Set(words(text));

    const leaked = [
      ...[...titleWords].filter((word) => profileWords.has(word)).map((word) => `title:${word}`),
      ...ORIGIN_LABELS.filter((label) => text.includes(label)).map((label) => `origin:${label}`),
    ];

    if (leaked.length) failures.push(`leakage (${want}): profile contains ${leaked.join(', ')}`);
    else clean++;

    console.log(`  ${leaked.length ? 'FAIL' : 'ok  '}  ${want}${leaked.length ? `  <- ${leaked.join(', ')}` : ''}`);
  }

  console.log(`\nclean      ${clean}/${PROFILES.length}`);
}

/**
 * rank.js with hand-built inputs. Free, instant, and the only section that can
 * fail for a reason that is purely a bug rather than a model's judgement.
 *
 * Every case asserts the **whole order**, not just the winner. ERA_BONUS claims
 * to be worth exactly one rank position and no more, and that claim is entirely
 * about positions two and below — checking only first place cannot see it
 * working and cannot see it break.
 */
function evaluateFusion() {
  heading('FUSION — rank.js against known rankings');

  const film = (title, year) => ({ title, release_year: year });
  const A = film('A', 2023);
  const B = film('B', 2023);
  const C = film('C', 2022);
  const D = film('D', 2022);
  const E = film('E', 2022);

  const cases = [
    {
      // The property fusion exists for. A is adored by one person and bottom
      // for the other two; B is everyone's second choice. B should win.
      //
      // An earlier version put A first for *two* of three people and expected B
      // anyway, which is not the property — a majority favourite should win,
      // and it did. Three films left no room to separate "one person's
      // favourite" from "most people's favourite".
      label: "broad second place beats one person's favourite",
      people: [
        { films: [A, B, C, D, E], era: null },
        { films: [C, B, D, E, A], era: null },
        { films: [D, B, C, E, A], era: null },
      ],
      want: ['B', 'C', 'D'],
    },
    {
      // The mirror of the above: a majority favourite is not a compromise and
      // should not be treated as one.
      label: 'a favourite shared by most people still wins',
      people: [
        { films: [A, B, C], era: null },
        { films: [C, B, A], era: null },
        { films: [C, B, A], era: null },
      ],
      want: ['C', 'B', 'A'],
    },
    {
      label: 'unanimous favourite wins outright',
      people: [
        { films: [A, B, C], era: null },
        { films: [A, C, B], era: null },
      ],
      want: ['A'],
    },
    {
      label: 'era preference breaks a tie',
      people: [
        { films: [A, C], era: 'new' },
        { films: [C, A], era: 'new' },
      ],
      want: ['A', 'C'],
    },
    {
      // The claim ERA_BONUS makes, asserted where it is visible. A is preferred
      // by two clear ranks and holds first; C is the only film matching the
      // stated era and moves third to second. One position, exactly.
      label: 'era lifts a film one place and cannot take first',
      people: [
        { films: [A, B, C], era: 'classic' },
        { films: [A, B, C], era: 'classic' },
      ],
      want: ['A', 'C', 'B'],
    },
    {
      // ...and no further than one place, with a longer list to move through.
      label: 'era lifts one place and no more',
      people: [
        { films: [A, B, C, D], era: 'classic' },
        { films: [A, B, C, D], era: 'classic' },
      ],
      want: ['A', 'C', 'B', 'D'],
    },
    { label: 'no people, no ranking', people: [], want: [] },
  ];

  let correct = 0;
  for (const { label, people, want } of cases) {
    const order = fuse(people).map((entry) => entry.title);
    const got = order.slice(0, want.length);
    const ok = got.length === want.length && got.every((title, index) => title === want[index]);

    if (ok) correct++;
    else failures.push(`fusion (${label}): got [${order.join(' ')}], expected [${want.join(' ')}] as prefix`);

    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  [${order.join(' ') || '—'}]${ok ? '' : `  want [${want.join(' ')}]`}`);
    console.log(`        ${label}`);
  }

  console.log(`\nk          ${RRF_K}`);
  console.log(`era bonus  ${ERA_BONUS.toFixed(6)}  (one rank position at k=${RRF_K})`);
  console.log(`accuracy   ${correct}/${cases.length}`);
}

/**
 * The time filter, asserted against what the database actually returned.
 *
 * An earlier version computed the expected count locally from movies.js and
 * compared it to the constant in the case — arithmetic over a fixed array,
 * checking nothing the database did. Break the SQL filter so it ignores
 * max_runtime and returns all nine at a 115-minute limit, and that version still
 * read 2 === 2 and passed. The only things it took from the real call were the
 * relaxed flag and a non-empty result.
 *
 * What is asserted now:
 *
 *   limit held     every returned film is within the limit, and the number
 *                  returned equals the number that should have qualified
 *   limit relaxed  the whole corpus comes back, and nothing qualified
 */
async function evaluateConstraints() {
  heading('CONSTRAINTS — the time filter, checked against the database');

  const person = {
    favourite: 'Something exciting.',
    mood: 'Fun',
    era: null,
    strandedWith: 'Anyone good company.',
  };

  let correct = 0;
  for (const { minutes, eligible, relaxed: wantRelaxed, label } of CONSTRAINTS) {
    const { ranking, relaxed } = await recommend(openai, supabase, { people: [person], minutes });

    const over = ranking.filter((film) => film.runtime_minutes > minutes);
    const problems = [];

    if (relaxed !== wantRelaxed) problems.push(`relaxed=${relaxed}, expected ${wantRelaxed}`);

    if (relaxed) {
      if (ranking.length !== movies.length) {
        problems.push(`relaxed but returned ${ranking.length} of ${movies.length}`);
      }
      if (eligible !== 0) problems.push(`relaxed although ${eligible} film(s) qualified`);
    } else {
      if (over.length) {
        problems.push(
          `returned ${over.length} film(s) over the limit (${over
            .map((film) => `${film.title} ${film.runtime_minutes}m`)
            .join(', ')})`
        );
      }
      if (ranking.length !== eligible) {
        problems.push(`returned ${ranking.length}, expected ${eligible}`);
      }
    }

    const ok = problems.length === 0;
    if (ok) correct++;
    else failures.push(`constraints (${label}): ${problems.join('; ')}`);

    const longest = ranking.length ? Math.max(...ranking.map((film) => film.runtime_minutes)) : 0;
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'}  ${String(minutes).padStart(3)} min -> db returned ${String(ranking.length).padStart(2)}, ` +
        `longest ${String(longest).padStart(3)}m, ${relaxed ? 'limit relaxed' : 'limit held  '}   ${label}`
    );
    if (!ok) console.log(`        ${problems.join('; ')}`);
  }

  console.log(`\naccuracy   ${correct}/${CONSTRAINTS.length}`);
}

/**
 * How many profiles put their film first, measured rather than hoped for.
 *
 * This was 18/18 before the LEAKAGE section existed, and three of those passes
 * were bought with leaked tokens: "water" pointing at *The Way of the Water*,
 * "South Indian" at the one South Indian film, "the bomb" at Oppenheimer. With
 * the tokens gone all three land second, behind a film the corpus genuinely
 * confuses them with — Oppenheimer behind another wartime-adjacent drama, RRR
 * behind the other Indian action epic.
 *
 * The temptation was to write those three profiles more sharply until they went
 * green again. That is tuning the measurement to the answer, and it is exactly
 * how the leak got in the first time. So the number is recorded as what it is.
 *
 * Two assertions instead of one, because they fail for different reasons:
 *
 *   every target in the top two   a taste landing third or worse is a matching
 *                                 bug; the corpus is not large enough for the
 *                                 right film to be that far down by accident
 *   at least PROFILE_BASELINE #1  a regression guard on a real measurement,
 *                                 not an aspiration
 */
const PROFILE_BASELINE = 15;

/** Third or worse is a bug, not an ambiguity, on a nine-film corpus. */
const PROFILE_MAX_RANK = 2;

async function evaluateProfiles() {
  heading('PROFILES — one person, which film comes first');

  let correct = 0;
  const positions = [];

  for (const { want, person } of PROFILES) {
    const { ranking } = await recommend(openai, supabase, { people: [person], minutes: null });
    const position = ranking.findIndex((film) => film.title === want) + 1;
    const first = position === 1;
    if (first) correct++;
    positions.push(position || ranking.length);

    // Only a genuinely bad placement is a per-case failure. Second place is
    // reported and counted, and shows up in the aggregate below.
    if (!position || position > PROFILE_MAX_RANK) {
      failures.push(
        `profile (${want}): came ${position || 'nowhere'} of ${ranking.length}, ` +
          `top was "${ranking[0]?.title}"`
      );
    }

    const mark = first ? 'ok  ' : position <= PROFILE_MAX_RANK ? 'near' : 'FAIL';
    console.log(`  ${mark}  #${position || '-'}  ${want}`);
    if (!first) console.log(`        got: ${ranking.slice(0, 3).map((film) => film.title).join(', ')}`);
  }

  // Mean rank is printed even when everything passes, because it degrades
  // before accuracy does: targets drifting from first to a consistent second is
  // invisible to a pass/fail count and obvious here.
  const mean = positions.reduce((sum, value) => sum + value, 0) / positions.length;

  if (correct < PROFILE_BASELINE) {
    failures.push(
      `profiles: ${correct}/${PROFILES.length} came first, below the recorded ` +
        `baseline of ${PROFILE_BASELINE} — taste matching has regressed`
    );
  }

  console.log(`\nfirst      ${correct}/${PROFILES.length}  (baseline ${PROFILE_BASELINE}; chance is about 1 in ${movies.length})`);
  console.log(`mean rank  ${mean.toFixed(2)}  (worst allowed per profile: ${PROFILE_MAX_RANK})`);
}

/**
 * The group cases, run twice — once through fusion and once the naive way.
 *
 * rank.js exists on the claim that pasting everyone's answers into one block and
 * embedding it once lands near the centre of the space and close to nothing.
 * That claim was written in a comment and never tested, which made it an opinion
 * with a citation. Here the naive approach is actually built — one synthetic
 * person carrying the concatenated text, through the same retrieval path — and
 * measured against the real one.
 *
 * Fusion is required to do at least as well. If the naive version ever wins,
 * the premise this whole file is arranged around is wrong and should fail
 * loudly rather than be defended in a comment.
 */
async function evaluateGroups() {
  heading('GROUP — several people, fusion measured against naive concatenation');

  let fusedFirst = 0;
  let naiveFirst = 0;
  let expected = 0;
  let fairnessWins = 0;
  let fairnessLosses = 0;

  for (const { label, want, people } of GROUPS) {
    const { ranking } = await recommend(openai, supabase, { people, minutes: null });

    // The alternative rank.js rejects: everyone's answers as one blob, one
    // embedding, one search. Built for real rather than described in a comment.
    const blob = { favourite: people.map(profileText).join(' '), era: null, mood: null, strandedWith: '' };
    const { ranking: naiveRanking } = await recommend(openai, supabase, { people: [blob], minutes: null });

    const fusedTop = ranking[0];
    const naiveTop = naiveRanking[0];

    // The fused ranking carries every film with its per-person ranks, so the
    // naive winner's ranks can be read straight out of it — no extra calls.
    const naiveAsFused = ranking.find((film) => film.title === naiveTop.title);

    const worst = (entry) => (entry?.ranks?.length ? Math.max(...entry.ranks) : Infinity);
    const fusedWorst = worst(fusedTop);
    const naiveWorst = worst(naiveAsFused);

    if (want) {
      expected++;
      const position = ranking.findIndex((film) => film.title === want) + 1;
      if (position === 1) fusedFirst++;
      else failures.push(`group (${label}): "${want}" came ${position || 'nowhere'}, top was "${fusedTop.title}"`);
      if (naiveRanking.findIndex((film) => film.title === want) + 1 === 1) naiveFirst++;
      console.log(`  ${position === 1 ? 'ok  ' : 'FAIL'}  #${position || '-'}  ${want}`);
    } else {
      console.log(`  ----  (no expected title — fairness only)`);
    }

    /*
     * The property fusion actually promises, and the one naive concatenation
     * cannot: the winner should not be a film somebody in the group ranked near
     * the bottom. "Worst rank" is how far down the winner sits for the person
     * who liked it least, so lower is fairer.
     *
     * This is asserted as a comparison rather than an absolute, because what
     * counts as an acceptable worst rank depends on the group. Fusion is
     * required only to be no less fair than the blob.
     */
    if (fusedWorst < naiveWorst) fairnessWins++;
    if (fusedWorst > naiveWorst) {
      fairnessLosses++;
      failures.push(
        `group (${label}): the fused pick "${fusedTop.title}" sits at rank ${fusedWorst} for its ` +
          `least keen person, worse than naive's "${naiveTop.title}" at ${naiveWorst} — ` +
          `fusion is supposed to be the fairer of the two`
      );
    }

    console.log(`        ${people.length} people — ${label}`);
    console.log(
      `        fusion: ${fusedTop.title} [${fusedTop.ranks.join(',')}] worst ${fusedWorst}`
    );
    console.log(
      `        naive : ${naiveTop.title} [${naiveAsFused?.ranks.join(',') ?? '?'}] worst ${naiveWorst}` +
        `${naiveTop.title === fusedTop.title ? '   (same pick)' : ''}`
    );
  }

  if (expected && naiveFirst > fusedFirst) {
    failures.push(
      `group: naive concatenation matched ${naiveFirst}/${expected} expected titles against fusion's ` +
        `${fusedFirst}/${expected} — the premise rank.js is built on does not hold on these cases`
    );
  }

  console.log(`\nfusion     ${fusedFirst}/${expected} expected titles`);
  console.log(`naive      ${naiveFirst}/${expected}  (must not beat fusion)`);
  console.log(
    `fairness   fusion strictly fairer on ${fairnessWins}/${GROUPS.length}, ` +
      `less fair on ${fairnessLosses}`
  );
}

async function main() {
  const { count, error } = await supabase
    .from('popchoice_movies')
    .select('id', { count: 'exact', head: true });

  if (error) throw error;

  // Both of these stop the run rather than recording a failure and carrying on.
  // Every later section reads from this table, so a wrong corpus produces a
  // cascade of confident-looking failures stacked on top of the real cause.
  if (!count) {
    console.error('No films stored. Run `npm run ingest` first.');
    process.exit(1);
  }
  if (count !== movies.length) {
    console.error(
      `${count} film(s) stored but movies.js has ${movies.length}. ` +
        'Run `npm run ingest` — every section below reads from this table.'
    );
    process.exit(1);
  }

  evaluateTimeParsing();
  evaluateLeakage();
  evaluateFusion();
  await evaluateConstraints();
  await evaluateProfiles();
  await evaluateGroups();

  console.log(`\nmodel      ${MODEL}`);
  console.log(`corpus     ${count} films`);

  if (failures.length) {
    console.error(`\n${'='.repeat(70)}\nFAIL`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    '\nOK — the filter holds and gives way, fusion is no less fair than the blob, ' +
      `and ${PROFILE_BASELINE}+ of ${PROFILES.length} tastes land on their film with none below rank ${PROFILE_MAX_RANK}.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
