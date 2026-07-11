const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const telemetry = require(path.join(root, 'scripts', 'dogfood', 'telemetry'));
const runEnvelope = require(path.join(root, 'scripts', 'dogfood', 'run-envelope'));

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function validReport(file = path.join(os.tmpdir(), 'lgvs-valid-telemetry.json')) {
  const identity = { runId: 'run-1', lane: 'telemetry-matrix', source: 'source-1', build: 'build-1', reportPath: file };
  const runs = telemetry.requiredFixtures().map(fixture => telemetry.makeFixtureResult({
    fixture,
    phases: {
      sidebarReadyMs: [{ kind: 'cold', value: 100 }, { kind: 'warm', value: 80 }],
      panelReadyMs: [{ kind: 'cold', value: 30 }, { kind: 'warm', value: 20 }]
    },
    input: { panelSwitchMs: [{ kind: 'warm', value: 4 }, { kind: 'warm', value: 6 }] },
    memory: { rssBytes: [{ kind: 'warm', value: 1024 }] },
    dom: { nodeCount: [{ kind: 'warm', value: 100 }] },
    subprocess: { childCount: [{ kind: 'warm', value: 3 }] },
    identity: {
      runId: identity.runId,
      lane: `telemetry-${fixture.fileCount}f-${fixture.repoCount}r`,
      source: identity.source,
      build: identity.build,
      fixture: telemetry.fixtureKey(fixture),
      reportPath: path.join(path.dirname(file), `${telemetry.fixtureKey(fixture)}.json`)
    }
  }));
  return telemetry.makeTelemetryReport({
    versions: { node: 'test', vscode: 'test', extension: 'test', platform: 'test' },
    runs,
    scope: 'full',
    failures: [],
    identity
  });
}

function validEnvelopeReport() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-envelope-contract-'));
  const provenance = { head: 'a'.repeat(40), tree: 'b'.repeat(40), digest: 'c'.repeat(64) };
  const envelope = runEnvelope.createRunEnvelope({ outputPath: path.join(dir, 'telemetry.json'), repoRoot: root, runId: `run-${Date.now()}-${Math.random().toString(16).slice(2)}`, lane: 'telemetry-matrix', provenance });
  const report = validReport(envelope.paths.aggregateResult);
  report.identity = { runId: envelope.runId, lane: envelope.lane, source: provenance.head, build: provenance.digest, reportPath: envelope.paths.aggregateResult };
  report.envelopeDigest = envelope.digest;
  report.provenance = provenance;
  const processIdentity = { pid: 100, ppid: 1, processGroup: 100, session: 100, startTicks: '1', executable: '/test/code' };
  for (const run of report.runs) {
    run.identity.runId = envelope.runId;
    run.identity.source = provenance.head;
    run.identity.build = provenance.digest;
    run.identity.reportPath = path.join(envelope.paths.childrenDir, `${run.identity.fixture}.json`);
    const child = { schemaVersion: 1, status: 'success', ok: true, classification: 'none', generatedAt: new Date().toISOString(), runId: envelope.runId, lane: run.identity.lane, envelopeDigest: envelope.digest, provenance, process: { root: processIdentity, listener: { ...processIdentity } }, telemetry: run };
    runEnvelope.publishJsonOnce(run.identity.reportPath, child, { runRoot: envelope.paths.runRoot });
  }
  return { envelope, report };
}

test('summaries retain cold samples and compute warm p50/p95', () => {
  const summary = telemetry.summarizeSamples([
    { kind: 'cold', value: 90 },
    { kind: 'warm', value: 10 },
    { kind: 'warm', value: 20 },
    { kind: 'warm', value: 30 },
    { kind: 'warm', value: 40 }
  ]);
  assert.deepStrictEqual(summary.cold, { samples: [90], p50: 90, p95: 90 });
  assert.deepStrictEqual(summary.warm, { samples: [10, 20, 30, 40], p50: 25, p95: 38.5 });
  assert.strictEqual(summary.all.p50, 30);
});

test('telemetry report validator requires exact unique canonical nine-fixture scope', () => {
  const report = validReport();
  assert.deepStrictEqual(telemetry.validateTelemetryReport(report), []);
  const mutations = [
    value => value.runs.pop(),
    value => value.runs[1] = structuredClone(value.runs[0]),
    value => value.runs.reverse(),
    value => value.runs.push(structuredClone(value.runs[0])),
    value => value.scope = 'partial'
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.notDeepStrictEqual(telemetry.validateTelemetryReport(changed), [], 'fixture mutation passed');
  }
});

test('selector grammar rejects empty, comma-only, malformed, unknown and duplicate selectors', () => {
  for (const selector of ['', ',', '320', '999x1', '320x1,320x1']) {
    assert.throws(() => telemetry.parseFixtureSelector(selector), Error, selector);
  }
  assert.strictEqual(telemetry.parseFixtureSelector('320x1').scope, 'partial');
  assert.strictEqual(telemetry.parseFixtureSelector(undefined).scope, 'full');
});

