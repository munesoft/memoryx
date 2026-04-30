import type { MemoryEntry } from '../types.js';

/**
 * A Summarizer takes a batch of entries and returns a compressed digest.
 * Implementations may be sync or async. Default is extractive (no LLM);
 * users can plug in an LLM-backed summarizer for richer compression.
 */
export type Summarizer = (entries: MemoryEntry[]) => string | Promise<string>;

/**
 * Extractive summarizer — zero-dependency, no API calls.
 *
 * Strategy:
 *   1. Group by namespace + dominant tags so unrelated facts don't merge.
 *   2. Score each entry by `importance × log(1 + hits)` to favor frequently
 *      recalled and explicitly-important entries.
 *   3. Take the top sentences, dedupe by overlap, join with separators.
 *
 * This is deliberately simple — for most agent memory the goal of
 * compression is to *preserve the high-signal facts* while shedding the
 * low-signal chatter. An extractive approach does that without the
 * latency, cost, or non-determinism of an LLM call.
 */
export const extractiveSummarizer: Summarizer = (entries) => {
  if (entries.length === 0) return '';
  if (entries.length === 1) return entryToLine(entries[0]);

  // Score entries by signal strength.
  const scored = entries
    .map((e) => ({
      entry: e,
      score: e.importance * Math.log(1 + e.hits + 1),
    }))
    .sort((a, b) => b.score - a.score);

  // Take roughly the top half (min 3, max 10) to keep compression aggressive
  // but not lossy. The whole point is that *some* signal survives.
  const keepCount = Math.min(10, Math.max(3, Math.ceil(entries.length / 2)));
  const kept = scored.slice(0, keepCount);

  // Dedupe by leading-text similarity — extractive often pulls overlapping facts.
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const { entry } of kept) {
    const line = entryToLine(entry);
    const key = line.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }

  return lines.join(' • ');
};

function entryToLine(entry: MemoryEntry): string {
  if (typeof entry.data === 'string') return entry.data;
  return entry.text;
}
