# @munesoft/memoryx

> **Memory for AI agents in one line.**
> No embeddings. No vector DB. No setup.

[![npm version](https://img.shields.io/npm/v/@munesoft/memoryx.svg)](https://www.npmjs.com/package/@munesoft/memoryx)
[![license](https://img.shields.io/npm/l/@munesoft/memoryx.svg)](https://github.com/munesoft/memoryx/blob/main/LICENSE)
[![types](https://img.shields.io/npm/types/@munesoft/memoryx.svg)](https://www.npmjs.com/package/@munesoft/memoryx)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://github.com/munesoft/memoryx/blob/main/package.json)

```js
import memoryx from "@munesoft/memoryx";

const memory = memoryx();

await memory.remember("User prefers dark mode");
const context = await memory.context("user");
```

That's it. Five verbs total. Works in Node, the browser, any JS runtime. Production-ready.

---

## Why memoryx?

AI agents are stateless. Every prompt is a blank slate. memoryx gives them continuity — without the complexity tax.

**Three verbs you'll use 100x a day:**

```js
await memory.remember(data);              // store anything
await memory.recall("topic");              // search and rank
await memory.context("scope");             // prompt-ready, budget-aware
```

**Two more for cleanup:**

```js
await memory.forget("topic");              // remove matching entries
await memory.clear();                      // wipe everything
```

That's the entire API. No `BufferMemory` vs `VectorStoreMemory` vs `SummaryMemory`. No embedding setup. No token-counting boilerplate. You write `remember` and `recall` because that's what you mean.

---

## Quick Start

```js
import memoryx from "@munesoft/memoryx";

const memory = memoryx();

// Store anything — strings, objects, arrays, primitives
await memory.remember("User prefers dark mode");
await memory.remember({ user: "alice", plan: "pro" });
await memory.remember("Meeting at 3pm Tuesday", { tags: ["calendar"] });

// Recall by topic — substring + keyword + fuzzy, ranked by relevance + recency + importance
const prefs = await memory.recall("user preferences");

// Build prompt-ready context — recency-pinned, budget-aware, automatically compressed
const context = await memory.context("user");

// Use it in any LLM call
const response = await llm.chat({
  system: `Relevant memory:\n${context}`,
  user: userMessage,
});
```

---

## The killer feature: real compression

Most memory libraries grow until they overflow your prompt budget. memoryx **automatically folds old, low-signal entries into compressed digests** that preserve the high-importance facts.

```js
const memory = memoryx({
  longTermLimit: 1000,    // hit this and compression triggers automatically
  compress: true,         // default
});

// ...500 agent turns later...

const result = await memory.compress({ olderThan: "7d" });
// → { compressed: 423, digests: 6, tokensSaved: 11700 }
```

**Real numbers** (`benchmarks/compression-bench.mjs`, 500 typical agent log entries):

| Mode | Entries | Tokens | Saved |
|---|---|---|---|
| No compression | 500 | ~15,000 | — |
| Manual `compress()` | 101 | ~3,300 | **78%** |
| Auto-compression at limit | 61 | ~2,388 | **84%** |

All 10 high-importance entries remained recallable after compression. Compression is **extractive by default** — no LLM call, no API key, no latency hit. Plug in your own summarizer when you want richer compression:

```js
const memory = memoryx({
  summarizer: async (entries) => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Summarize these notes:\n${entries.map(e => e.text).join("\n")}`,
      }],
    });
    return response.choices[0].message.content;
  },
});
```

---

## Features

- ⚡ **One line setup** — `memoryx()` and you're done
- 🧠 **Multi-layer memory** — short-term, long-term, session
- 🔍 **Semantic recall** — substring + Jaccard + fuzzy (no embeddings required)
- 📝 **Context builder** — `context(scope)` returns prompt-ready, budget-aware text
- 🗜️ **Auto compression** — old entries fold into digests, not silent eviction
- ⏱ **TTL** — entries expire automatically
- 🏷 **Namespaces + tags** — slice memory cleanly
- ⭐ **Importance scoring** — pin critical facts so they survive compression
- 🔁 **Auto-deduplication** — duplicate or near-duplicate entries get merged
- 🪝 **Hooks** — `onRemember`, `onRecall`, `onCompress`, `onForget`, `onClear`
- 🔌 **Pluggable storage** — memory (default), file, Redis, or your own adapter
- 🔌 **Pluggable summarizer** — extractive default, plug in any LLM
- 📦 **ESM + CJS** — tree-shakable, fully typed
- 📦 **Zero dependencies** — runs in Node, the browser, anywhere
- 🚀 **Fast** — sub-3ms recall on 1k-entry in-memory stores

---

## API

### `memoryx(options?)`

```ts
const memory = memoryx({
  ai: true,                    // prompt-overflow-aware context building
  shortTerm: true,             // enable short-term layer (default true)
  longTerm: true,              // enable long-term layer (default true)
  session: true,               // enable session layer (default true)
  store: "memory",             // "memory" | "file" | { type: "redis", client }
  namespace: "default",        // default namespace
  shortTermLimit: 100,         // promotes to long-term beyond this
  longTermLimit: 1000,         // compresses (or evicts) beyond this
  contextBudget: 2000,         // approximate tokens for context()
  dedupe: true,                // auto-merge near-duplicates
  dedupeThreshold: 0.85,       // similarity for dedupe (0–1)
  compress: true,              // auto-compress on overflow (default true)
  summarizer: extractive,      // pluggable — see "compression"
  hooks: { onRemember, onRecall, onCompress, onForget, onClear },
});
```

### `remember(data, options?)`

Store anything. Returns the entry id.

```ts
await memory.remember(data, {
  ttl: 60_000,                 // expire after 60 seconds
  tags: ["user", "preference"],
  importance: 0.9,             // 0–1, default 0.5 — high-importance survives compression
  namespace: "ecommerce",
  layer: "long",               // "short" | "long" | "session"
});
```

### `recall(query, options?)`

Search and rank. Returns scored results.

```ts
const results = await memory.recall("user preferences", {
  limit: 10,
  minScore: 0.2,
  namespace: "ecommerce",
  recentFirst: false,
  tags: ["preference"],
  layer: "long",
});

