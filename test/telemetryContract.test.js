const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const telemetry = require(path.join(root, 'scripts', 'dogfood', 'telemetry'));

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
  assert.match(runner, /childIdentityMatches/);
  assert.match(dogfood, /LGVS_TELEMETRY_RUN_ID/);
});
