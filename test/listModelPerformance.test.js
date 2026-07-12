const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const { performance } = require('perf_hooks');
const { ListModelCache } = require('../out/listModel');

const ITEM_COUNT = 10_000;
const WARMUPS = 20;
const MEASURED = 100;
const THRESHOLD_MS = 16;
const fixture = Array.from({ length: ITEM_COUNT }, (_, index) => {
  const directory = index % 50 === 0 ? '' : `dir-${String(index % 200).padStart(3, '0')}`;
  const nested = index % 7 === 0 ? `/group-${index % 17}` : '';
  const name = `${index % 2 ? 'file' : 'File'}-${String(index).padStart(5, '0')}.ts`;
  return { path: directory ? `${directory}${nested}/${name}` : name, status: ['M', 'A', 'D', 'R'][index % 4], ordinal: index };
});
const fixtureChecksum = crypto.createHash('sha256').update(JSON.stringify(fixture)).digest('hex');

function treeProject(items, variant) {
  let selected = items;
  if (variant.filter) selected = selected.filter(item => item.status === variant.filter);
  if (variant.sort) selected = [...selected].sort((a, b) => a.path < b.path ? 1 : a.path > b.path ? -1 : 0);
  if (!variant.tree) return selected.map(item => ({ kind: 'file', path: item.path, depth: 0, status: item.status, ordinal: item.ordinal }));

  const rootFiles = [];
  const directories = new Map();
  for (const item of selected) {
    const slash = item.path.lastIndexOf('/');
    if (slash < 0) rootFiles.push(item);
    else {
      const directory = item.path.slice(0, slash);
      let files = directories.get(directory);
      if (!files) { files = []; directories.set(directory, files); }
      files.push(item);
    }
  }
  const rows = [];
  const comparePath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  for (const [path, files] of [...directories].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
    const collapsed = variant.collapsed && Number(path.slice(4, 7)) % 2 === 0;
    rows.push({ kind: 'dir', path, depth: 0, collapsed });
    if (!collapsed) {
      files.sort(comparePath);
      for (const item of files) rows.push({ kind: 'file', path: item.path, depth: 1, status: item.status, ordinal: item.ordinal });
    }
  }
  rootFiles.sort(comparePath);
  for (const item of rootFiles) rows.push({ kind: 'file', path: item.path, depth: 0, status: item.status, ordinal: item.ordinal });
  return rows;
}

const variants = [
  { name: 'flat', tree: false },
  { name: 'expanded-tree', tree: true },
  { name: 'half-collapsed-tree', tree: true, collapsed: true },
  { name: 'filter', tree: true, filter: 'M' },
  { name: 'sort', tree: true, sort: true }
];

function build(variant, revision) {
  const cache = new ListModelCache({ duplicateIdentity: 'error' });
  return {
    cache,
    snapshot: cache.read({
      modelId: `benchmark:${variant.name}`,
      ownerGeneration: revision,
      sourceRevision: revision,
      projectionRevision: revision,
      treeRevision: revision,
      items: fixture,
      project: items => treeProject(items, variant),
      projectedRows: 'transfer',
      identity: row => `${row.kind}:${row.path}`
    })
  };
}

const results = [];
for (const variant of variants) {
  for (let warmup = 0; warmup < WARMUPS; warmup++) build(variant, warmup + 1);
  const samplesMs = [];
  let final;
  for (let run = 0; run < MEASURED; run++) {
    const started = performance.now();
    final = build(variant, WARMUPS + run + 1);
    samplesMs.push(performance.now() - started);
  }
  const ordered = [...samplesMs].sort((a, b) => a - b);
  const p95Ms = ordered[Math.ceil(ordered.length * 0.95) - 1];
  assert(p95Ms <= THRESHOLD_MS, `${variant.name} nearest-rank p95 ${p95Ms.toFixed(3)}ms exceeds ${THRESHOLD_MS}ms`);
  assert(Object.isFrozen(final.snapshot.rows));
  assert.strictEqual(final.cache.stats().buildsPublished, 1);
  assert.strictEqual(final.cache.stats().rowAllocations, final.snapshot.rows.length);
  results.push({ name: variant.name, p95Ms, rowCount: final.snapshot.rows.length, samplesMs, counters: final.cache.stats() });
}

const hitCache = new ListModelCache({ duplicateIdentity: 'error' });
const hitRequest = {
  modelId: 'benchmark:hits', ownerGeneration: 1, sourceRevision: 1, projectionRevision: 1, treeRevision: 1, items: fixture,
  project: items => treeProject(items, variants[1]), projectedRows: 'transfer', identity: row => `${row.kind}:${row.path}`
};
const hitSnapshot = hitCache.read(hitRequest);
for (let index = 0; index < 100; index++) assert.strictEqual(hitCache.read({ ...hitRequest, selection: index }), hitSnapshot);
assert.deepStrictEqual(
  { hits: hitCache.stats().hits, builds: hitCache.stats().buildsPublished, snapshots: hitCache.stats().snapshotAllocations },
  { hits: 100, builds: 1, snapshots: 1 }
);

console.log(JSON.stringify({
  benchmark: 'LGVS-009-list-model-10k', node: process.version, cpu: os.cpus()[0].model,
  fixtureItems: fixture.length, fixtureChecksum, warmups: WARMUPS, measuredBuilds: MEASURED,
  statistic: 'nearest-rank-p95', thresholdMs: THRESHOLD_MS, variants: results
}));
