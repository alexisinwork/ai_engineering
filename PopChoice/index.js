/**
 * Screens, state and rendering. No API calls and no ranking logic — those live
 * in recommend.js and rank.js, which is what lets eval.js exercise them without
 * a browser.
 *
 * The state is three values: how many people, how long they have, and what each
 * person answered. Everything on screen is derived from those, so there is no
 * way for the display and the data to disagree.
 */
import openai from './config.js';
import supabase from './supabaseClient.js';
import { recommend, pitch } from './recommend.js';
import { relaxedTimeNote } from './chatModel.js';
import { parseMinutes } from './time.js';

const screens = {
  setup: document.getElementById('screen-setup'),
  person: document.getElementById('screen-person'),
  result: document.getElementById('screen-result'),
};

const setupForm = document.getElementById('setup-form');
const setupError = document.getElementById('setup-error');
const personForm = document.getElementById('person-form');
const personError = document.getElementById('person-error');
const personCounter = document.getElementById('person-counter');
const personSubmit = document.getElementById('person-submit');
const favourite = document.getElementById('favourite');
const stranded = document.getElementById('stranded');
const filmTitle = document.getElementById('film-title');
const filmPoster = document.getElementById('film-poster');
const posterFallback = document.getElementById('poster-fallback');
const fallbackTitle = document.getElementById('fallback-title');
const fallbackYear = document.getElementById('fallback-year');
const filmPitch = document.getElementById('film-pitch');
const resultNote = document.getElementById('result-note');
const nextMovie = document.getElementById('next-movie');
const startOver = document.getElementById('start-over');

const state = {
  total: 1,
  minutes: null,
  people: [],
  current: 0,
  ranking: [],
  shown: 0,
  relaxed: false,
  shortest: null,
};

function show(name) {
  for (const [key, element] of Object.entries(screens)) element.hidden = key !== name;
  window.scrollTo(0, 0);
}

function setError(element, message) {
  element.textContent = message ?? '';
  element.hidden = !message;
}

function renderCounter() {
  personCounter.textContent = String(state.current + 1);
  personSubmit.textContent = state.current + 1 === state.total ? 'Get Movie' : 'Next Person';
}

function clearPersonForm() {
  favourite.value = '';
  stranded.value = '';
  for (const chip of personForm.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', 'false');
  }
  setError(personError, null);
}

function selected(group) {
  const chip = personForm.querySelector(`.chip[data-group="${group}"][aria-pressed="true"]`);
  return chip?.dataset.value ?? null;
}

// Chips are radio groups made of buttons, so pressing one has to clear its
// siblings. aria-pressed carries both the styling and the accessible state, so
// there is only one thing to keep in step.
personForm.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;

  const group = chip.dataset.group;
  for (const sibling of personForm.querySelectorAll(`.chip[data-group="${group}"]`)) {
    sibling.setAttribute('aria-pressed', String(sibling === chip));
  }
});

setupForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const total = Number(document.getElementById('people').value);
  if (!Number.isInteger(total) || total < 1 || total > 8) {
    setError(setupError, 'How many people? Enter a number from 1 to 8.');
    return;
  }

  const minutes = parseMinutes(document.getElementById('minutes').value);
  if (Number.isNaN(minutes)) {
    setError(setupError, "Couldn't read that time — try “2 hours” or “90 min”.");
    return;
  }

  setError(setupError, null);
  state.total = total;
  state.minutes = minutes;
  state.people = [];
  state.current = 0;

  clearPersonForm();
  renderCounter();
  show('person');
});

personForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const person = {
    favourite: favourite.value.trim(),
    era: selected('era'),
    mood: selected('mood'),
    strandedWith: stranded.value.trim(),
  };

  // One free-text answer is enough to describe a taste; zero is not, and
  // embedding an empty string ranks the corpus by nothing in particular.
  if (!person.favourite && !person.strandedWith) {
    setError(personError, 'Tell us about one film or one person — anything to go on.');
    return;
  }

  state.people.push(person);
  setError(personError, null);

  if (state.current + 1 < state.total) {
    state.current += 1;
    clearPersonForm();
    renderCounter();
    return;
  }

  personSubmit.disabled = true;
  personSubmit.textContent = 'Finding it…';

  try {
    const { ranking, relaxed, shortest } = await recommend(openai, supabase, {
      people: state.people,
      minutes: state.minutes,
    });

    if (!ranking.length) throw new Error('No films came back. Has `npm run ingest` been run?');

    state.ranking = ranking;
    state.relaxed = relaxed;
    state.shortest = shortest;
    state.shown = 0;

    show('result');
    await renderFilm();
  } catch (error) {
    console.error(error);
    setError(personError, error.message);
  } finally {
    personSubmit.disabled = false;
    renderCounter();
  }
});

async function renderFilm() {
  const film = state.ranking[state.shown];

  filmTitle.textContent = `${film.title} (${film.release_year})`;

  // Reset the fallback before each load, or a film whose poster works inherits
  // the previous film's failure.
  posterFallback.hidden = true;
  filmPoster.hidden = false;
  fallbackTitle.textContent = film.title;
  fallbackYear.textContent = film.release_year;
  filmPoster.alt = `${film.title} poster`;
  filmPoster.src = film.poster_url ?? '';
  if (!film.poster_url) filmPoster.dispatchEvent(new Event('error'));

  setError(
    resultNote,
    state.relaxed && state.shown === 0
      ? relaxedTimeNote(state.minutes, `${state.shortest} min`)
      : null
  );

  nextMovie.disabled = true;
  filmPitch.textContent = 'Writing the pitch…';

  try {
    filmPitch.textContent = await pitch(openai, film, state.people);
  } catch (error) {
    console.error(error);
    // The film is still a real recommendation even if the sentence about it
    // failed, so fall back to the record's own opening line rather than
    // throwing the result away.
    filmPitch.textContent = film.content.split(': ').slice(1).join(': ').split('. ')[0] + '.';
  } finally {
    nextMovie.disabled = false;
    nextMovie.hidden = state.ranking.length <= 1;
  }
}

// Third-party images on a host that owes us nothing, so losing one must not
// break the layout — see .poster-fallback in index.css.
filmPoster.addEventListener('error', () => {
  filmPoster.hidden = true;
  posterFallback.hidden = false;
});

nextMovie.addEventListener('click', async () => {
  state.shown = (state.shown + 1) % state.ranking.length;
  await renderFilm();
});

startOver.addEventListener('click', () => {
  state.people = [];
  state.current = 0;
  setupForm.reset();
  clearPersonForm();
  show('setup');
});
