import { describe, expect, it, vi } from 'vitest';
import memoryx, { Memory, MemoryAdapter } from '../src/index.js';

// ─── Smoke: zero-config primary API ───────────────────────────────────────────

describe('memoryx() zero-config', () => {
  it('works with no arguments', async () => {
    const memory = memoryx();
    await memory.remember('User prefers dark mode');
    const results = await memory.recall('user preferences');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].data).toBe('User prefers dark mode');
  });

  it('returns a Memory instance', () => {
    const memory = memoryx();
    expect(memory).toBeInstanceOf(Memory);
  });

  it('has a default export equal to the named export', async () => {
    const m1 = memoryx();
    const m2 = (await import('../src/index.js')).default();
    expect(typeof m1.remember).toBe('function');
    expect(typeof m2.remember).toBe('function');
  });
});

// ─── remember / recall ────────────────────────────────────────────────────────

describe('remember + recall', () => {
  it('stores and recalls strings', async () => {
    const memory = memoryx();
    await memory.remember('The capital of France is Paris');
    const results = await memory.recall('France capital');
    expect(results[0].data).toBe('The capital of France is Paris');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('stores and recalls objects', async () => {
    const memory = memoryx();
    await memory.remember({ user: 'alice', plan: 'pro', signups: 12 });
    const results = await memory.recall('alice');
    expect(results.length).toBeGreaterThan(0);
    expect((results[0].data as any).user).toBe('alice');
  });

  it('returns empty array for nonsense queries', async () => {
    const memory = memoryx();
    await memory.remember('Cats are friendly mammals');
    const results = await memory.recall('thermonuclear quantum entanglement');
    expect(results).toEqual([]);
  });

  it('respects the limit option', async () => {
    const memory = memoryx({ dedupe: false });
    for (let i = 0; i < 10; i++) {
      await memory.remember(`fact number ${i}: shared topic about apples`);
    }
    const results = await memory.recall('apples', { limit: 3 });
    expect(results.length).toBe(3);
  });

  it('respects the minScore filter', async () => {
    const memory = memoryx({ dedupe: false });
    await memory.remember('apple banana cherry');
    await memory.remember('completely unrelated topic about ships');
    const results = await memory.recall('apple', { minScore: 0.5 });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('ranks more relevant entries higher', async () => {
    const memory = memoryx({ dedupe: false });
    await memory.remember('the user loves chocolate ice cream');
    await memory.remember('the weather is sunny today');
    await memory.remember('chocolate is a popular dessert flavor');
    const results = await memory.recall('chocolate');
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Both chocolate entries should rank above the weather one
    const topTexts = results.slice(0, 2).map((r) => String(r.data));
    expect(topTexts.every((t) => t.includes('chocolate'))).toBe(true);
  });

  it('returns the entry id from remember()', async () => {
    const memory = memoryx();
    const id = await memory.remember('test entry');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});

// ─── TTL ──────────────────────────────────────────────────────────────────────

describe('TTL', () => {
  it('expires entries after the ttl elapses', async () => {
    const memory = memoryx();
    await memory.remember('short-lived', { ttl: 30 });
    let results = await memory.recall('short-lived');
    expect(results.length).toBe(1);

    await new Promise((r) => setTimeout(r, 60));

    results = await memory.recall('short-lived');
    expect(results.length).toBe(0);
  });

  it('keeps entries with no ttl indefinitely', async () => {
    const memory = memoryx();
    await memory.remember('persistent');
    await new Promise((r) => setTimeout(r, 30));
    const results = await memory.recall('persistent');
    expect(results.length).toBe(1);
  });
});

// ─── Namespaces ───────────────────────────────────────────────────────────────

describe('namespaces', () => {
  it('isolates entries by namespace on recall', async () => {
    const memory = memoryx();
    await memory.remember('order #123 shipped', { namespace: 'ecommerce' });
    await memory.remember('user logged in', { namespace: 'auth' });

    const ecom = await memory.recall('order', { namespace: 'ecommerce' });
    expect(ecom.length).toBe(1);

    const auth = await memory.recall('order', { namespace: 'auth' });
    expect(auth.length).toBe(0);
  });

  it('clears only the requested namespace', async () => {
    const memory = memoryx();
    await memory.remember('a', { namespace: 'ns1' });
    await memory.remember('b', { namespace: 'ns2' });
    await memory.clear('ns1');
    const all = await memory.all();
    expect(all.length).toBe(1);
    expect(all[0].namespace).toBe('ns2');
  });
});

// ─── Tags ────────────────────────────────────────────────────────────────────

describe('tags', () => {
  it('filters recall by tag', async () => {
    const memory = memoryx({ dedupe: false });
    await memory.remember('alice prefers coffee', { tags: ['user', 'preference'] });
    await memory.remember('bob prefers tea', { tags: ['user', 'preference'] });
    await memory.remember('the office opens at 9am', { tags: ['policy'] });

    const prefs = await memory.recall('prefer', { tags: ['preference'] });
    expect(prefs.length).toBe(2);

    const policy = await memory.recall('prefer', { tags: ['policy'] });
    expect(policy.length).toBe(0);
  });
});

// ─── Importance ──────────────────────────────────────────────────────────────

describe('importance', () => {
  it('clamps importance to [0,1]', async () => {
    const memory = memoryx();
    const id1 = await memory.remember('a', { importance: 5 });
    const id2 = await memory.remember('b', { importance: -3 });
    const all = await memory.all();
    const e1 = all.find((e) => e.id === id1)!;
    const e2 = all.find((e) => e.id === id2)!;
    expect(e1.importance).toBe(1);
    expect(e2.importance).toBe(0);
  });

  it('uses 0.5 as the default', async () => {
    const memory = memoryx();
    await memory.remember('default importance');
    const all = await memory.all();
    expect(all[0].importance).toBe(0.5);
  });
});

// ─── Forget / clear ──────────────────────────────────────────────────────────

describe('forget', () => {
  it('removes matching entries', async () => {
    const memory = memoryx({ dedupe: false });
    await memory.remember('Paris is the capital of France');
    await memory.remember('Berlin is the capital of Germany');
    await memory.remember('the sky is blue');

    const removed = await memory.forget('capital');
    expect(removed).toBeGreaterThanOrEqual(2);

    const remaining = await memory.all();
    expect(remaining.some((e) => e.text.includes('sky'))).toBe(true);
  });

  it('returns 0 when query is empty', async () => {
    const memory = memoryx();
    await memory.remember('something');
    const removed = await memory.forget('');
    expect(removed).toBe(0);
    expect((await memory.all()).length).toBe(1);
  });
});

describe('clear', () => {
  it('wipes all entries', async () => {
    const memory = memoryx({ dedupe: false });
    for (let i = 0; i < 5; i++) await memory.remember(`item ${i}`);
    await memory.clear();
    expect(await memory.size()).toBe(0);
  });
});

// ─── Deduplication ───────────────────────────────────────────────────────────

describe('deduplication', () => {
  it('merges identical entries', async () => {
    const memory = memoryx();
    const id1 = await memory.remember('user prefers dark mode');
    const id2 = await memory.remember('user prefers dark mode');
    expect(id1).toBe(id2);
    expect(await memory.size()).toBe(1);
  });

  it('merges near-duplicates above the threshold', async () => {
    const memory = memoryx({ dedupeThreshold: 0.5 });
    await memory.remember('alice loves chocolate cake');
    await memory.remember('alice loves chocolate cake very much');
    expect(await memory.size()).toBe(1);
  });

  it('keeps distinct entries separate', async () => {
    const memory = memoryx();
    await memory.remember('the sun is hot');
    await memory.remember('the moon is cold');
    expect(await memory.size()).toBe(2);
  });

  it('can be disabled', async () => {
    const memory = memoryx({ dedupe: false });
    await memory.remember('exact match');
    await memory.remember('exact match');
    expect(await memory.size()).toBe(2);
  });
});

// ─── Context ─────────────────────────────────────────────────────────────────

describe('context', () => {
  it('returns an empty string when nothing is stored', async () => {
    const memory = memoryx();
    expect(await memory.context()).toBe('');
  });

  it('returns prompt-ready text', async () => {
    const memory = memoryx();
    await memory.remember('User name is Alice');
    await memory.remember('User favorite color is blue');
    const ctx = await memory.context();
    expect(ctx).toContain('Alice');
    expect(ctx).toContain('blue');
  });

  it('respects the budget option', async () => {
    const memory = memoryx({ dedupe: false });
    for (let i = 0; i < 50; i++) {
      await memory.remember(`a moderately long fact about topic number ${i}`);
    }
    const ctx = await memory.context(undefined, { budget: 50 });
    // 50 tokens × 4 chars/token = 200 chars upper bound (very loose)
    expect(ctx.length).toBeLessThan(400);
  });

  it('prioritizes scope-relevant entries when scope is provided', async () => {
    const memory = memoryx({ dedupe: false, contextBudget: 30 });
    await memory.remember('weather is sunny');
    await memory.remember('user wants chocolate cake');
    await memory.remember('the moon orbits earth');
    const ctx = await memory.context('chocolate dessert', { recentCount: 0 });
    expect(ctx).toContain('chocolate');
  });
});

// ─── Hooks ───────────────────────────────────────────────────────────────────

describe('hooks', () => {
  it('fires onRemember', async () => {
    const onRemember = vi.fn();
    const memory = memoryx({ hooks: { onRemember } });
    await memory.remember('hi');
    expect(onRemember).toHaveBeenCalledTimes(1);
  });

  it('fires onRecall with results', async () => {
    const onRecall = vi.fn();
    const memory = memoryx({ hooks: { onRecall } });
    await memory.remember('test data');
    await memory.recall('test');
    expect(onRecall).toHaveBeenCalled();
    const [query, results] = onRecall.mock.calls[0];
    expect(query).toBe('test');
    expect(Array.isArray(results)).toBe(true);
  });

  it('fires onClear', async () => {
    const onClear = vi.fn();
    const memory = memoryx({ hooks: { onClear } });
    await memory.clear();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('does not crash if a hook throws', async () => {
    const memory = memoryx({
      hooks: { onRemember: () => { throw new Error('boom'); } },
    });
    await expect(memory.remember('x')).resolves.toBeTruthy();
  });
});

// ─── Streaming ───────────────────────────────────────────────────────────────

describe('stream', () => {
  it('tags chunks with a stream id', async () => {
    const memory = memoryx();
    await memory.stream('chunk 1', { streamId: 'response-1' });
    await memory.stream('chunk 2', { streamId: 'response-1' });
    const chunks = await memory.recall('chunk', { tags: ['stream:response-1'] });
    expect(chunks.length).toBe(2);
  });
});

// ─── Layer limits ────────────────────────────────────────────────────────────

describe('layer limits', () => {
  it('promotes overflow from short-term to long-term', async () => {
    const memory = memoryx({
      shortTermLimit: 3,
      longTermLimit: 100,
      dedupe: false,
    });
    for (let i = 0; i < 5; i++) {
      await memory.remember(`distinct fact about subject ${i}`);
    }
    const all = await memory.all();
    const shortCount = all.filter((e) => e.layer === 'short').length;
    const longCount = all.filter((e) => e.layer === 'long').length;
    expect(shortCount).toBeLessThanOrEqual(3);
    expect(longCount).toBeGreaterThanOrEqual(2);
  });

  it('evicts low-importance long-term overflow', async () => {
    const memory = memoryx({
      shortTermLimit: 1,
      longTermLimit: 2,
      dedupe: false,
    });
    // Pin an important entry
    await memory.remember('CRITICAL: system password is xyz', {
      importance: 1,
      layer: 'long',
    });
    // Flood with low-importance entries
    for (let i = 0; i < 20; i++) {
      await memory.remember(`unimportant trivia ${i}`, { importance: 0.1 });
    }
    const all = await memory.all();
    const hasCritical = all.some((e) => /critical/i.test(e.text));
    expect(hasCritical).toBe(true);
  });
});

// ─── Adapter swap ────────────────────────────────────────────────────────────

describe('custom adapter', () => {
  it('accepts a StorageAdapter instance directly', async () => {
    const adapter = new MemoryAdapter();
    const memory = memoryx({ store: adapter });
    await memory.remember('hello');
    expect(await adapter.size()).toBe(1);
  });

  it('throws helpfully when redis is requested without a client', () => {
    expect(() => memoryx({ store: 'redis' })).toThrow(/client/);
  });
});

// ─── Recall recentFirst ──────────────────────────────────────────────────────

describe('recentFirst recall', () => {
  it('orders by accessedAt desc when recentFirst is true', async () => {
    const memory = memoryx({ dedupe: false });
    await memory.remember('apple pie recipe');
    await new Promise((r) => setTimeout(r, 5));
    await memory.remember('apple sauce recipe');
    const results = await memory.recall('apple', { recentFirst: true });
    expect(results[0].entry.text).toContain('sauce');
  });
});

// ─── Performance smoke test ──────────────────────────────────────────────────

describe('performance', () => {
  it('recalls quickly from a small in-memory store', async () => {
    const memory = memoryx({ dedupe: false });
    for (let i = 0; i < 200; i++) {
      await memory.remember(`fact about thing ${i} with some trailing detail`);
    }
    const start = Date.now();
    await memory.recall('thing 50');
    const elapsed = Date.now() - start;
    // Generous bound — CI machines vary wildly. The real assertion is "this
    // returns at all in human time", not a specific number.
    expect(elapsed).toBeLessThan(500);
  });
});
