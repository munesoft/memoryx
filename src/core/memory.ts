import type {
  CompressOptions,
  CompressResult,
  ContextOptions,
  MemoryEntry,
  MemoryHooks,
  MemoryLayer,
  MemoryOptions,
  MemoryxOptions,
  RecallOptions,
  RecallResult,
  StorageAdapter,
} from '../types.js';
import { createAdapter } from '../adapters/factory.js';
import { uid } from '../utils/uid.js';
import { now } from '../utils/time.js';
import { approxTokens, toText, tokenize, truncateToBudget } from '../utils/text.js';
import { scoreRelevance } from '../recall/score.js';
import { combinedScore, importanceScore, recencyScore } from '../ranking/rank.js';
import { jaccard } from '../recall/fuzzy.js';
import { extractiveSummarizer, type Summarizer } from './summarize.js';

const DEFAULT_OPTS: Required<Omit<MemoryxOptions, 'hooks' | 'store' | 'summarizer'>> = {
  ai: false,
  shortTerm: true,
  longTerm: true,
  session: true,
  namespace: 'default',
  shortTermLimit: 100,
  longTermLimit: 1000,
  contextBudget: 2000,
  dedupe: true,
  dedupeThreshold: 0.85,
  compress: true,
};

/**
 * The core memory layer. Backed by a pluggable storage adapter and a
 * lightweight in-process index for relevance + ranking.
 *
 * Most users never construct this directly — call `memoryx()` instead.
 */
export class Memory {
  private opts: Required<Omit<MemoryxOptions, 'hooks' | 'store' | 'summarizer'>>;
  private adapter: StorageAdapter;
  private hooks: MemoryHooks;
  private summarizer: Summarizer;

  constructor(options: MemoryxOptions = {}) {
    this.opts = { ...DEFAULT_OPTS, ...options };
    this.adapter = createAdapter(options.store);
    this.hooks = options.hooks ?? {};
    this.summarizer = options.summarizer ?? extractiveSummarizer;
  }

  // ─── remember ──────────────────────────────────────────────────────────────

  /**
   * Store a value in memory.
   *
   * @param data    Anything JSON-serializable.
   * @param options Per-entry options — ttl, tags, importance, namespace, layer.
   * @returns       The id of the stored entry.
   */
  async remember(data: unknown, options: MemoryOptions = {}): Promise<string> {
    const t = now();
    const text = toText(data);
    const tokens = tokenize(text);

    const layer: MemoryLayer = options.layer ?? 'short';
    const namespace = options.namespace ?? this.opts.namespace;

    const entry: MemoryEntry = {
      id: options.id ?? uid(),
      data,
      text,
      tokens,
      createdAt: t,
      accessedAt: t,
      hits: 0,
      importance: clamp01(options.importance ?? 0.5),
      layer,
      namespace,
      tags: options.tags ?? [],
      expiresAt: options.ttl ? t + options.ttl : null,
    };

    // Deduplication — merge with the closest existing match if similarity is high.
    if (this.opts.dedupe) {
      const merged = await this.tryMerge(entry);
      if (merged) {
        await this.callHook(() => this.hooks.onRemember?.(merged));
        return merged.id;
      }
    }

    await this.adapter.set(entry);
    await this.enforceLimits();
    await this.callHook(() => this.hooks.onRemember?.(entry));
    return entry.id;
  }

  /**
   * Stream-style append — store partial output. Each call adds an incremental
   * chunk; the chunks share a stream id so they can later be reassembled.
   *
   * Useful for capturing streaming AI responses without losing partial content
   * if a stream is interrupted.
   */
  async stream(chunk: unknown, options: MemoryOptions & { streamId?: string } = {}): Promise<string> {
    const streamId = options.streamId ?? '_stream';
    return this.remember(chunk, {
      ...options,
      tags: [...(options.tags ?? []), `stream:${streamId}`],
    });
  }