// [{ entry, data, score, scores: { relevance, recency, importance } }]
```

Scoring blends **substring containment**, **Jaccard token overlap**, and **fuzzy token similarity** for relevance, then combines with **recency** (7-day half-life) and **importance**.

### `context(scope?, options?)`

Build prompt-ready text under a token budget.

```ts
const ctx = await memory.context("user preferences", {
  budget: 500,
  namespace: "user",
  recentCount: 3,              // always include the N most-recent entries
});
```

When `scope` is given, entries relevant to it rank higher. The output is plain text, one entry per line, ready to splice into a prompt.

### `compress(options?)`

Manually compress old entries into digests. Useful for keeping prompt budgets low in long-running agents.

```ts
const result = await memory.compress({
  olderThan: "7d",             // number (ms) or duration string: "60s", "1h", "7d"
  namespace: "chat",           // optional, restrict to one namespace
  minBatch: 3,                 // minimum entries to trigger compression
});
// → { compressed: 423, digests: 6, tokensSaved: 11700 }
```

Compression also runs automatically when `longTermLimit` is exceeded.

### `forget(query)` / `clear(namespace?)`

```ts
await memory.forget("temporary scratch notes");
await memory.clear();              // wipe all
await memory.clear("ecommerce");   // wipe one namespace
```

### `stream(chunk, options?)`

Capture streaming AI output without losing partials:

```ts
for await (const chunk of llmStream) {
  await memory.stream(chunk, { streamId: "response-42" });
}
const full = await memory.recall("...", { tags: ["stream:response-42"] });
```

---

## AI agent example

```js
import memoryx from "@munesoft/memoryx";

const memory = memoryx({ ai: true });

async function chatTurn(userMessage) {
  // Pull prompt-ready context, sized to the budget
  const context = await memory.context(userMessage, { budget: 500 });

  const response = await llm.complete({
    system: `You are a helpful assistant. Relevant memory:\n${context}`,
    user: userMessage,
  });

  // Persist this turn so the next call has continuity
  await memory.remember(`User said: ${userMessage}`, { tags: ["chat"] });
  await memory.remember(`Assistant said: ${response}`, {
    tags: ["chat"],
    importance: 0.7,
  });

  return response;
}

