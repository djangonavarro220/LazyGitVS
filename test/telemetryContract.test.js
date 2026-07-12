const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const telemetry = require(path.join(root, 'scripts', 'dogfood', 'telemetry'));
const runEnvelope = require(path.join(root, 'scripts', 'dogfood', 'run-envelope'));

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function validProvenance() {
  const executable = { realpath: process.execPath, sha256: 'd'.repeat(64), stat: { dev: '1', ino: '2', size: 3, mode: 0o100755, mtimeNs: '5' } };
  const body = { schemaVersion: 1, head: 'a'.repeat(40), tree: 'b'.repeat(40), extensionVersion: '1.2.3', platform: process.platform, arch: process.arch, node: executable, vscode: { ...executable, sha256: 'e'.repeat(64) } };
  return { ...body, digest: crypto.createHash('sha256').update(stableJson(body)).digest('hex') };
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
  return value;
}

function test(name, fn) {
  Promise.resolve().then(fn).then(() => {
    console.log(`ok - ${name}`);
  }, error => {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  });
}

function validReport(file = path.join(os.tmpdir(), 'lgvs-valid-telemetry.json')) {
  const identity = { runId: 'run-1', lane: 'telemetry-matrix', source: 'source-1', build: 'build-1', reportPath: file };
  const runs = telemetry.requiredFixtures().map(fixture => telemetry.makeFixtureResult({
    fixture: { ...fixture, actualRepoCount: fixture.repoCount, manifest: { ...telemetry.expectedFixtureManifest(fixture), digest: require(path.join(root, 'scripts', 'dogfood', 'fixtures')).fixtureManifestDigest(telemetry.expectedFixtureManifest(fixture)) } },
    phases: {
      sidebarReadyMs: [{ kind: 'cold', value: 100 }, { kind: 'warm', value: 80 }, { kind: 'warm', value: 90 }],
      panelReadyMs: [{ kind: 'cold', value: 30 }, { kind: 'warm', value: 20 }, { kind: 'warm', value: 25 }]
    },
    input: { panelSwitchMs: [{ kind: 'cold', value: 8 }, { kind: 'warm', value: 4 }, { kind: 'warm', value: 6 }] },
    memory: { rssBytes: [{ kind: 'cold', value: 1025 }, { kind: 'warm', value: 1024 }, { kind: 'warm', value: 1026 }] },
    dom: { nodeCount: [{ kind: 'cold', value: 101 }, { kind: 'warm', value: 100 }, { kind: 'warm', value: 102 }] },
    subprocess: { childCount: [{ kind: 'cold', value: 4 }, { kind: 'warm', value: 3 }, { kind: 'warm', value: 3 }] },
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
    samples: { cold: 1, warm: 2 },
    failures: [],
    identity
  });
}

function validEnvelopeReport() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-envelope-contract-'));
  const provenance = validProvenance();
  const envelope = runEnvelope.createRunEnvelope({ outputPath: path.join(dir, 'telemetry.json'), repoRoot: root, runId: `run-${Date.now()}-${Math.random().toString(16).slice(2)}`, lane: 'telemetry-matrix', provenance });
  const report = validReport(envelope.paths.aggregateResult);
  report.identity = { runId: envelope.runId, lane: envelope.lane, source: provenance.head, build: provenance.digest, reportPath: envelope.paths.aggregateResult, executables: { node: provenance.node, vscode: provenance.vscode } };
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
  assert.deepStrictEqual(summary.cold, { samples: [{ kind: 'cold', value: 90 }], p50: 90, p95: 90 });
  assert.deepStrictEqual(summary.warm, { samples: [{ kind: 'warm', value: 10 }, { kind: 'warm', value: 20 }, { kind: 'warm', value: 30 }, { kind: 'warm', value: 40 }], p50: 25, p95: 38.5 });
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

test('selector accepts only omission or the exact canonical nine spelling', () => {
  for (const selector of ['', ',', '320x1', `${telemetry.EXACT_FIXTURE_SELECTOR} `, telemetry.EXACT_FIXTURE_SELECTOR.replace('320x1,320x4', '320x4,320x1')]) {
    assert.throws(() => telemetry.parseFixtureSelector(selector), Error, selector);
  }
  assert.strictEqual(telemetry.parseFixtureSelector(telemetry.EXACT_FIXTURE_SELECTOR).scope, 'full');
  assert.strictEqual(telemetry.parseFixtureSelector(undefined).scope, 'full');
});

test('checker rejects one-invariant mutations of valid exact-nine envelope evidence', () => {
  const executableMutations = ['node', 'vscode'].flatMap(executable => [
    ['realpath', '/foreign/code'],
    ['sha256', '0'.repeat(64)],
    ['stat.dev', '10'],
    ['stat.ino', '20'],
    ['stat.size', 30],
    ['stat.mode', 0o100644],
    ['stat.mtimeNs', '50']
  ].map(([fieldPath, value]) => [
    `${executable}.${fieldPath}`,
    report => {
      const fields = fieldPath.split('.');
      const target = fields.length === 1 ? report.identity.executables[executable] : report.identity.executables[executable][fields[0]];
      target[fields.at(-1)] = value;
    }
  ]));
  const cases = [
    ['runId', report => report.identity.runId = 'foreign-run'],
    ['lane', report => report.identity.lane = 'foreign-lane'],
    ['source', report => report.identity.source = 'foreign-source'],
    ['build', report => report.identity.build = 'foreign-build'],
    ...executableMutations,
    ['fixture', report => report.runs[0].identity.fixture = 'foreign-fixture'],
    ['aggregate path', report => report.identity.reportPath = path.join(path.dirname(report.identity.reportPath), 'foreign.json')],
    ['child path', report => report.runs[0].identity.reportPath = path.join(path.dirname(report.runs[0].identity.reportPath), 'retained.json')],
    ['freshness', report => report.generatedAt = new Date(Date.now() - 3600000).toISOString()]
  ];
  for (const [name, mutate] of cases) {
    const { envelope, report: base } = validEnvelopeReport();
    const report = structuredClone(base);
    mutate(report);
    runEnvelope.publishJsonOnce(envelope.paths.aggregateResult, report, { runRoot: envelope.paths.runRoot });
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-dogfood-telemetry.js'), envelope.paths.aggregateResult], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0, `${name} mutation passed:\n${result.stdout}\n${result.stderr}`);
  }
});

test('checker rejects a missing current report instead of consuming retained evidence', () => {
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-telemetry-missing-')), 'current.json');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-dogfood-telemetry.js'), missing], { encoding: 'utf8' });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /could not be read/);
});

