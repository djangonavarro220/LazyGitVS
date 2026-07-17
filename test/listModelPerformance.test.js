const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const { performance } = require('perf_hooks');
const { buildTreeRows, FilePanelListModel } = require('../out/panels');

const ITEM_COUNT = 10_000;
const BENCHMARK_ROUNDS = 3;
const WARMUPS = 20;
const MEASURED = 100;
const ABSOLUTE_THRESHOLD_MS = 16;
const BASELINE_P95_MS = 61.679;
const RELATIVE_THRESHOLD_MS = BASELINE_P95_MS * 0.75;
const EXPECTED_FIXTURE_CHECKSUM = '703f82d119bcf12c8a67facb971e57d2d829521e8e952c4728dc4d99b856fa13';
const EXPECTED_ROW_COUNT = 10_502;
const EXPECTED_SEMANTIC_CHECKSUM = '666ea908940d814d6ef77e9e71e0fff0115460af0796e9e161aeecda5e260c36';
const fixture = Array.from({ length: ITEM_COUNT }, (_, index) => {
  const wide = String(index % 500).padStart(3, '0');
  const branch = index % 5 === 0 ? `deep/a/b/c/d/e/${wide}` : `wide/${wide}`;
  return {
    path: `${branch}/file-${String(Math.floor(index / 500)).padStart(2, '0')}-${String(index).padStart(5, '0')}.ts`,
    xy: [' M', 'M ', '??', 'A '][index % 4],
    staged: index % 2 === 1,
    untracked: index % 4 === 2
  };
});
const fixtureChecksum = crypto.createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
assert.strictEqual(fixture.length, ITEM_COUNT, 'benchmark fixture item count must remain pinned');
assert.strictEqual(fixtureChecksum, EXPECTED_FIXTURE_CHECKSUM, 'benchmark fixture contents must remain pinned');
const options = { showFileTree: true, fileTreeSortOrder: 'foldersFirst', fileTreeSortCaseSensitive: false };
const baseRequest = {
  files: fixture,
  selection: 0,
  projectionKey: 'all',
  treeKey: 'expanded',
  project: files => [...files],
  options,
  collapsedDirs: new Set()
};

let realBuilderCalls = 0;
function build() {
  realBuilderCalls++;
  return buildTreeRows(fixture, options, new Set());
}

function semanticShape(rows) {
  return rows.map(row => [row.kind, row.path, row.label, row.depth, row.kind === 'dir' ? row.collapsed : null]);
}

function validateSemanticResult(rows) {
  assert.strictEqual(rows.length, EXPECTED_ROW_COUNT, 'real tree row count must remain exact and non-vacuous');
  const kindCounts = rows.reduce((counts, row) => {
    assert(row.kind === 'dir' || row.kind === 'file', `unexpected tree row kind ${row.kind}`);
    counts[row.kind]++;
    return counts;
  }, { dir: 0, file: 0 });
  assert.deepStrictEqual(kindCounts, { dir: 502, file: 10_000 }, 'real tree kind shape must remain stable');
  assert.deepStrictEqual(
    rows.slice(0, 3).map(row => [row.kind, row.path, row.label, row.depth]),
    [
      ['dir', 'deep/a/b/c/d/e', 'deep/a/b/c/d/e', 0],
      ['dir', 'deep/a/b/c/d/e/000', '000', 1],
      ['file', 'deep/a/b/c/d/e/000/file-00-00000.ts', 'file-00-00000.ts', 2]
    ],
    'deep compressed-chain shape and paths must remain stable'
  );
  assert.deepStrictEqual(
    rows.slice(-2).map(row => [row.kind, row.path, row.label, row.depth]),
    [
      ['file', 'wide/499/file-18-09499.ts', 'file-18-09499.ts', 2],
      ['file', 'wide/499/file-19-09999.ts', 'file-19-09999.ts', 2]
    ],
    'wide-tail ordering and paths must remain stable'
  );
  assert(rows.some(row => row.kind === 'dir' && row.path === 'wide' && row.label === 'wide' && row.depth === 0), 'wide root directory must remain present');
  const semanticChecksum = crypto.createHash('sha256').update(JSON.stringify(semanticShape(rows))).digest('hex');
  assert.strictEqual(semanticChecksum, EXPECTED_SEMANTIC_CHECKSUM, 'real tree semantic checksum must remain stable');
  assert.strictEqual(new Set(rows.map(row => row.path)).size, rows.length, 'the real tree publishes one unique path identity per row');
  return { kindCounts, semanticChecksum };
}

