import type { StorageAdapter, StoreOption } from '../types.js';
import { MemoryAdapter } from './memory.js';
import { FileAdapter } from './file.js';
import { RedisAdapter, type RedisLikeClient } from './redis.js';

/**
 * Resolve a `store` option into a concrete adapter.
 *
 *   - `'memory'` (or undefined) → in-memory
 *   - `'file'`                  → JSON file persistence
 *   - `'redis'`                 → throws unless given `{ type: 'redis', client }`
 *   - `{ type, ...config }`     → typed adapter config
 *   - StorageAdapter instance   → returned as-is
 */
export function createAdapter(option: StoreOption | undefined): StorageAdapter {
  if (!option || option === 'memory') {
    return new MemoryAdapter();
  }
  if (option === 'file') {
    return new FileAdapter();
  }
  if (option === 'redis') {
    throw new Error(
      "memoryx: store: 'redis' requires a client. Use store: { type: 'redis', client }",
    );
  }
  if (typeof option === 'object' && option !== null) {
    // Custom adapter — duck-type check.
    if (
      typeof (option as StorageAdapter).get === 'function' &&
      typeof (option as StorageAdapter).set === 'function' &&
      typeof (option as StorageAdapter).all === 'function'
    ) {
      return option as StorageAdapter;
    }
    // Typed config
    const cfg = option as { type: string; [k: string]: unknown };
    if (cfg.type === 'memory') return new MemoryAdapter();
    if (cfg.type === 'file') return new FileAdapter(cfg.path as string | undefined);
    if (cfg.type === 'redis') {
      if (!cfg.client) {
        throw new Error("memoryx: redis store requires a 'client' field");
      }
      return new RedisAdapter({
        client: cfg.client as RedisLikeClient,
        prefix: cfg.prefix as string | undefined,
      });
    }
    throw new Error(`memoryx: unknown adapter type '${cfg.type}'`);
  }
  throw new Error(`memoryx: invalid store option`);
}