test('checker accepts a valid immutable exact-nine envelope-backed aggregate', () => {
  const { envelope, report } = validEnvelopeReport();
  runEnvelope.publishJsonOnce(envelope.paths.aggregateResult, report, { runRoot: envelope.paths.runRoot });
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-dogfood-telemetry.js'), envelope.paths.aggregateResult], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('aggregate validation keeps immutable early child evidence valid after a long matrix', () => {
  const { envelope, report } = validEnvelopeReport();
  assert.deepStrictEqual(telemetry.validateTelemetryReport(report, {
    envelope,
    reportPath: envelope.paths.aggregateResult,
    now: Date.now() + 6 * 60 * 1000,
    maxAgeMs: Infinity
  }), []);
});

test('checker rejects a mutated child copy and child freshness independently', () => {
  for (const mutation of ['copy', 'freshness']) {
    const { envelope, report } = validEnvelopeReport();
    const childPath = report.runs[0].identity.reportPath;
    const child = JSON.parse(fs.readFileSync(childPath, 'utf8'));
    if (mutation === 'copy') child.telemetry.input.panelSwitchMs.warm.samples[0] += 1;
    else child.generatedAt = new Date(Date.now() - 3600000).toISOString();
    fs.chmodSync(childPath, 0o600);
    fs.unlinkSync(childPath);
    runEnvelope.publishJsonOnce(childPath, child, { runRoot: envelope.paths.runRoot });
    runEnvelope.publishJsonOnce(envelope.paths.aggregateResult, report, { runRoot: envelope.paths.runRoot });
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-dogfood-telemetry.js'), envelope.paths.aggregateResult], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0, `${mutation} mutation passed`);
  }
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

test('structured evidence comparisons ignore object key insertion order', () => {
  const { envelope, report } = validEnvelopeReport();
  const reordered = structuredClone(report);
  reordered.provenance = reverseKeys(reordered.provenance);
  reordered.identity.executables = reverseKeys(reordered.identity.executables);
  assert.deepStrictEqual(telemetry.validateTelemetryReport(reordered, { envelope, reportPath: envelope.paths.aggregateResult }), []);
});

test('checker rejects stale, future, writable, symlink and hard-linked child evidence', () => {
  for (const mutation of ['stale', 'future', 'future-mtime', 'writable', 'symlink', 'hardlink']) {
    const { envelope, report } = validEnvelopeReport();
    const childPath = report.runs[0].identity.reportPath;
    const child = JSON.parse(fs.readFileSync(childPath, 'utf8'));
    fs.chmodSync(childPath, 0o600);
    fs.unlinkSync(childPath);
    if (mutation === 'stale') child.generatedAt = new Date(Date.now() - 3600000).toISOString();
    if (mutation === 'future') child.generatedAt = new Date(Date.now() + 3600000).toISOString();
    if (mutation === 'symlink') {
      const target = path.join(envelope.paths.tempDir, 'child.json');
      fs.writeFileSync(target, JSON.stringify(child), { mode: 0o400 });
      fs.symlinkSync(target, childPath);
    } else {
      runEnvelope.publishJsonOnce(childPath, child, { runRoot: envelope.paths.runRoot });
      if (mutation === 'writable') fs.chmodSync(childPath, 0o600);
      if (mutation === 'hardlink') fs.linkSync(childPath, path.join(envelope.paths.tempDir, 'linked.json'));
      if (mutation === 'future-mtime') fs.utimesSync(childPath, new Date(Date.now() + 3600000), new Date(Date.now() + 3600000));
    }
    runEnvelope.publishJsonOnce(envelope.paths.aggregateResult, report, { runRoot: envelope.paths.runRoot });
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-dogfood-telemetry.js'), envelope.paths.aggregateResult], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0, `${mutation} child evidence passed`);
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
  assert.match(dogfood, /if \(client && !TELEMETRY\) \{ try \{ await client\.close\(\); \} catch \{\} \}/, 'telemetry must not wait for CDP close after terminating its owned VS Code process');
});

function runInjectedCoordinator(injection, message) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-coordinator-terminal-'));
  const runner = path.join(root, 'scripts', 'run-dogfood-telemetry.js');
  const script = `
    const { runTelemetryCoordinator } = require(${JSON.stringify(runner)});
    runTelemetryCoordinator({
      injection: ${JSON.stringify(injection)},
      codePath: process.execPath,
      captureProvenance: () => (${JSON.stringify(validProvenance())})
    }).catch(error => { console.error(error); process.exit(1); });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, LGVS_TELEMETRY_OUTPUT: path.join(dir, 'telemetry.json'), LGVS_TELEMETRY_FIXTURES: telemetry.EXACT_FIXTURE_SELECTOR, ...(message ? { LGVS_TELEMETRY_TEST_MESSAGE: message } : {}) }
  });
  const runIds = fs.readdirSync(path.join(dir, 'runs'));
  assert.strictEqual(runIds.length, 1, `${injection}: expected one envelope`);
  const runRoot = path.join(dir, 'runs', runIds[0]);
  const reportPath = path.join(runRoot, 'result.json');
  assert.notStrictEqual(result.status, 0, `${injection}: unexpectedly succeeded`);
  return { report: JSON.parse(fs.readFileSync(reportPath, 'utf8')), reportPath, runRoot };
}

test('production entry point rejects arbitrary injection env values before provenance exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-coordinator-untrusted-injection-'));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-dogfood-telemetry.js')], {
    encoding: 'utf8',
    env: { ...process.env, LGVS_TELEMETRY_OUTPUT: path.join(dir, 'telemetry.json'), LGVS_TELEMETRY_TEST_INJECTION: 'fabricate-anything' }
  });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /not accepted by the production entry point/);
  assert.strictEqual(fs.existsSync(path.join(dir, 'runs')), false);
});

test('production entry point rejects non-exact selector before acquisition or envelope creation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-selector-preflight-'));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-dogfood-telemetry.js')], {
    encoding: 'utf8',
    env: { ...process.env, LGVS_TELEMETRY_OUTPUT: path.join(dir, 'telemetry.json'), LGVS_TELEMETRY_FIXTURES: '320x1' }
  });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /must equal exactly/);
  assert.strictEqual(fs.existsSync(path.join(dir, 'runs')), false);
});

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

function runForcedChildLifecycle({ envelope, reportPath, failPhase, rootProcessIdentity }) {
  let phase = 'setup';
  try {
    if (failPhase === phase) throw new Error(`${phase} diagnostic`);
    phase = 'spawn';
    if (failPhase === phase) throw new Error(`${phase} diagnostic`);
    phase = 'process-identity';
    if (failPhase === phase) throw new Error(`${phase} diagnostic`);
    throw new Error('fixture must fail before runtime');
  } catch (error) {
    const report = runEnvelope.makeChildTerminalFailure({ envelope, lane: 'telemetry-child', phase, error, rootProcessIdentity });
    runEnvelope.publishJsonOnce(reportPath, report, { runRoot: envelope.paths.runRoot });
    return { exitCode: 1, report, cleanupCalls: rootProcessIdentity ? 1 : 0 };
  }
}

test('child setup, spawn and process-identity failures publish once with conditional cleanup', () => {
  const phases = [
    ['setup', 'LGVS_TELEMETRY_CHILD_SETUP_FAILED', undefined],
    ['spawn', 'LGVS_TELEMETRY_CHILD_SPAWN_FAILED', undefined],
    ['process-identity', 'LGVS_TELEMETRY_CHILD_PROCESS_IDENTITY_FAILED', { pid: 100, ppid: 1, processGroup: 100, session: 100, startTicks: '1', executable: '/test/code' }]
  ];
  for (const [phase, code, identity] of phases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-child-terminal-'));
    const provenance = validProvenance();
    const envelope = runEnvelope.createRunEnvelope({ outputPath: path.join(dir, 'telemetry.json'), repoRoot: root, runId: `child-${phase}`, lane: 'telemetry-matrix', provenance });
    const reportPath = path.join(envelope.paths.childrenDir, `${phase}.json`);
    const result = runForcedChildLifecycle({ envelope, reportPath, failPhase: phase, rootProcessIdentity: identity });
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(result.report.failure.phase, phase);
    assert.strictEqual(result.report.failure.code, code);
    assert.strictEqual(result.report.status, 'failure');
    assert.strictEqual(result.report.ok, false);
    assert.strictEqual(result.report.classification, 'infrastructure');
    assert.strictEqual(result.cleanupCalls, identity ? 1 : 0);
    assert.strictEqual(result.report.process?.root, identity);
    const original = fs.readFileSync(reportPath, 'utf8');
    assert.throws(() => runEnvelope.publishJsonOnce(reportPath, { overwritten: true }, { runRoot: envelope.paths.runRoot }), Error);
    assert.strictEqual(fs.readFileSync(reportPath, 'utf8'), original);
  }
});

test('structured child failure binding rejects authority mutations but ignores wording', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-child-binding-'));
  const provenance = validProvenance();
  const envelope = runEnvelope.createRunEnvelope({ outputPath: path.join(dir, 'telemetry.json'), repoRoot: root, runId: 'child-binding', lane: 'telemetry-matrix', provenance });
  const reportPath = path.join(envelope.paths.childrenDir, 'child.json');
  const report = runEnvelope.makeChildTerminalFailure({ envelope, lane: 'telemetry-child', phase: 'setup', error: new Error('original wording') });
  runEnvelope.publishJsonOnce(reportPath, report, { runRoot: envelope.paths.runRoot });
  const stat = fs.statSync(reportPath);
  const validate = (value, candidatePath = reportPath) => runEnvelope.validateEnvelopeBinding({ envelope, report: value, reportPath: candidatePath, stat, expectedLane: 'telemetry-child' });
  assert.deepStrictEqual(validate(report), []);
  const mutations = [
    value => value.failure.phase = 'spawn',
    value => value.failure.code = 'LGVS_TELEMETRY_CHILD_SPAWN_FAILED',
    value => value.envelopeDigest = '0'.repeat(64),
    value => value.provenance.head = 'foreign'
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.notDeepStrictEqual(validate(changed), []);
  }
  assert.notDeepStrictEqual(validate(report, path.join(envelope.paths.runRoot, 'foreign.json')), []);
  const reworded = structuredClone(report);
  reworded.failure.message = 'completely different diagnostic wording';
  assert.deepStrictEqual(validate(reworded), []);
  assert.strictEqual(reworded.classification, 'infrastructure');
});

test('production pre-runtime path handles async ENOENT before identity', async () => {
  const proc = new EventEmitter();
  process.nextTick(() => proc.emit('error', Object.assign(new Error('missing command'), { code: 'ENOENT' })));
  let failure;
  let identityCalls = 0;
  await assert.rejects(runEnvelope.runChildPreRuntimeLifecycle({
    setup: () => undefined,
    spawnChild: () => proc,
    readIdentity: () => { identityCalls += 1; },
    publishFailure: value => { failure = value; },
    cleanup: () => assert.fail('cleanup without identity')
  }));
  assert.strictEqual(failure.phase, 'spawn');
  assert.strictEqual(failure.error.code, 'ENOENT');
  assert.strictEqual(identityCalls, 0);
});

test('production pre-runtime path deterministically covers setup, sync spawn, identity and success', async () => {
  const failedPhases = [];
  const run = options => runEnvelope.runChildPreRuntimeLifecycle({
    setup: () => undefined,
    spawnChild: () => { const proc = new EventEmitter(); proc.pid = 100; process.nextTick(() => proc.emit('spawn')); return proc; },
    readIdentity: () => ({ pid: 100 }),
    publishFailure: value => { failedPhases.push(value.phase); },
    cleanup: () => assert.fail('cleanup before runtime'),
    ...options
  });
  await assert.rejects(run({ setup: () => { throw new Error('setup'); } }));
  await assert.rejects(run({ spawnChild: () => { throw new Error('spawn'); } }));
  await assert.rejects(run({ readIdentity: () => { throw new Error('identity'); } }));
  assert.deepStrictEqual(failedPhases, ['setup', 'spawn', 'process-identity']);
  const success = await run({});
  assert.strictEqual(success.rootProcessIdentity.pid, 100);
});