  // ─── recall ────────────────────────────────────────────────────────────────

  /**
   * Search memory for entries matching `query`. Combines keyword, fuzzy,
   * and substring matching, then ranks by relevance + recency + importance.
   */
  async recall(query: string, options: RecallOptions = {}): Promise<RecallResult[]> {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0;
    const ns = options.namespace;
    const tagFilter = options.tags;
    const layerFilter = options.layer;

    await this.evictExpired();
    const all = await this.adapter.all();
    const t = now();

    const results: RecallResult[] = [];
    for (const entry of all) {
      if (entry.expiresAt && entry.expiresAt <= t) continue;
      if (ns && entry.namespace !== ns) continue;
      if (layerFilter && entry.layer !== layerFilter) continue;
      if (tagFilter && tagFilter.length > 0) {
        const overlap = tagFilter.some((tag) => entry.tags.includes(tag));
        if (!overlap) continue;
      }

      const relevance = scoreRelevance(query, entry);
      const recency = recencyScore(entry, t);
      const importance = importanceScore(entry);
      const score = combinedScore(relevance, recency, importance);

      if (score < minScore) continue;
      // When the user provided a real query, an entry with zero relevance
      // is not a "match" — even if it happens to be recent or important.
      // Recall is for finding things related to the query.
      if (query && relevance === 0) continue;

      results.push({
        entry,
        data: entry.data,
        score,
        scores: { relevance, recency, importance },
      });
    }

    if (options.recentFirst) {
      results.sort((a, b) => b.entry.accessedAt - a.entry.accessedAt);
    } else {
      results.sort((a, b) => b.score - a.score);
    }

    const sliced = results.slice(0, limit);

    // Update hits/accessedAt for returned entries — useful for recency boost.
    for (const r of sliced) {
      r.entry.hits++;
      r.entry.accessedAt = t;
      await this.adapter.set(r.entry);
    }

    await this.callHook(() => this.hooks.onRecall?.(query, sliced));
    return sliced;
  }

  // ─── forget / clear ────────────────────────────────────────────────────────

  /**
   * Remove entries that match `query`. If `query` is empty, this is a no-op
   * (use `clear()` to wipe everything).
   */
  async forget(query: string): Promise<number> {
    if (!query) return 0;
    const matches = await this.recall(query, { limit: 1000, minScore: 0.2 });
    const ids: string[] = [];
    for (const m of matches) {
      const ok = await this.adapter.delete(m.entry.id);
      if (ok) ids.push(m.entry.id);
    }
    if (ids.length > 0) {
      await this.callHook(() => this.hooks.onForget?.(ids));
    }
    return ids.length;
  }

  /**
   * Wipe all memory. Optionally restrict to a single namespace.
   */
  async clear(namespace?: string): Promise<void> {
    if (!namespace) {
      await this.adapter.clear();
      await this.callHook(() => this.hooks.onClear?.());
      return;
    }
    const all = await this.adapter.all();
    const ids: string[] = [];
    for (const e of all) {
      if (e.namespace === namespace) {
        await this.adapter.delete(e.id);
        ids.push(e.id);
      }
    }
    if (ids.length > 0) {
      await this.callHook(() => this.hooks.onForget?.(ids));
    }
  }

  // ─── compress ──────────────────────────────────────────────────────────────

