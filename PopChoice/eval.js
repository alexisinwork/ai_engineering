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
 * Four sections, cheapest first:
 *
 *   FUSION       pure, no network — rank.js against hand-built rankings
 *   CONSTRAINTS  the time filter, including the case where it empties the corpus
 *   PROFILES     one person's taste → the film that should come first
 *   GROUP        several people → the compromise that should come first
 *
 * Node only, but it connects with the *publishable* key, so it goes through the
 * same RLS policy and EXECUTE grant the browser does. An eval running as
 * service_role could pass while the real app returned nothing.
 */
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { MODEL } from './embeddingModel.js';
import { fuse, RRF_K } from './rank.js';
import { recommend } from './recommend.js';
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
 * Deliberately never names the target film or anything unique to its record.
 * "I loved Into the Spider-Verse" would retrieve Across the Spider-Verse on the
 * title alone and prove nothing about whether taste matching works.
 */
const PROFILES = [
  {
    want: 'Troll',
    person: {
      favourite: 'I loved Jurassic Park because a giant creature tearing through everything is pure spectacle.',
      mood: 'Scary',
      era: null,
      strandedWith: 'A creature effects artist, because they would have the best stories.',
    },
  },
  {
    want: 'Oppenheimer',
    person: {
      favourite: 'I loved Schindler\'s List for showing an enormous moment in history through one man\'s conscience.',
      mood: 'Serious',
      era: null,
      strandedWith: 'A physicist, so we could argue about ethics and the bomb.',
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
    want: 'Barbie',
    person: {
      favourite: 'I loved Legally Blonde — bright, funny, and secretly about not being taken seriously.',
      mood: 'Fun',
      era: null,
      strandedWith: 'A comedian who could keep things light.',
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
    want: 'Avatar: The Way of the Water',
    person: {
      favourite: 'I loved Titanic for how enormous and immersive the water felt on a big screen.',
      mood: 'Fun',
      era: null,
      strandedWith: 'A marine biologist, given the island.',
    },
  },
  {
    want: 'RRR',
    person: {
      favourite: 'I loved Braveheart — two men rebelling against an empire, and it goes on for hours.',
      mood: 'Serious',
      era: null,
      strandedWith: 'A stunt choreographer from a South Indian action set.',
    },
  },
];

/**
 * Groups, and the film the fusion should land on.
 *
 * These are the point of the stretch goal, and the reason fusion exists rather
 * than pasting everyone's answers into one query. Each case is built so the
 * right answer is a *compromise* — no group here has a unanimous favourite,
 * because a group that agrees does not test anything a single profile does not.
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
];

/**
 * Time-filter cases. No embeddings, no chat — just which films the SQL filter
 * admits, and what happens when it admits none.
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
 * The free-text time box. Free and instant, like FUSION.
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
 * rank.js with hand-built inputs. Free, instant, and the only section that can
 * fail for a reason that is purely a bug rather than a model's judgement.
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
      // An earlier version of this case put A first for *two* of three people
      // and expected B anyway, which is not the property — a majority
      // favourite should win, and it did. Three films left no room to separate
      // "one person's favourite" from "most people's favourite".
      label: "broad second place beats one person's favourite",
      people: [
        { films: [A, B, C, D, E], era: null },
        { films: [C, B, D, E, A], era: null },
        { films: [D, B, C, E, A], era: null },
      ],
      want: 'B',
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
      want: 'C',
    },
    {
      label: 'unanimous favourite wins outright',
      people: [
        { films: [A, B, C], era: null },
        { films: [A, C, B], era: null },
      ],
      want: 'A',
    },
    {
      label: 'era preference breaks a tie',
      people: [
        { films: [A, C], era: 'new' },
        { films: [C, A], era: 'new' },
      ],
      want: 'A',
    },
    {
      label: 'era preference cannot overturn a clear win',
      people: [
        { films: [A, B, C], era: 'classic' },
        { films: [A, B, C], era: 'classic' },
      ],
      want: 'A',
    },
    { label: 'no people, no ranking', people: [], want: null },
  ];

  let correct = 0;
  for (const { label, people, want } of cases) {
    const ranking = fuse(people);
    const got = ranking[0]?.title ?? null;
    const ok = got === want;
    if (ok) correct++;
    else failures.push(`fusion (${label}): got ${got ?? 'nothing'}, expected ${want ?? 'nothing'}`);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${(got ?? '—').padEnd(4)} ${label}`);
  }

  console.log(`\nk          ${RRF_K}`);
  console.log(`accuracy   ${correct}/${cases.length}`);
}

async function evaluateConstraints() {
  heading('CONSTRAINTS — the time filter');

  const person = {
    favourite: 'Something exciting.',
    mood: 'Fun',
    era: null,
    strandedWith: 'Anyone good company.',
  };

  let correct = 0;
  for (const { minutes, eligible, relaxed: wantRelaxed, label } of CONSTRAINTS) {
    const { ranking, relaxed } = await recommend(openai, supabase, { people: [person], minutes });

    // When the limit gives way every film comes back, so the count to check is
    // how many *would* have qualified, not how many were returned.
    const within = movies.filter((film) => film.runtimeMinutes <= minutes).length;
    const ok = within === eligible && relaxed === wantRelaxed && ranking.length > 0;

    if (ok) correct++;
    else {
      failures.push(
        `constraints (${label}): ${within} eligible (expected ${eligible}), ` +
          `relaxed=${relaxed} (expected ${wantRelaxed}), ${ranking.length} returned`
      );
    }

    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'}  ${String(minutes).padStart(3)} min -> ${within} eligible, ` +
        `${relaxed ? 'limit relaxed' : 'limit held  '}, ${ranking.length} ranked   ${label}`
    );
  }

  console.log(`\naccuracy   ${correct}/${CONSTRAINTS.length}`);
}

async function evaluateProfiles() {
  heading('PROFILES — one person, which film comes first');

  let correct = 0;
  for (const { want, person } of PROFILES) {
    const { ranking } = await recommend(openai, supabase, { people: [person], minutes: null });
    const position = ranking.findIndex((film) => film.title === want) + 1;
    const ok = position === 1;
    if (ok) correct++;
    else {
      failures.push(
        `profile (${want}): came ${position || 'nowhere'}, top was "${ranking[0]?.title}"`
      );
    }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  #${position || '-'}  ${want}`);
    if (!ok) console.log(`        got: ${ranking.slice(0, 3).map((f) => f.title).join(', ')}`);
  }

  console.log(`\naccuracy   ${correct}/${PROFILES.length}`);
}

async function evaluateGroups() {
  heading('GROUP — several people, which compromise comes first');

  let correct = 0;
  for (const { label, want, people } of GROUPS) {
    const { ranking } = await recommend(openai, supabase, { people, minutes: null });
    const position = ranking.findIndex((film) => film.title === want) + 1;
    const ok = position === 1;
    if (ok) correct++;
    else failures.push(`group (${label}): "${want}" came ${position || 'nowhere'}, top was "${ranking[0]?.title}"`);

    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  #${position || '-'}  ${want}`);
    console.log(`        ${people.length} people — ${label}`);
    console.log(
      `        top 3: ${ranking
        .slice(0, 3)
        .map((film) => `${film.title} [${film.ranks.join(',')}]`)
        .join('  ')}`
    );
  }

  console.log(`\naccuracy   ${correct}/${GROUPS.length}`);
}

async function main() {
  const { count, error } = await supabase
    .from('popchoice_movies')
    .select('id', { count: 'exact', head: true });

  if (error) throw error;
  if (!count) {
    console.error('No films stored. Run `npm run ingest` first.');
    process.exit(1);
  }
  if (count !== movies.length) {
    failures.push(`${count} film(s) stored but movies.js has ${movies.length} — run \`npm run ingest\``);
  }

  evaluateTimeParsing();
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

  console.log('\nOK — fusion behaves, the time filter holds and gives way, and every taste lands on its film.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
