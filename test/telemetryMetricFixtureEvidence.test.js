const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const telemetry = require('../scripts/dogfood/telemetry');
const fixtures = require('../scripts/dogfood/fixtures');
const envelopeApi = require('../scripts/dogfood/run-envelope');
const signals = { phases: ['sidebarReadyMs', 'panelReadyMs'], input: ['panelSwitchMs'], memory: ['rssBytes'], dom: ['nodeCount'], subprocess: ['childCount'] };

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function provenance() {
  const executable = { realpath: process.execPath, sha256: 'a'.repeat(64), stat: { dev: '1', ino: '2', size: 3, mode: 0o100755, mtimeNs: '4' } };
  const body = { schemaVersion: 1, head: 'b'.repeat(40), tree: 'c'.repeat(40), extensionVersion: '1.2.3', platform: process.platform, arch: process.arch, node: executable, vscode: { ...executable, sha256: 'd'.repeat(64) } };
  return { ...body, digest: crypto.createHash('sha256').update(stableJson(body)).digest('hex') };
}

function metric(seed) {
  return [{ kind: 'cold', value: seed }, { kind: 'warm', value: seed + 1 }, { kind: 'warm', value: seed + 2 }];
}

function reportFor(envelope) {
  const aggregateIdentity = { runId: envelope.runId, lane: envelope.lane, source: envelope.provenance.head, build: envelope.provenance.digest, reportPath: envelope.paths.aggregateResult, executables: { node: envelope.provenance.node, vscode: envelope.provenance.vscode } };
  const runs = telemetry.requiredFixtures().map((fixture, fixtureIndex) => {
    const groups = Object.fromEntries(Object.entries(signals).map(([group, names], groupIndex) => [group, Object.fromEntries(names.map((name, signalIndex) => [name, metric(10 + fixtureIndex + groupIndex + signalIndex)]))]));
    const manifest = telemetry.expectedFixtureManifest(fixture);
    return telemetry.makeFixtureResult({
      fixture: { ...fixture, actualRepoCount: fixture.repoCount, manifest: { ...manifest, digest: fixtures.fixtureManifestDigest(manifest) } },
      ...groups,
      identity: { runId: envelope.runId, lane: `telemetry-${fixture.fileCount}f-${fixture.repoCount}r`, source: envelope.provenance.head, build: envelope.provenance.digest, fixture: telemetry.fixtureKey(fixture), reportPath: path.join(envelope.paths.childrenDir, `${telemetry.fixtureKey(fixture)}.json`) }
    });
  });
  return telemetry.makeTelemetryReport({ versions: { node: 'test', vscode: 'test', extension: 'test', platform: 'test' }, runs, scope: 'full', samples: { cold: 1, warm: 2 }, failures: [], identity: aggregateIdentity, envelopeDigest: envelope.digest, provenance: envelope.provenance });
}

function publishedEvidence() {
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-metric-fixture-')), 'telemetry.json');
  const envelope = envelopeApi.createRunEnvelope({ outputPath: output, repoRoot: root, runId: crypto.randomUUID(), lane: 'telemetry-matrix', provenance: provenance() });
  const report = reportFor(envelope);
  const processIdentity = { pid: 100, ppid: 1, processGroup: 100, session: 100, startTicks: '1', executable: '/test/code' };
  for (const run of report.runs) envelopeApi.publishJsonOnce(run.identity.reportPath, { schemaVersion: 1, status: 'success', ok: true, classification: 'none', generatedAt: new Date().toISOString(), runId: envelope.runId, lane: run.identity.lane, envelopeDigest: envelope.digest, provenance: envelope.provenance, process: { root: processIdentity, listener: processIdentity }, telemetry: run }, { runRoot: envelope.paths.runRoot });
  return { envelope, report };
}

function replacePublished(pathname, value, runRoot) {
  fs.chmodSync(pathname, 0o600);
  fs.unlinkSync(pathname);
  envelopeApi.publishJsonOnce(pathname, value, { runRoot });
}

const cases = [];
for (const [group, names] of Object.entries(signals)) {
  for (const name of names) {
    for (const kind of ['cold', 'warm']) {
      for (let index = 0; index < (kind === 'cold' ? 1 : 2); index++) {
        cases.push([`${group}.${name}.${kind}[${index}].value`, run => run[group][name][kind].samples[index].value += 1]);
        cases.push([`${group}.${name}.${kind}[${index}].kind`, run => run[group][name][kind].samples[index].kind = kind === 'cold' ? 'warm' : 'cold']);
      }
    }
    cases.push([`${group}.${name}.warm.cardinality`, run => run[group][name].warm.samples.pop()]);
    for (let index = 0; index < 3; index++) {
      cases.push([`${group}.${name}.all[${index}].value`, run => run[group][name].all.samples[index].value += 1]);
      cases.push([`${group}.${name}.all[${index}].kind`, run => run[group][name].all.samples[index].kind = 'invalid']);
    }
    for (const kind of ['cold', 'warm', 'all']) for (const percentileName of ['p50', 'p95']) cases.push([`${group}.${name}.${kind}.${percentileName}`, run => run[group][name][kind][percentileName] += 1]);
  }
}
cases.push(
  ['fixture.actualRepoCount', run => run.fixture.actualRepoCount -= 1],
  ['fixture.repository.trackedFileCount', run => run.fixture.manifest.repositories[0].trackedFileCount += 1],
  ['fixture.repository.changedFileCount', run => run.fixture.manifest.repositories[0].changedFileCount += 1],
  ['fixture.total', run => run.fixture.fileCount += 1],
  ['fixture.manifest.digest', run => run.fixture.manifest.digest = '0'.repeat(64)]
);

for (const [name, mutate] of cases) {
  const { envelope, report } = publishedEvidence();
  const aggregate = structuredClone(report);
  const childPath = aggregate.runs[0].identity.reportPath;
  const child = JSON.parse(fs.readFileSync(childPath, 'utf8'));
  mutate(aggregate.runs[0]);
  mutate(child.telemetry);
  replacePublished(childPath, child, envelope.paths.runRoot);
  envelopeApi.publishJsonOnce(envelope.paths.aggregateResult, aggregate, { runRoot: envelope.paths.runRoot });
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/check-dogfood-telemetry.js'), envelope.paths.aggregateResult], { encoding: 'utf8' });
  assert.notStrictEqual(result.status, 0, `${name} passed the immutable checker:\n${result.stdout}\n${result.stderr}`);
}

console.log(`ok - immutable checker rejects ${cases.length} consistent raw metric and fixture mutations`);
