/**
 * Reads "How much time do you have?".
 *
 * Pure, and in its own file, because it is branching logic over user input and
 * therefore something worth testing. It started life inside index.js, where the
 * first line of the module touches `document` — so nothing in Node could import
 * it, and the only way to check it would have been to retype it in the test.
 * The sibling project spent three user-visible bugs learning that a stage which
 * cannot be called from a test is a stage nobody is testing.
 *
 * The design draws a free-text box rather than a dropdown, so this has to
 * accept what people actually type. Three outcomes, kept distinct because they
 * deserve different responses:
 *
 *   number   minutes available
 *   null     the box was empty — no limit, not an error
 *   NaN      unparseable — tell them, do not silently ignore it
 */
export function parseMinutes(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;

  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)/);
  const mins = text.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);

  if (hours || mins) {
    let minutes = Number(mins?.[1] ?? 0);

    // "1h30" — minutes written bare after the hour marker, with no unit of
    // their own. Without this the trailing number is dropped in silence and an
    // hour and a half becomes an hour, which is the worst kind of wrong: it
    // parses, it looks reasonable, and it quietly shortens the shortlist.
    if (!mins && hours) {
      const trailing = text.slice(hours.index + hours[0].length).match(/^\s*(\d{1,2})\b/);
      if (trailing) minutes = Number(trailing[1]);
    }

    return Math.round(Number(hours?.[1] ?? 0) * 60 + minutes);
  }

  /*
   * A bare number is ambiguous and the split has to go somewhere. Twelve is the
   * boundary: nobody has thirteen hours for a film, and no film in this corpus
   * runs twelve minutes, so "2" is two hours and "120" is two hours. Getting it
   * wrong in the generous direction only widens the shortlist; getting it wrong
   * the other way would silently empty it.
   */
  const bare = text.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) {
    const value = Number(bare[1]);
    return value <= 12 ? Math.round(value * 60) : Math.round(value);
  }

  return NaN;
}