function measureRound() {
  for (let warmup = 0; warmup < WARMUPS; warmup++) build();
  const samplesMs = [];
  let rows;
  for (let run = 0; run < MEASURED; run++) {
    const started = performance.now();
    rows = build();
    samplesMs.push(performance.now() - started);
  }
  const ordered = [...samplesMs].sort((a, b) => a - b);
  return { p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1], rows, samplesMs };
}

const rounds = Array.from({ length: BENCHMARK_ROUNDS }, measureRound);
const p95Ms = [...rounds].sort((a, b) => a.p95Ms - b.p95Ms)[Math.floor(BENCHMARK_ROUNDS / 2)].p95Ms;
const final = rounds[rounds.length - 1].rows;
const semanticResult = validateSemanticResult(final);
assert.strictEqual(realBuilderCalls, BENCHMARK_ROUNDS * (WARMUPS + MEASURED), 'benchmark must call the imported production buildTreeRows for every build');
assert(p95Ms <= ABSOLUTE_THRESHOLD_MS, `real Files seam nearest-rank p95 ${p95Ms.toFixed(3)}ms exceeds ${ABSOLUTE_THRESHOLD_MS}ms`);
assert(p95Ms <= RELATIVE_THRESHOLD_MS, `real Files seam nearest-rank p95 ${p95Ms.toFixed(3)}ms exceeds 75% of ${BASELINE_P95_MS.toFixed(3)}ms baseline`);

let projectCalls = 0;
const hitModel = new FilePanelListModel();
const hitRequest = { ...baseRequest, project: files => { projectCalls++; return [...files]; } };
const hitRows = hitModel.read(hitRequest);
const hitRowIdentities = [...hitRows];
for (let selection = 1; selection <= 100; selection++) {
  const selectedRows = hitModel.read({ ...hitRequest, selection });
  assert.strictEqual(selectedRows, hitRows, 'selection-only reads keep the published snapshot');
  for (let index = 0; index < selectedRows.length; index++) assert.strictEqual(selectedRows[index], hitRowIdentities[index]);
}
assert.strictEqual(projectCalls, 1, 'selection-only cache hits allocate zero new projected rows');

console.log(JSON.stringify({
  benchmark: 'OPT-8-real-files-tree-10k',
  node: process.version,
  cpu: os.cpus()[0].model,
  fixtureItems: fixture.length,
  fixtureChecksum,
  fixtureShape: { wideDirectories: 500, deepSegments: 7 },
  benchmarkRounds: BENCHMARK_ROUNDS,
  warmupsPerRound: WARMUPS,
  measuredBuildsPerRound: MEASURED,
  statistic: 'median-of-round-nearest-rank-p95',
  baselineP95Ms: BASELINE_P95_MS,
  absoluteThresholdMs: ABSOLUTE_THRESHOLD_MS,
  relativeThresholdMs: RELATIVE_THRESHOLD_MS,
  p95Ms,
  roundP95Ms: rounds.map(round => round.p95Ms),
  rowCount: final.length,
  rowKinds: semanticResult.kindCounts,
  semanticChecksum: semanticResult.semanticChecksum,
  realBuilderCalls,
  samplesMsByRound: rounds.map(round => round.samplesMs)
}));
