import type { MemoryEntry } from '../types.js';
import { jaccard, tokenSimilarity } from './fuzzy.js';
import { tokenizeQuery } from '../utils/text.js';

const FUZZY_THRESHOLD = 0.7; // tokens with sim ≥ this count as a fuzzy match

/**
 * Compute a relevance score in [0, 1] between a query and an entry.
 *
 * Strategy:
 *   1. Direct substring containment → strong signal, contributes up to 0.6.
 *   2. Token Jaccard overlap        → solid keyword signal.
 *   3. Fuzzy token similarity       → catches typos and word-stem variations.
 *
 * The three signals are blended; the maximum is capped at 1.
 */
export function scoreRelevance(query: string, entry: MemoryEntry): number {
  if (!query) return 0;

  const q = query.toLowerCase().trim();
  if (!q) return 0;

  // 1. Substring boost — cheap and high-precision.
  let substring = 0;
  if (entry.text.includes(q)) {
    // Bias longer queries higher (a 5-char hit on a tweet is more meaningful
    // than a 1-char hit). Cap at 0.6.
    substring = Math.min(0.6, 0.3 + q.length * 0.02);
  }

  const queryTokens = tokenizeQuery(q);
  if (queryTokens.length === 0) {
    return substring;
  }

  // 2. Jaccard on tokens — recall of the query terms inside the entry.
  const jac = jaccard(queryTokens, entry.tokens);

  // 3. Fuzzy — how many query tokens have a near-match in the entry?
  let fuzzyHits = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const et of entry.tokens) {
      const sim = tokenSimilarity(qt, et);
      if (sim > best) best = sim;
      if (best === 1) break;
    }
    if (best >= FUZZY_THRESHOLD) fuzzyHits += best;
  }
  const fuzzy = queryTokens.length > 0 ? fuzzyHits / queryTokens.length : 0;

  // Blend: substring is dominant when present, otherwise weighted Jaccard + fuzzy.
  const blended = Math.max(
    substring,
    jac * 0.7 + fuzzy * 0.3,
  );

  return Math.min(1, blended);
}
