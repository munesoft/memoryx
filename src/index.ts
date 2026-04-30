import { Memory } from './core/memory.js';
import type { MemoryxOptions } from './types.js';

/**
 * Create a memory instance. Zero-config by default — call with no arguments
 * for an in-memory store with smart recall:
 *
 * ```ts
 * import memoryx from '@munesoft/memoryx';
 *
 * const memory = memoryx();
 *
 * await memory.remember("User prefers dark mode");
 * const results = await memory.recall("user preferences");
 * ```
 *
 * Pass options to enable AI mode, persistent storage, custom layers, or hooks:
 *
 * ```ts
 * const memory = memoryx({
 *   ai: true,
 *   store: 'file',
 *   shortTermLimit: 50,
 *   hooks: { onRemember: (e) => console.log('stored', e.id) },
 * });
 * ```
 */
export function memoryx(options: MemoryxOptions = {}): Memory {
  return new Memory(options);
}

// Named exports for power users
export { Memory } from './core/memory.js';
export { MemoryAdapter } from './adapters/memory.js';
export { FileAdapter } from './adapters/file.js';
export { RedisAdapter } from './adapters/redis.js';
export type { RedisLikeClient } from './adapters/redis.js';
export { extractiveSummarizer } from './core/summarize.js';

// Default export for the canonical 1-line use case.
export default memoryx;

// Type re-exports
export type {
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
  StoreOption,
  Summarizer,
} from './types.js';
