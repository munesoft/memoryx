import type { MemoryEntry } from '../types.js';
import { now } from '../utils/time.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Recency score in [0, 1] using exponential decay over a 7-day half-life.
 * Fresh entries score ~1; entries from a week ago score ~0.5.
 */
export function recencyScore(entry: MemoryEntry, t: number = now()): number {
  const age = Math.max(0, t - entry.accessedAt);
  const halfLife = 7 * DAY;
  // Exponential decay: 0.5^(age/halfLife)
  return Math.pow(0.5, age / halfLife);
}

/**
 * Importance score, normalized into [0, 1]. Stored value is already 0–1
 * but we clamp defensively in case a caller passed something out of range.
 */
export function importanceScore(entry: MemoryEntry): number {
  const i = entry.importance;
  if (typeof i !== 'number' || Number.isNaN(i)) return 0.5;
  if (i < 0) return 0;
  if (i > 1) return 1;
  return i;
}

/**
 * Combine relevance, recency, importance into a single rank score.
 * Weights are tuned for AI agent context: relevance dominates, but recency
 * and importance break ties when relevance is similar.
 */
export function combinedScore(
  relevance: number,
  recency: number,
  importance: number,
): number {
  return relevance * 0.65 + recency * 0.2 + importance * 0.15;
}