test('checker rejects one-at-a-time identity, path and freshness mutations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-telemetry-test-'));
  const file = path.join(dir, 'report.json');
  const base = validReport(file);
  const cases = [
    ['runId', report => report.identity.runId = 'foreign-run'],
    ['lane', report => report.identity.lane = 'foreign-lane'],
    ['source', report => report.identity.source = 'foreign-source'],
    ['build', report => report.identity.build = 'foreign-build'],
    ['fixture', report => report.runs[0].identity.fixture = 'foreign-fixture'],
    ['path', report => report.identity.reportPath = path.join(dir, 'foreign.json')],
    ['freshness', report => report.generatedAt = new Date(Date.now() - 3600000).toISOString()]
  ];
  for (const [name, mutate] of cases) {
    const report = structuredClone(base);
    mutate(report);
    fs.writeFileSync(file, JSON.stringify(report));
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-dogfood-telemetry.js'), file], {
      encoding: 'utf8',
      env: { ...process.env, LGVS_TELEMETRY_RUN_ID: 'run-1', LGVS_TELEMETRY_LANE: 'telemetry-matrix', LGVS_TELEMETRY_SOURCE: 'source-1', LGVS_TELEMETRY_BUILD: 'build-1' }
    });
    assert.notStrictEqual(result.status, 0, `${name} mutation passed:\n${result.stdout}\n${result.stderr}`);
  }
});

test('checker rejects a missing current report instead of consuming retained evidence', () => {
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-telemetry-missing-')), 'current.json');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-dogfood-telemetry.js'), missing], { encoding: 'utf8' });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /could not be read/);
});

test('exact-nine aggregate rejects envelope, provenance and child-path mutations', () => {
  const { envelope, report } = validEnvelopeReport();
  const validate = value => telemetry.validateTelemetryReport(value, { envelope, reportPath: envelope.paths.aggregateResult });
  assert.deepStrictEqual(validate(report), []);
  const mutations = [
    value => value.envelopeDigest = '0'.repeat(64),
    value => value.provenance.head = 'foreign',
    value => value.runs[1].identity.reportPath = value.runs[0].identity.reportPath,
    value => value.runs[0].identity.reportPath = path.join(envelope.paths.runRoot, '..', 'foreign.json'),
    value => value.runs[0].identity.reportPath = path.join(envelope.paths.childrenDir, 'retained.json')
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.notDeepStrictEqual(validate(changed), [], 'envelope mutation passed');
  }
});

test('failure classification distinguishes infrastructure from product failures', () => {
  assert.strictEqual(telemetry.classifyFailure(new Error('ECONNREFUSED 127.0.0.1 CDP targets')), 'infrastructure');
  assert.strictEqual(telemetry.classifyFailure(new Error('Dogfood check failed: input p95 budget')), 'product');
});

test('contract exposes exact matrix and run-scoped report identity wiring', () => {
  assert.deepStrictEqual(telemetry.requiredFixtures().map(telemetry.fixtureKey), [
    '320x1', '320x4', '320x16', '2000x1', '2000x4', '2000x16', '10000x1', '10000x4', '10000x16'
  ]);
  const runner = fs.readFileSync(path.join(root, 'scripts', 'run-dogfood-telemetry.js'), 'utf8');
  const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');
  assert.match(runner, /LGVS_DOGFOOD_REPORT_PATH/);
  assert.match(runner, /validateEnvelopeBinding/);
  assert.match(dogfood, /LGVS_TELEMETRY_ENVELOPE_DIGEST/);
});

function runInjectedCoordinator(injection, message) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-coordinator-terminal-'));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-dogfood-telemetry.js')], {
    encoding: 'utf8',
    env: { ...process.env, LGVS_TELEMETRY_OUTPUT: path.join(dir, 'telemetry.json'), LGVS_TELEMETRY_FIXTURES: '320x1', LGVS_TELEMETRY_TEST_INJECTION: injection, ...(message ? { LGVS_TELEMETRY_TEST_MESSAGE: message } : {}) }
  });
  const runIds = fs.readdirSync(path.join(dir, 'runs'));
  assert.strictEqual(runIds.length, 1, `${injection}: expected one envelope`);
  const runRoot = path.join(dir, 'runs', runIds[0]);
  const reportPath = path.join(runRoot, 'result.json');
  assert.notStrictEqual(result.status, 0, `${injection}: unexpectedly succeeded`);
  return { report: JSON.parse(fs.readFileSync(reportPath, 'utf8')), reportPath, runRoot };
}

test('post-envelope exception publishes one immutable aggregate and refuses duplicates', () => {
  const { report, reportPath, runRoot } = runInjectedCoordinator('post-envelope-exception');
  assert.deepStrictEqual([report.outcome, report.phase, report.code], ['failure', 'coordinator', 'COORDINATOR_EXCEPTION']);
  assert.strictEqual(report.identity.reportPath, reportPath);
  assert.throws(() => runEnvelope.publishJsonOnce(reportPath, { replacement: true }, { runRoot }));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), report);
});

test('launch failure and zero-exit without a child result fail closed', () => {
  const launched = runInjectedCoordinator('launch-failure').report;
  const empty = runInjectedCoordinator('zero-result').report;
  assert.deepStrictEqual([launched.outcome, launched.phase, launched.code], ['failure', 'coordinator', 'CHILD_LAUNCH_FAILED']);
  assert.deepStrictEqual([empty.outcome, empty.phase, empty.code], ['failure', 'coordinator', 'CHILD_RESULT_MISSING_OR_INVALID']);
});

test('coordinator classification does not depend on human wording', () => {
  const first = runInjectedCoordinator('post-envelope-exception', 'download ECONNREFUSED').report;
  const second = runInjectedCoordinator('post-envelope-exception', 'the product is broken').report;
  assert.deepStrictEqual([first.outcome, first.phase, first.code, first.classification], [second.outcome, second.phase, second.code, second.classification]);
  assert.notStrictEqual(first.message, second.message);
});
