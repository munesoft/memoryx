import { describe, expect, it, vi } from 'vitest';
import memoryx, { extractiveSummarizer, type MemoryEntry } from '../src/index.js';

describe('compression', () => {
  describe('manual compress()', () => {
    it('compresses long-term entries into a single digest', async () => {
      const memory = memoryx({ dedupe: false });
      for (let i = 0; i < 5; i++) {
        await memory.remember(`fact about cats number ${i}`, { layer: 'long' });
      }

      const result = await memory.compress();

      expect(result.compressed).toBe(5);
      expect(result.digests).toBe(1);
      expect(result.tokensSaved).toBeGreaterThan(0);

      const all = await memory.all();
      const digests = all.filter((e) => e.compressed);
      expect(digests.length).toBe(1);
      expect(digests[0].compressedFrom).toBe(5);
      expect(digests[0].tags).toContain('compressed');
    });

    it('respects the minBatch threshold', async () => {
      const memory = memoryx({ dedupe: false });
      await memory.remember('only one fact', { layer: 'long' });
      await memory.remember('and another', { layer: 'long' });

      const result = await memory.compress({ minBatch: 5 });

      expect(result.compressed).toBe(0);
      expect(result.digests).toBe(0);
      expect(await memory.size()).toBe(2); // nothing changed
    });

    it('does not compress short-term entries', async () => {
      const memory = memoryx({ dedupe: false, shortTermLimit: 1000 });
      for (let i = 0; i < 5; i++) {
        await memory.remember(`fact ${i}`); // default layer is 'short'
      }

      const result = await memory.compress();

      expect(result.compressed).toBe(0);
      expect(await memory.size()).toBe(5);
    });

    it('respects namespace option', async () => {
      const memory = memoryx({ dedupe: false });
      for (let i = 0; i < 4; i++) {
        await memory.remember(`fact in A ${i}`, { layer: 'long', namespace: 'A' });
        await memory.remember(`fact in B ${i}`, { layer: 'long', namespace: 'B' });
      }

      await memory.compress({ namespace: 'A' });

      const all = await memory.all();
      const aEntries = all.filter((e) => e.namespace === 'A');
      const bEntries = all.filter((e) => e.namespace === 'B');

      // A was compressed → roughly one digest
      expect(aEntries.filter((e) => e.compressed).length).toBe(1);
      // B was untouched → still 4 raw entries, 0 digests
      expect(bEntries.filter((e) => e.compressed).length).toBe(0);
      expect(bEntries.length).toBe(4);
    });

    it('groups by namespace — different namespaces get different digests', async () => {
      const memory = memoryx({ dedupe: false });
      for (let i = 0; i < 4; i++) {
        await memory.remember(`fact in A ${i}`, { layer: 'long', namespace: 'A' });
        await memory.remember(`fact in B ${i}`, { layer: 'long', namespace: 'B' });
      }

      const result = await memory.compress();

      expect(result.digests).toBe(2); // one per namespace
    });

    it('does not re-compress digest entries', async () => {
      const memory = memoryx({ dedupe: false });
      for (let i = 0; i < 5; i++) {
        await memory.remember(`fact ${i}`, { layer: 'long' });
      }
      await memory.compress();
      const sizeAfterFirst = await memory.size();

      // Run compress again — the lone digest shouldn't be touched.
      const result = await memory.compress();

      expect(result.compressed).toBe(0);
      expect(await memory.size()).toBe(sizeAfterFirst);
    });

    it('preserves the highest importance from the batch', async () => {
      const memory = memoryx({ dedupe: false });
      await memory.remember('low signal note', { layer: 'long', importance: 0.1 });
      await memory.remember('CRITICAL fact', { layer: 'long', importance: 0.95 });
      await memory.remember('another low one', { layer: 'long', importance: 0.1 });

      await memory.compress();

      const all = await memory.all();
      const digest = all.find((e) => e.compressed)!;
      expect(digest.importance).toBeGreaterThanOrEqual(0.95);
    });

    it('compresses entries older than a duration string', async () => {
      const memory = memoryx({ dedupe: false });

      // Insert old entries by directly mutating (simulating prior insertions)
      for (let i = 0; i < 4; i++) {
        const id = await memory.remember(`old fact ${i}`, { layer: 'long' });
        // Mutate accessedAt to look old
        const all = await memory.all();
        const e = all.find((x) => x.id === id)!;
        e.accessedAt = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
      }

      // Insert a fresh entry
      await memory.remember('fresh fact', { layer: 'long' });

      const result = await memory.compress({ olderThan: '7d' });

      // Only the 4 old ones should be compressed
      expect(result.compressed).toBe(4);

      const all = await memory.all();
      const fresh = all.find((e) => e.text === 'fresh fact');
      expect(fresh).toBeDefined(); // fresh entry survived
    });

    it('throws helpfully on malformed duration strings', async () => {
      const memory = memoryx();
      await expect(memory.compress({ olderThan: 'forever' as any })).rejects.toThrow(/duration/);
    });

    it('fires onCompress hook with result', async () => {
      const onCompress = vi.fn();
      const memory = memoryx({ dedupe: false, hooks: { onCompress } });
      for (let i = 0; i < 4; i++) {
        await memory.remember(`fact ${i}`, { layer: 'long' });
      }
      await memory.compress();
      expect(onCompress).toHaveBeenCalledTimes(1);
      const [result] = onCompress.mock.calls[0];
      expect(result.compressed).toBe(4);
      expect(result.digests).toBe(1);
    });

    it('does not fire onCompress when nothing was compressed', async () => {
      const onCompress = vi.fn();
      const memory = memoryx({ hooks: { onCompress } });
      await memory.compress();
      expect(onCompress).not.toHaveBeenCalled();
    });
  });

  describe('automatic compression on long-term overflow', () => {
    it('compresses when long-term overflows instead of silently dropping', async () => {
      const memory = memoryx({
        dedupe: false,
        shortTermLimit: 1,
        longTermLimit: 3,
        compress: true,
      });

      // Push 10 entries — short-term will promote to long-term, which will overflow
      for (let i = 0; i < 10; i++) {
        await memory.remember(`fact ${i}`);
      }

      const all = await memory.all();
      const digests = all.filter((e) => e.compressed);

      // We should have at least one digest preserving older info
      expect(digests.length).toBeGreaterThanOrEqual(1);
    });

    it('falls back to plain eviction when compress is disabled', async () => {
      const memory = memoryx({
        dedupe: false,
        shortTermLimit: 1,
        longTermLimit: 2,
        compress: false,
      });
      for (let i = 0; i < 10; i++) {
        await memory.remember(`fact ${i}`);
      }
      const all = await memory.all();
      const digests = all.filter((e) => e.compressed);
      expect(digests.length).toBe(0);
    });
  });

  describe('custom summarizer', () => {
    it('uses a custom summarizer when provided', async () => {
      const summarizer = vi.fn((entries: MemoryEntry[]) => {
        return `[CUSTOM] ${entries.length} entries`;
      });

      const memory = memoryx({ dedupe: false, summarizer });
      for (let i = 0; i < 4; i++) {
        await memory.remember(`fact ${i}`, { layer: 'long' });
      }
      await memory.compress();

      expect(summarizer).toHaveBeenCalled();
      const all = await memory.all();
      const digest = all.find((e) => e.compressed)!;
      expect(digest.text).toContain('[CUSTOM]');
      expect(digest.text).toContain('4 entries');
    });

    it('supports async summarizers (e.g. LLM-backed)', async () => {
      const summarizer = async (entries: MemoryEntry[]) => {
        await new Promise((r) => setTimeout(r, 5));
        return `async-summary: ${entries.map((e) => e.text).join(' / ')}`;
      };

      const memory = memoryx({ dedupe: false, summarizer });
      await memory.remember('alpha', { layer: 'long' });
      await memory.remember('beta', { layer: 'long' });
      await memory.remember('gamma', { layer: 'long' });

      await memory.compress();
      const all = await memory.all();
      const digest = all.find((e) => e.compressed)!;
      expect(digest.text).toContain('async-summary');
      expect(digest.text).toContain('alpha');
    });
  });

  describe('extractiveSummarizer', () => {
    it('returns a single line for a single entry', async () => {
      const entry: MemoryEntry = {
        id: 'x',
        data: 'just one fact',
        text: 'just one fact',
        tokens: ['just', 'one', 'fact'],
        createdAt: 0,
        accessedAt: 0,
        hits: 0,
        importance: 0.5,
        layer: 'long',
        namespace: 'default',
        tags: [],
        expiresAt: null,
      };
      const result = await extractiveSummarizer([entry]);
      expect(result).toBe('just one fact');
    });

    it('returns empty string for empty input', async () => {
      const result = await extractiveSummarizer([]);
      expect(result).toBe('');
    });

    it('prioritizes high-importance and high-hit entries', async () => {
      const entries: MemoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
        id: `e${i}`,
        data: `fact ${i}`,
        text: `fact ${i}`,
        tokens: [`fact`, String(i)],
        createdAt: 0,
        accessedAt: 0,
        hits: i === 7 ? 100 : 0,           // entry 7 is hot
        importance: i === 3 ? 1.0 : 0.1,   // entry 3 is important
        layer: 'long',
        namespace: 'default',
        tags: [],
        expiresAt: null,
      }));

      const result = await extractiveSummarizer(entries);
      expect(result).toContain('fact 3'); // high importance kept
      expect(result).toContain('fact 7'); // high hits kept
    });
  });

  describe('compression preserves recallability', () => {
    it('digests are still searchable after compression', async () => {
      const memory = memoryx({ dedupe: false });
      await memory.remember('the chocolate cake recipe was fantastic', {
        layer: 'long', importance: 0.9,
      });
      await memory.remember('boring trivia about elevators', { layer: 'long' });
      await memory.remember('another forgettable note', { layer: 'long' });

      await memory.compress();

      const results = await memory.recall('chocolate');
      // The digest should still surface the chocolate fact
      expect(results.length).toBeGreaterThan(0);
      expect(String(results[0].data).toLowerCase()).toContain('chocolate');
    });
  });
});
