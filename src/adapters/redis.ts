import type { MemoryEntry, StorageAdapter } from '../types.js';

/**
 * Minimal Redis-compatible client surface. Works with `ioredis`, `node-redis`,
 * Upstash, or any thin wrapper that exposes these methods.
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

interface RedisAdapterOptions {
  client: RedisLikeClient;
  /** Key prefix — entries are stored at `${prefix}:${id}`. Default 'memoryx'. */
  prefix?: string;
}

/**
 * Redis-backed adapter. Stores each entry as a JSON string under a prefixed
 * key. The caller supplies the client — we don't depend on any Redis SDK so
 * the package stays zero-dependency.
 */
export class RedisAdapter implements StorageAdapter {
  private client: RedisLikeClient;
  private prefix: string;

  constructor({ client, prefix = 'memoryx' }: RedisAdapterOptions) {
    this.client = client;
    this.prefix = prefix;
  }

  private key(id: string): string {
    return `${this.prefix}:${id}`;
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    const raw = await this.client.get(this.key(id));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as MemoryEntry;
    } catch {
      return undefined;
    }
  }

  async set(entry: MemoryEntry): Promise<void> {
    await this.client.set(this.key(entry.id), JSON.stringify(entry));
  }

  async delete(id: string): Promise<boolean> {
    const removed = await this.client.del(this.key(id));
    return removed > 0;
  }

  async clear(): Promise<void> {
    const keys = await this.client.keys(`${this.prefix}:*`);
    if (keys.length === 0) return;
    await this.client.del(keys);
  }

  async all(): Promise<MemoryEntry[]> {
    const keys = await this.client.keys(`${this.prefix}:*`);
    const out: MemoryEntry[] = [];
    for (const k of keys) {
      const raw = await this.client.get(k);
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as MemoryEntry);
      } catch {
        // skip corrupt entry
      }
    }
    return out;
  }

  async size(): Promise<number> {
    const keys = await this.client.keys(`${this.prefix}:*`);
    return keys.length;
  }
}
