import type { MemoryEntry, StorageAdapter } from '../types.js';

/**
 * File-backed adapter. JSON-serializes the full entry table to disk
 * with a small debounce so bursts of writes don't thrash I/O.
 *
 * Node-only — gracefully no-ops if `node:fs` isn't available.
 */
export class FileAdapter implements StorageAdapter {
  private store = new Map<string, MemoryEntry>();
  private path: string;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private fs: typeof import('node:fs') | null = null;
  private loaded = false;

  constructor(path: string = './.memoryx.json') {
    this.path = path;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      // Lazy import keeps the browser bundle clean.
      this.fs = await import('node:fs');
    } catch {
      // Browser — file persistence isn't available; behave like in-memory.
      return;
    }
    try {
      const raw = this.fs.readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as MemoryEntry[];
      for (const entry of parsed) this.store.set(entry.id, entry);
    } catch {
      // First run, missing file, or corrupt data — start clean.
    }
  }

  private scheduleFlush(): void {
    if (!this.fs) return;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.flushSync();
    }, 50);
  }

  private flushSync(): void {
    if (!this.fs) return;
    try {
      const data = JSON.stringify(Array.from(this.store.values()));
      this.fs.writeFileSync(this.path, data, 'utf8');
    } catch {
      // Swallow — persistence is best-effort.
    }
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    await this.ensureLoaded();
    return this.store.get(id);
  }

  async set(entry: MemoryEntry): Promise<void> {
    await this.ensureLoaded();
    this.store.set(entry.id, entry);
    this.scheduleFlush();
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const ok = this.store.delete(id);
    if (ok) this.scheduleFlush();
    return ok;
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    this.store.clear();
    this.scheduleFlush();
  }

  async all(): Promise<MemoryEntry[]> {
    await this.ensureLoaded();
    return Array.from(this.store.values());
  }

  async size(): Promise<number> {
    await this.ensureLoaded();
    return this.store.size;
  }
}
