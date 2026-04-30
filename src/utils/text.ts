// English stop words — small list, kept lean.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'for',
  'from', 'has', 'have', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my',
  'no', 'not', 'of', 'on', 'or', 'so', 'that', 'the', 'this', 'to',
  'was', 'were', 'will', 'with', 'you', 'your',
]);

const TOKEN_RE = /[a-z0-9]+/gi;

/**
 * Convert any value into a lower-cased, searchable string.
 * Objects are JSON.stringified; primitives are coerced.
 */
export function toText(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean' || typeof data === 'bigint') {
    return String(data);
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/**
 * Tokenize text into lowercased keyword tokens.
 * Strips punctuation, removes stop words, dedupes.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matches = lower.match(TOKEN_RE);
  if (!matches) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of matches) {
    // Drop very short pure-letter tokens (a, i, of, etc.); keep digits since
    // numeric tokens like "1", "2024", "v3" are meaningful.
    if (t.length < 2 && !/^\d$/.test(t)) continue;
    if (STOP_WORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Tokenize a query — same as `tokenize` but keeps duplicates and short tokens
 * because users may search for short keywords.
 */
export function tokenizeQuery(query: string): string[] {
  if (!query) return [];
  const lower = query.toLowerCase();
  const matches = lower.match(TOKEN_RE);
  if (!matches) return [];
  return matches.filter((t) => !STOP_WORDS.has(t));
}

/**
 * Approximate token count for context-budget calculations.
 * Roughly 1 token ≈ 4 characters of English text.
 */
export function approxTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Truncate a string to roughly the requested token budget.
 */
export function truncateToBudget(text: string, tokenBudget: number): string {
  const charBudget = tokenBudget * 4;
  if (text.length <= charBudget) return text;
  return text.slice(0, charBudget - 1) + '…';
}