  /**
   * Manually compress old entries into synthetic digests. Useful for keeping
   * token budgets low in long-running agents without waiting for the
   * automatic eviction trigger.
   *
   * ```ts
   * await memory.compress({ olderThan: '7d' });
   * ```
   *
   * Returns counts of source entries folded, digests created, and approximate
   * tokens saved.
   */
  async compress(options: CompressOptions = {}): Promise<CompressResult> {
    const minBatch = options.minBatch ?? 3;
    const cutoff = options.olderThan != null
      ? now() - parseDuration(options.olderThan)
      : Number.POSITIVE_INFINITY; // by default, "everything" is older than +Inf

    const all = await this.adapter.all();

    // Group eligible entries by namespace so unrelated facts don't merge.
    const groups = new Map<string, MemoryEntry[]>();
    for (const e of all) {
      if (e.compressed) continue;             // never re-compress digests
      if (e.layer !== 'long') continue;       // only long-term is eligible
      if (e.accessedAt > cutoff) continue;    // too recent
      if (options.namespace && e.namespace !== options.namespace) continue;

      const key = e.namespace;
      const bucket = groups.get(key) ?? [];
      bucket.push(e);
      groups.set(key, bucket);
    }

    let compressed = 0;
    let digests = 0;
    let tokensSaved = 0;

    for (const [, batch] of groups) {
      if (batch.length < minBatch) continue;
      const before = batch.reduce((sum, e) => sum + approxTokens(e.text), 0);

      const digest = await this.compressBatch(batch);
      if (!digest) continue;

      for (const e of batch) await this.adapter.delete(e.id);

      const after = approxTokens(digest.text);
      compressed += batch.length;
      digests += 1;
      tokensSaved += Math.max(0, before - after);
    }

    const result: CompressResult = { compressed, digests, tokensSaved };
    if (compressed > 0) {
      await this.callHook(() => this.hooks.onCompress?.(result));
    }
    return result;
  }

  /**
   * Fold a batch of entries into a single synthetic digest entry.
   * Returns the digest entry (also persisted to the adapter), or null if
   * the batch was empty.
   */
  private async compressBatch(batch: MemoryEntry[]): Promise<MemoryEntry | null> {
    if (batch.length === 0) return null;

    const summary = await this.summarizer(batch);
    if (!summary) return null;

    const t = now();
    const namespace = batch[0].namespace;
    // Inherit the highest importance from the batch — if anything in here
    // was important, the digest is too. Tags are unioned.
    const importance = batch.reduce((m, e) => Math.max(m, e.importance), 0);
    const tagSet = new Set<string>();
    for (const e of batch) for (const tag of e.tags) tagSet.add(tag);
    tagSet.add('compressed');

    const text = summary;
    const digest: MemoryEntry = {
      id: uid(),
      data: text,
      text,
      tokens: tokenize(text),
      createdAt: t,
      accessedAt: t,
      hits: 0,
      importance,
      layer: 'long',
      namespace,
      tags: Array.from(tagSet),
      expiresAt: null,
      compressed: true,
      compressedFrom: batch.length,
    };
    await this.adapter.set(digest);
    return digest;
  }

  // ─── context ───────────────────────────────────────────────────────────────

