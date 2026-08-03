import OpenAI from 'openai';

/**
 * Vite does not shim `process` in the browser, so this must read
 * import.meta.env. The VITE_ prefix is what makes Vite expose it — and it is
 * also the reminder that this key is inlined into the bundle and readable by
 * anyone who opens the page. Local practice only.
 */
const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

if (!apiKey) {
  throw new Error('VITE_OPENAI_API_KEY is missing. Copy .env.example to .env and fill it in.');
}

export default new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