// Periodically compress old turns to keep token usage bounded
setInterval(() => memory.compress({ olderThan: "1h" }), 60_000 * 60);
```

---

## Storage adapters

### In-memory (default)

```js
const memory = memoryx();  // uses MemoryAdapter
```

### File (Node.js)

```js
const memory = memoryx({ store: "file" });
const memory = memoryx({ store: { type: "file", path: "./my-memory.json" } });
```

Writes are debounced (50ms) to avoid I/O thrashing.

### Redis

memoryx is zero-dependency, so you bring your own client:

```js
import Redis from "ioredis";

const memory = memoryx({
  store: {
    type: "redis",
    client: new Redis(),
    prefix: "myapp:memory",
  },
});
```

Works with `ioredis`, `node-redis`, Upstash, or anything implementing `get / set / del / keys`.

### Custom

```ts
import type { StorageAdapter, MemoryEntry } from "@munesoft/memoryx";

class MyAdapter implements StorageAdapter {
  async get(id: string): Promise<MemoryEntry | undefined> { /* ... */ }
  async set(entry: MemoryEntry): Promise<void> { /* ... */ }
  async delete(id: string): Promise<boolean> { /* ... */ }
  async clear(): Promise<void> { /* ... */ }
  async all(): Promise<MemoryEntry[]> { /* ... */ }
  async size(): Promise<number> { /* ... */ }
}

const memory = memoryx({ store: new MyAdapter() });
```

---

## Hooks

```js
const memory = memoryx({
  hooks: {
    onRemember: (entry) => console.log("stored", entry.id),
    onRecall: (query, results) => console.log("recalled", query, results.length),
    onCompress: (result) => console.log("compressed", result.tokensSaved, "tokens"),
    onForget: (ids) => console.log("forgot", ids),
    onClear: () => console.log("cleared"),
  },
});
```

Hooks may be async. Errors thrown inside a hook are swallowed — they never crash your application.

---

## Use cases

- **AI agents** — give your agent memory across turns, sessions, and runs
- **Chatbots** — remember preferences, conversation history, mid-task state
- **Personalization** — track recent behavior without a database
- **RAG augmentation** — lightweight working memory alongside your vector DB
- **Workflow memory** — store intermediate results in long-running pipelines

---

## Performance

```
Storing 1000 entries…
  remember × 1000     ~150ms total

Running 1000 recalls on a 1000-entry store…
  recall (limit=10)   ~2ms / op
  recall (limit=1)    ~2ms / op
```

Compression saves **78%–84% of tokens** on typical agent logs while keeping all high-importance entries recallable.

---

## TypeScript

Full types are bundled. Key exports:

```ts
import memoryx, {
  Memory,
  MemoryAdapter,
  FileAdapter,
  RedisAdapter,
  extractiveSummarizer,
  type MemoryEntry,
  type MemoryxOptions,
  type MemoryOptions,
  type RecallOptions,
  type RecallResult,
  type CompressOptions,
  type CompressResult,
  type StorageAdapter,
  type Summarizer,
} from "@munesoft/memoryx";
```

---

## Philosophy

> Memory turns AI from reactive to intelligent.

memoryx is opinionated about being unopinionated:

- **No required setup** — useful in 1 line, scales when you need it
- **No external services** — works offline, in the browser, anywhere JS runs
- **No vector DB required** — keyword + fuzzy is enough for most agent memory
- **No silent data loss** — compression preserves signal; eviction is the fallback, not the default
- **Drop-in scaling** — swap the adapter, not the API

The future isn't frameworks controlling everything. It's small, dominant primitives used everywhere.

---

## License

MIT © [munesoft](https://github.com/munesoft)

<img referrerpolicy="no-referrer-when-downgrade" src="https://static.scarf.sh/a.png?x-pxid=b0206cff-a425-4403-912c-77457327b291" />
