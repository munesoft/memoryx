import type { Summarizer } from './core/summarize.js';

export type { Summarizer } from './core/summarize.js';

// ─── Memory Entry ────────────────────────────────────────────────────────────

/**
 * A single stored memory record.
 */
export interface MemoryEntry {
  /** Unique identifier for this entry. */
  id: string;
  /** The stored payload (any JSON-serializable value). */
  data: unknown;
  /** Lower-cased searchable text representation of `data`. */
  text: string;
  /** Tokenized form of `text` — used for keyword matching. */
  tokens: string[];
  /** ms since epoch when the entry was created. */
  createdAt: number;
  /** ms since epoch of the last access (read or write). */
  accessedAt: number;
  /** Number of times this entry has been recalled. */
  hits: number;
  /** Importance score, 0–1. Defaults to 0.5. */
  importance: number;
  /** Logical layer the entry lives in. */
  layer: MemoryLayer;
  /** Logical bucket — e.g. "user", "session", "task". */
  namespace: string;
  /** Free-form tags for filtering. */
  tags: string[];
  /** ms since epoch after which the entry should be evicted. `null` = never. */
  expiresAt: number | null;
  /** True if this entry is the merged head of a deduped group. */
  merged?: boolean;
  /** True if this entry is a synthetic compressed digest of older entries. */
  compressed?: boolean;
  /** When `compressed` is true, the number of entries this digest replaced. */
  compressedFrom?: number;
}

export type MemoryLayer = 'short' | 'long' | 'session';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface MemoryxOptions {
  /** Enable AI mode — auto-prioritized, noise-filtered, prompt-overflow-aware context. */
  ai?: boolean;
  /** Enable the short-term layer. Default true. */
  shortTerm?: boolean;
  /** Enable the long-term layer. Default true. */
  longTerm?: boolean;
  /** Enable the ephemeral session layer. Default true. */
  session?: boolean;
  /** Storage adapter: 'memory' (default), 'file', 'redis', or a custom adapter. */
  store?: StoreOption;
  /** Default namespace applied when one isn't passed. Default 'default'. */
  namespace?: string;
  /** Max entries kept in short-term before promotion/eviction. Default 100. */
  shortTermLimit?: number;
  /** When the long-term store grows beyond this, oldest low-importance entries are compressed. Default 1000. */
  longTermLimit?: number;
  /** Approximate token budget used by `context()`. Default 2000. */
  contextBudget?: number;
  /** Enable automatic deduplication on `remember`. Default true. */
  dedupe?: boolean;
  /** Similarity threshold (0–1) above which two entries are considered duplicates. Default 0.85. */
  dedupeThreshold?: number;
  /** Auto-compress old low-importance long-term entries instead of evicting them. Default true. */
  compress?: boolean;
  /** Custom summarizer. Defaults to a zero-dependency extractive summarizer. */
  summarizer?: Summarizer;
  /** Hooks fired during memory lifecycle events. */
  hooks?: MemoryHooks;
}

export type StoreOption = 'memory' | 'file' | 'redis' | StorageAdapter | { type: string; [k: string]: unknown };

export interface MemoryOptions {
  /** Time-to-live in ms. After this, the entry is auto-evicted. */
  ttl?: number;
  /** Tags for filtering on recall. */
  tags?: string[];
  /** Importance score 0–1. Higher = surfaced more aggressively in `context()`. */
  importance?: number;
  /** Logical bucket. Defaults to the instance namespace. */
  namespace?: string;
  /** Force the entry into a specific layer. Defaults to 'short'. */
  layer?: MemoryLayer;
  /** Custom id. Auto-generated if omitted. */
  id?: string;
}

export interface RecallOptions {
  /** Max number of matches to return. Default 10. */
  limit?: number;
  /** Drop matches whose relevance score falls below this. Default 0. */
  minScore?: number;
  /** Restrict to a single namespace. */
  namespace?: string;
  /** If true, sort by recency rather than relevance after scoring. */
  recentFirst?: boolean;
  /** Restrict to entries that contain at least one of these tags. */
  tags?: string[];
  /** Restrict to a specific layer. */
  layer?: MemoryLayer;
}

export interface ContextOptions {
  /** Approximate token budget. Defaults to instance setting. */
  budget?: number;
  /** Optional namespace filter. */
  namespace?: string;
  /** How many most-recent entries to always include regardless of score. Default 3. */
  recentCount?: number;
}

export interface CompressOptions {
  /**
   * Compress entries older than this duration (ms) or ISO duration shorthand
   * (e.g. `"7d"`, `"1h"`). Default: compress everything in long-term.
   */
  olderThan?: number | string;
  /** Restrict compression to a single namespace. */
  namespace?: string;
  /** Minimum number of entries required before compression triggers. Default 3. */
  minBatch?: number;
}

export interface CompressResult {
  /** Number of source entries that were folded. */
  compressed: number;
  /** Number of synthetic digest entries created. */
  digests: number;
  /** Approximate token count saved by compression (chars/4 estimate). */
  tokensSaved: number;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export interface MemoryHooks {
  onRemember?: (entry: MemoryEntry) => void | Promise<void>;
  onRecall?: (query: string, results: RecallResult[]) => void | Promise<void>;
  onForget?: (ids: string[]) => void | Promise<void>;
  onClear?: () => void | Promise<void>;
  onCompress?: (result: CompressResult) => void | Promise<void>;
}

// ─── Recall ──────────────────────────────────────────────────────────────────

export interface RecallResult {
  /** The full entry. */
  entry: MemoryEntry;
  /** The recovered data (shortcut for `entry.data`). */
  data: unknown;
  /** Combined relevance score, 0–1. */
  score: number;
  /** Score breakdown — useful for debugging. */
  scores: {
    relevance: number;
    recency: number;
    importance: number;
  };
}

// ─── Storage Adapter ─────────────────────────────────────────────────────────

/**
 * Pluggable storage interface. All methods may be sync or async.
 * Implementations only need to persist the raw entries — search,
 * ranking, and TTL enforcement are handled by the core.
 */
export interface StorageAdapter {
  get(id: string): MemoryEntry | undefined | Promise<MemoryEntry | undefined>;
  set(entry: MemoryEntry): void | Promise<void>;
  delete(id: string): boolean | Promise<boolean>;
  clear(): void | Promise<void>;
  all(): MemoryEntry[] | Promise<MemoryEntry[]>;
  size(): number | Promise<number>;
}
