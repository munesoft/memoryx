import type { MemoryEntry, StorageAdapter } from '../types.js';

/**
 * Default in-memory adapter. Backed by a plain `Map<id, entry>`.
 * No persistence — data lives only for the lifetime of the process.
 */
export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, MemoryEntry>();

  get(id: string): MemoryEntry | undefined {
    return this.store.get(id);
  }

  set(entry: MemoryEntry): void {
    this.store.set(entry.id, entry);
  }

  delete(id: string): boolean {
    return this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }

  all(): MemoryEntry[] {
    return Array.from(this.store.values());
  }

  size(): number {
    return this.store.size;
  }
}
