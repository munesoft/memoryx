// Lightweight benchmark for memoryx recall performance.
// Run with: node benchmarks/bench.mjs

import memoryx from '../dist/index.js';

const N_ENTRIES = 1000;
const N_QUERIES = 1000;

async function bench(label, fn) {
  // Warmup
  for (let i = 0; i < 50; i++) await fn();
  const start = performance.now();
  for (let i = 0; i < N_QUERIES; i++) await fn();
  const ms = performance.now() - start;
  const perOp = (ms / N_QUERIES) * 1000;
  console.log(`  ${label.padEnd(30)} ${ms.toFixed(0).padStart(5)}ms total  ${perOp.toFixed(2)}µs/op`);
  return ms;
}

async function main() {
  console.log('\n@munesoft/memoryx  ─  performance');
  console.log('─'.repeat(60));
  console.log(`Storing ${N_ENTRIES} entries…`);

  const memory = memoryx({ dedupe: false });
  const samples = [
    'user prefers dark mode',
    'the meeting is scheduled for tuesday',
    'paris is the capital of france',
    'apple released a new product line',
    'remind me to call mom',
    'the bug is in the auth flow',
    'the deploy failed at 3am',
    'order #${i} shipped to seattle',
  ];

  const tStore = performance.now();
  for (let i = 0; i < N_ENTRIES; i++) {
    const template = samples[i % samples.length];
    await memory.remember(template.replace('${i}', i) + ` (entry ${i})`);
  }
  const storeMs = performance.now() - tStore;
  console.log(`  remember × ${N_ENTRIES}  ${storeMs.toFixed(0)}ms total  ${(storeMs / N_ENTRIES * 1000).toFixed(2)}µs/op`);
  console.log(`  size: ${await memory.size()} entries\n`);

  console.log(`Running ${N_QUERIES} recalls…`);
  const queries = ['dark mode', 'capital paris', 'meeting', 'auth', 'mom', 'apple'];

  // Wrap in sync since memory is in-memory and the awaits resolve immediately
  let q = 0;
  await bench('recall (limit=10)', async () => {
    await memory.recall(queries[q++ % queries.length]);
  });

  await bench('recall (limit=1)', async () => {
    await memory.recall(queries[q++ % queries.length], { limit: 1 });
  });

  await bench('recall (recentFirst)', async () => {
    await memory.recall(queries[q++ % queries.length], { recentFirst: true });
  });

  console.log('\nContext budget:');
  const ctx = await memory.context('dark mode preferences', { budget: 200 });
  console.log(`  context (200 tokens): ${ctx.length} chars`);
  console.log('─'.repeat(60));
}

main().catch(console.error);
