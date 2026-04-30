// Demonstrates that auto-compression preserves recall while shrinking
// the token footprint — the actual claim of the v1.1 release.
//
// Run with: node benchmarks/compression-bench.mjs

import memoryx from '../dist/index.js';

const N = 500;

function approxTokens(text) {
  return Math.ceil(text.length / 4);
}

async function totalTokens(memory) {
  const all = await memory.all();
  return all.reduce((sum, e) => sum + approxTokens(e.text), 0);
}

async function main() {
  console.log('\n@munesoft/memoryx  ─  compression');
  console.log('─'.repeat(60));

  // Baseline: no compression
  const noCompress = memoryx({ dedupe: false, compress: false });
  for (let i = 0; i < N; i++) {
    await noCompress.remember(
      `agent log entry ${i}: the user asked about feature X and we responded with the standard explanation referencing the docs`,
      { importance: i % 50 === 0 ? 0.9 : 0.2 },
    );
  }
  const baselineTokens = await totalTokens(noCompress);
  const baselineEntries = await noCompress.size();

  // With compression
  const withCompress = memoryx({ dedupe: false, compress: true });
  for (let i = 0; i < N; i++) {
    await withCompress.remember(
      `agent log entry ${i}: the user asked about feature X and we responded with the standard explanation referencing the docs`,
      { importance: i % 50 === 0 ? 0.9 : 0.2 },
    );
  }
  const beforeManualTokens = await totalTokens(withCompress);
  const beforeManualEntries = await withCompress.size();

  const result = await withCompress.compress();
  const afterTokens = await totalTokens(withCompress);
  const afterEntries = await withCompress.size();

  console.log(`\nInserted ${N} entries (1 in 50 marked high-importance):\n`);
  console.log(`  Baseline (compress: false)`);
  console.log(`    entries: ${baselineEntries}`);
  console.log(`    tokens:  ~${baselineTokens.toLocaleString()}`);

  console.log(`\n  Auto-compression (compress: true, before manual)`);
  console.log(`    entries: ${beforeManualEntries}`);
  console.log(`    tokens:  ~${beforeManualTokens.toLocaleString()}`);
  console.log(`    saved:   ${(100 * (1 - beforeManualTokens / baselineTokens)).toFixed(1)}%`);

  console.log(`\n  After manual compress() pass`);
  console.log(`    entries: ${afterEntries}`);
  console.log(`    tokens:  ~${afterTokens.toLocaleString()}`);
  console.log(`    saved:   ${(100 * (1 - afterTokens / baselineTokens)).toFixed(1)}% vs baseline`);
  console.log(`    summary: compressed ${result.compressed} entries → ${result.digests} digests`);

  // Recall preservation: high-importance entries should still surface
  console.log('\nRecall preservation check:');
  const probes = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450];
  let preserved = 0;
  for (const i of probes) {
    const results = await withCompress.recall(`entry ${i}`, { limit: 5 });
    if (results.length > 0) preserved++;
  }
  console.log(`  ${preserved}/${probes.length} important entries still recallable`);

  // Demo auto-compression with a tight long-term limit
  console.log('\n\nAuto-compression at long-term limit:');
  const tight = memoryx({ dedupe: false, longTermLimit: 50, shortTermLimit: 10 });
  for (let i = 0; i < N; i++) {
    await tight.remember(
      `agent log entry ${i}: the user asked about feature X and we responded with the standard explanation referencing the docs`,
      { importance: i % 50 === 0 ? 0.9 : 0.2 },
    );
  }
  const tightTokens = await totalTokens(tight);
  const tightEntries = await tight.size();
  const tightDigests = (await tight.all()).filter((e) => e.compressed).length;
  console.log(`    entries: ${tightEntries} (${tightDigests} are digests)`);
  console.log(`    tokens:  ~${tightTokens.toLocaleString()}`);
  console.log(`    saved:   ${(100 * (1 - tightTokens / baselineTokens)).toFixed(1)}% vs baseline`);
  console.log('─'.repeat(60));
}

main().catch(console.error);