  /**
   * Build a prompt-ready, size-aware context string for the given scope.
   *
   * Prioritizes:
   *   - high-importance entries
   *   - recent entries (always includes the N most recent)
   *   - relevance to `scope` if it's a meaningful query string
   *
   * Returns plain text safe to splice into an LLM prompt.
   */
  async context(scope?: string, options: ContextOptions = {}): Promise<string> {
    const budget = options.budget ?? this.opts.contextBudget;
    const ns = options.namespace ?? this.opts.namespace;
    const recentCount = options.recentCount ?? 3;

    await this.evictExpired();
    const all = await this.adapter.all();
    if (all.length === 0) return '';

    const t = now();
    const filtered = all.filter((e) => {
      if (e.expiresAt && e.expiresAt <= t) return false;
      if (ns && ns !== 'default' && e.namespace !== ns) return false;
      return true;
    });

    if (filtered.length === 0) return '';

    // Score each entry. If scope is given, factor in relevance; otherwise
    // rely entirely on importance + recency.
    const scored = filtered.map((entry) => {
      const relevance = scope ? scoreRelevance(scope, entry) : 0;
      const recency = recencyScore(entry, t);
      const importance = importanceScore(entry);
      // In context-building we weight importance higher than in recall —
      // we want the prompt-defining facts to anchor every turn.
      const score = scope
        ? relevance * 0.5 + importance * 0.3 + recency * 0.2
        : importance * 0.6 + recency * 0.4;
      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Always include the N most recent entries even if their score is low —
    // recency is critical for conversational continuity.
    const recent = [...filtered]
      .sort((a, b) => b.accessedAt - a.accessedAt)
      .slice(0, recentCount);
    const recentIds = new Set(recent.map((e) => e.id));

    const ordered: MemoryEntry[] = [];
    const seen = new Set<string>();
    for (const e of recent) {
      ordered.push(e);
      seen.add(e.id);
    }
    for (const { entry } of scored) {
      if (seen.has(entry.id)) continue;
      ordered.push(entry);
      seen.add(entry.id);
    }

    // Pack into the budget, line by line.
    const lines: string[] = [];
    let used = 0;
    for (const entry of ordered) {
      const line = formatLine(entry, recentIds.has(entry.id));
      const cost = approxTokens(line) + 1;
      if (used + cost > budget) {
        // AI mode: try to fit a truncated version of just this line if there's any room.
        if (this.opts.ai && budget - used > 20) {
          lines.push(truncateToBudget(line, budget - used));
        }
        break;
      }
      lines.push(line);
      used += cost;
    }

    return lines.join('\n');
  }

  // ─── inspection ────────────────────────────────────────────────────────────

  /** Return all stored entries (useful for debugging / persistence). */
  async all(): Promise<MemoryEntry[]> {
    await this.evictExpired();
    return this.adapter.all();
  }

  /** Number of currently stored entries. */
  async size(): Promise<number> {
    await this.evictExpired();
    return this.adapter.size();
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  /** Evict TTL-expired entries. Cheap — runs before reads. */
  private async evictExpired(): Promise<void> {
    const t = now();
    const all = await this.adapter.all();
    for (const e of all) {
      if (e.expiresAt && e.expiresAt <= t) {
        await this.adapter.delete(e.id);
      }
    }
  }

  /**
   * If a near-duplicate exists, merge into it (bumps importance and
   * accessedAt, refreshes data). Returns the merged entry, or null if
   * nothing similar was found.
   */
  private async tryMerge(entry: MemoryEntry): Promise<MemoryEntry | null> {
    const all = await this.adapter.all();
    let best: { entry: MemoryEntry; sim: number } | null = null;
    for (const e of all) {
      if (e.namespace !== entry.namespace) continue;
      // Cheap exact-text shortcut
      if (e.text === entry.text) {
        best = { entry: e, sim: 1 };
        break;
      }
      const sim = jaccard(e.tokens, entry.tokens);
      if (sim >= this.opts.dedupeThreshold && (!best || sim > best.sim)) {
        best = { entry: e, sim };
      }
    }
    if (!best) return null;

    const merged: MemoryEntry = {
      ...best.entry,
      data: entry.data,
      text: entry.text,
      tokens: entry.tokens,
      tags: dedupeArray([...best.entry.tags, ...entry.tags]),
      importance: Math.max(best.entry.importance, entry.importance),
      accessedAt: now(),
      hits: best.entry.hits + 1,
      // Earliest TTL wins — prevents merging from extending lifetime.
      expiresAt: minTTL(best.entry.expiresAt, entry.expiresAt),
      merged: true,
    };
    await this.adapter.set(merged);
    return merged;
  }

  /**
   * Enforce short-term and long-term layer limits.
   * Short-term overflow → promote oldest to long-term.
   * Long-term overflow  → evict lowest combined (importance + recency) score.
   */
  private async enforceLimits(): Promise<void> {
    const all = await this.adapter.all();
    const shortEntries = all.filter((e) => e.layer === 'short');
    const longEntries = all.filter((e) => e.layer === 'long');

    if (this.opts.shortTerm && shortEntries.length > this.opts.shortTermLimit) {
      // Promote oldest low-importance entries to long-term
      const overflow = shortEntries.length - this.opts.shortTermLimit;
      const sorted = [...shortEntries].sort((a, b) => {
        // Lower importance + older accessedAt → promote first
        const sa = a.importance + (a.accessedAt / 1e13);
        const sb = b.importance + (b.accessedAt / 1e13);
        return sa - sb;
      });
      for (let i = 0; i < overflow; i++) {
        const e = sorted[i];
        if (this.opts.longTerm) {
          await this.adapter.set({ ...e, layer: 'long' });
        } else {
          await this.adapter.delete(e.id);
        }
      }
    }

    if (this.opts.longTerm && longEntries.length > this.opts.longTermLimit) {
      const overflow = longEntries.length - this.opts.longTermLimit;
      const t = now();
      const sorted = [...longEntries].sort((a, b) => {
        const sa = importanceScore(a) * 0.6 + recencyScore(a, t) * 0.4;
        const sb = importanceScore(b) * 0.6 + recencyScore(b, t) * 0.4;
        return sa - sb;
      });

      // Compression-then-evict: instead of dropping low-signal entries,
      // fold them into a synthetic digest. This preserves *some* memory
      // of what was learned, even after the original entries are gone.
      //
      // We deliberately compress *more* than just the overflow — when one
      // entry needs to go, fold it together with a few of the next-lowest
      // raw entries. That gives compression real leverage (n→1) instead of
      // trivial 1→1 replacement, and amortizes summarization cost.
      if (this.opts.compress) {
        const COMPRESS_BATCH = Math.max(overflow + 2, 4);
        const candidates = sorted
          .slice(0, COMPRESS_BATCH)
          .filter((e) => !e.compressed); // never re-compress digests

        if (candidates.length >= 2) {
          await this.compressBatch(candidates);
          for (const v of candidates) await this.adapter.delete(v.id);

          // If after compression we're still over the limit (because some
          // victims were existing digests we couldn't fold), evict the rest.
          const remaining = await this.adapter.all();
          const stillLong = remaining.filter((e) => e.layer === 'long');
          if (stillLong.length > this.opts.longTermLimit) {
            const stillOver = stillLong.length - this.opts.longTermLimit;
            const reSorted = [...stillLong].sort((a, b) => {
              const sa = importanceScore(a) * 0.6 + recencyScore(a, t) * 0.4;
              const sb = importanceScore(b) * 0.6 + recencyScore(b, t) * 0.4;
              return sa - sb;
            });
            for (let i = 0; i < stillOver; i++) {
              await this.adapter.delete(reSorted[i].id);
            }
          }
          return;
        }
      }

      // Fall-through plain eviction (compression disabled, or only digests
      // remain — nothing left to compress).
      for (let i = 0; i < overflow; i++) {
        await this.adapter.delete(sorted[i].id);
      }
    }
  }

  private async callHook(fn: () => void | Promise<void> | undefined): Promise<void> {
    try {
      await fn();
    } catch {
      // Hooks should never crash the host application.
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function dedupeArray<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function minTTL(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function formatLine(entry: MemoryEntry, isRecent: boolean): string {
  const marker = isRecent ? '•' : '-';
  // Strip wrapping quotes if data was already a plain string.
  const text = typeof entry.data === 'string' ? entry.data : entry.text;
  return `${marker} ${text}`;
}

/**
 * Parse a duration value into ms.
 *
 *   - number → returned as-is
 *   - "60s"  → 60_000
 *   - "5m"   → 300_000
 *   - "2h"   → 7_200_000
 *   - "7d"   → 604_800_000
 *
 * Throws on malformed input rather than silently producing NaN.
 */
function parseDuration(input: number | string): number {
  if (typeof input === 'number') return input;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i.exec(input.trim());
  if (!m) {
    throw new Error(`memoryx: invalid duration '${input}' — use e.g. '7d' or 60000`);
  }
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return n * mult[unit];
}
