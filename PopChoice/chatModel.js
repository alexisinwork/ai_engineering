/**
 * The one place the chat model and its prompt live.
 *
 * Separate from embeddingModel.js because the two fail differently and get
 * swapped for different reasons: MODEL decides which film is *found*,
 * CHAT_MODEL decides what is *said* about it. Changing MODEL invalidates every
 * stored vector; changing CHAT_MODEL invalidates nothing.
 *
 * PopChoice only asks the chat model to do one thing, and it is deliberately
 * the smallest job in the app. The film is already chosen by the time this runs
 * — by embeddings and by rank.js, both of which are inspectable and testable.
 * Letting the model pick the winner instead would be easier to write and
 * impossible to measure.
 */
export const CHAT_MODEL = 'gpt-4o-mini';

/**
 * Writes the sentence or two under the poster.
 *
 * Grounded in the film's stored `content` and nothing else, for the same reason
 * the sibling project grounds its answerer: a model asked to describe a film it
 * "knows" will produce something fluent, plausible and occasionally invented,
 * and the output gives you no way to tell which you got. Everything needed —
 * plot, cast, director, genre, rating — is in the record already.
 *
 * The group framing is the part worth keeping. The pitch has to explain the fit
 * to people who did not all ask for the same thing, and the honest version of
 * that sometimes acknowledges a compromise. A pitch that claims a film is
 * perfect for everyone, when it won on being tolerable to everyone, is the same
 * failure as a confident answer from an empty context.
 */
export const PITCH_SYSTEM = `You are PopChoice, recommending one film to a group who have just described their tastes.

- Use only the FILM record supplied. Never add plot details, cast, awards, or opinions from your own knowledge of the film, even if you are confident.
- Two or three sentences. Speak to the group, not about them.
- Say what the film is, then why it suits what they asked for. Refer to their stated tastes.
- If it is a compromise — someone wanted scary and this is not scary — say so lightly and honestly rather than overselling it. One clause is enough.
- Never mention rankings, scores, embeddings, or that this was chosen by a program.
- No markdown, no headings, no bullet lists, no emoji.`;

/**
 * Sent when the corpus has films but none within the time limit, before the
 * limit is relaxed. Fixed text rather than a model call — there is nothing to
 * ground a sentence in, and this one is the same every time.
 */
export function relaxedTimeNote(minutes, shortest) {
  return `Nothing here runs under ${minutes} minutes — the shortest is ${shortest}. Here is the closest fit.`;
}
