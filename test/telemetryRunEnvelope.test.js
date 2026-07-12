const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const envelope = require('../scripts/dogfood/run-envelope');
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function temporaryDirectory(prefix = 'lgvs-envelope-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

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

function refreshProvenanceDigest(provenance) {
  const body = { ...provenance };
  delete body.digest;
  provenance.digest = crypto.createHash('sha256').update(stableJson(body)).digest('hex');
  return provenance;
}

function makeEnvelope() {
  const directory = temporaryDirectory();
  return envelope.createRunEnvelope({ outputPath: path.join(directory, 'telemetry.json'), repoRoot: process.cwd(), runId: `run-${Date.now()}-${Math.random().toString(16).slice(2)}`, lane: 'telemetry-matrix', provenance: validProvenance() });
}

test('createRunEnvelope creates confined canonical paths and rejects reuse, symlinks and escapes', () => {
  const directory = temporaryDirectory();
  const args = { outputPath: path.join(directory, 'telemetry.json'), repoRoot: process.cwd(), runId: 'fixed-run', lane: 'telemetry-matrix', provenance: validProvenance() };
  const created = envelope.createRunEnvelope(args);
  assert.strictEqual(fs.statSync(created.paths.runRoot).mode & 0o777, 0o700);
  assert.strictEqual(fs.statSync(created.envelopePath).mode & 0o777, 0o400);
  for (const candidate of Object.values(created.paths)) assert.strictEqual(path.relative(created.paths.runRoot, candidate).startsWith('..'), false);
  assert.throws(() => envelope.createRunEnvelope(args), /EEXIST/);
  assert.throws(() => envelope.assertOwnedPath(created.paths.runRoot, path.join(created.paths.runRoot, '..', 'foreign.json'), created.paths.childrenDir), /designated parent|escapes/);
  const link = path.join(created.paths.childrenDir, 'link.json');
  fs.symlinkSync('/tmp/foreign', link);
  assert.throws(() => envelope.assertOwnedPath(created.paths.runRoot, link, created.paths.childrenDir), /symlink/i);
  const linkedParent = path.join(directory, 'linked');
  fs.symlinkSync(directory, linkedParent);
  assert.throws(() => envelope.createRunEnvelope({ ...args, runId: 'other', outputPath: path.join(linkedParent, 'out.json') }), /Symlink/i);
});

test('publishJsonOnce publishes complete JSON and never replaces terminal evidence', () => {
  const created = makeEnvelope();
  const file = path.join(created.paths.childrenDir, 'result.json');
  envelope.publishJsonOnce(file, { status: 'success', value: 1 }, { runRoot: created.paths.runRoot });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { status: 'success', value: 1 });
  const stat = fs.lstatSync(file);
  assert.strictEqual(stat.isFile(), true);
  assert.strictEqual(stat.nlink, 1);
  assert.strictEqual(stat.mode & 0o222, 0);
  assert.throws(() => envelope.publishJsonOnce(file, { status: 'failure' }, { runRoot: created.paths.runRoot }), /EEXIST/);
  assert.deepStrictEqual(fs.readdirSync(created.paths.childrenDir), ['result.json']);
});

test('provenance schema requires every canonical node and vscode executable field', () => {
  const directory = temporaryDirectory();
  const create = provenance => envelope.createRunEnvelope({ outputPath: path.join(directory, 'telemetry.json'), repoRoot: process.cwd(), runId: `schema-${crypto.randomUUID()}`, lane: 'telemetry-matrix', provenance });
  assert.doesNotThrow(() => envelope.validateProvenance(validProvenance()));
  const reordered = Object.fromEntries(Object.entries(validProvenance()).reverse());
  assert.doesNotThrow(() => envelope.validateProvenance(reordered));
  for (const executableName of ['node', 'vscode']) {
    for (const field of ['realpath', 'sha256', 'stat']) {
      const provenance = structuredClone(validProvenance());
      delete provenance[executableName][field];
      assert.throws(() => create(refreshProvenanceDigest(provenance)), /provenance|identity|stat/);
    }
    for (const field of ['dev', 'ino', 'size', 'mode', 'mtimeNs']) {
      const provenance = structuredClone(validProvenance());
      delete provenance[executableName].stat[field];
      assert.throws(() => create(refreshProvenanceDigest(provenance)), /stat/);
    }
    for (const [field, malformed] of [['realpath', 'relative/code'], ['sha256', 'ABC'], ['stat', []]]) {
      const provenance = structuredClone(validProvenance());
      provenance[executableName][field] = malformed;
      assert.throws(() => create(refreshProvenanceDigest(provenance)), /provenance|identity|stat/, `${executableName}.${field}`);
    }
    const malformedStatCases = [
      ['dev.wrong-type', 'dev', 1],
      ['dev.invalid-value', 'dev', '-1'],
      ['ino.wrong-type', 'ino', 2],
      ['ino.invalid-value', 'ino', '1.5'],
      ['size.wrong-type', 'size', '3'],
      ['size.invalid-value', 'size', -1],
      ['mode.wrong-type', 'mode', '33261'],
      ['mode.invalid-value', 'mode', 1.5],
      ['mtimeNs.wrong-type', 'mtimeNs', 5],
      ['mtimeNs.invalid-value', 'mtimeNs', '-1']
    ];
    for (const [label, field, malformed] of malformedStatCases) {
      const provenance = structuredClone(validProvenance());
      provenance[executableName].stat[field] = malformed;
      refreshProvenanceDigest(provenance);
      assert.throws(() => create(provenance), /stat fields/, `${executableName}.stat.${label}`);
    }
  }
});

test('publishJsonOnce leaves no evidence when publication is interrupted', () => {
  const created = makeEnvelope();
  const file = path.join(created.paths.childrenDir, 'interrupted.json');
  const originalLink = fs.linkSync;
  fs.linkSync = () => { throw new Error('injected publication interruption'); };
  try {
    assert.throws(() => envelope.publishJsonOnce(file, { status: 'success' }, { runRoot: created.paths.runRoot }), /injected/);
  } finally { fs.linkSync = originalLink; }
  assert.strictEqual(fs.existsSync(file), false);
  assert.deepStrictEqual(fs.readdirSync(created.paths.childrenDir), []);
});

test('captureProvenance binds clean Git state, tree, version and executable content', () => {
  const repo = temporaryDirectory('lgvs-provenance-');
  git(repo, 'init');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'tracked'), 'one\n');
  git(repo, 'add', 'tracked');
  git(repo, 'commit', '-m', 'initial');
  const executable = path.join(repo, 'fake-code');
  fs.copyFileSync(process.execPath, executable);
  git(repo, 'add', 'fake-code');
  git(repo, 'commit', '-m', 'executable');
  const captured = envelope.captureProvenance({ repoRoot: repo, extensionVersion: '1.2.3', nodeExecutable: process.execPath, vscodeExecutable: executable });
  assert.match(captured.head, /^[0-9a-f]{40}$/);
  assert.match(captured.tree, /^[0-9a-f]{40}$/);
  assert.match(captured.digest, /^[0-9a-f]{64}$/);
  fs.writeFileSync(path.join(repo, 'tracked'), 'dirty\n');
  assert.throws(() => envelope.captureProvenance({ repoRoot: repo, extensionVersion: '1.2.3', nodeExecutable: process.execPath, vscodeExecutable: executable }), /clean worktree/);
});

test('process identity accepts a live descendant and rejects unrelated or mutated identities', () => {
  const root = envelope.readProcessIdentity(process.pid);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  try {
    const identity = envelope.readProcessIdentity(child.pid);
    assert.strictEqual(envelope.assertOwnedDescendant(root, identity), true);
    assert.throws(() => envelope.assertOwnedDescendant(root, { ...identity, startTicks: `${identity.startTicks}0` }), /changed/);
    assert.throws(() => envelope.assertOwnedDescendant(root, { ...identity, executable: '/foreign' }), /changed/);
    assert.throws(() => envelope.assertOwnedDescendant(root, envelope.readProcessIdentity(1)));
  } finally { child.kill(); }
});

test('discoverOwnedCdp reads the run-owned active port and proves listener ancestry', async () => {
  const userData = temporaryDirectory('lgvs-cdp-');
  assert.throws(() => envelope.discoverOwnedCdp({ userDataDir: userData, rootProcessIdentity: envelope.readProcessIdentity(process.pid) }), /DevToolsActivePort/);
  fs.writeFileSync(path.join(userData, 'DevToolsActivePort'), 'bad\n');
  assert.throws(() => envelope.discoverOwnedCdp({ userDataDir: userData, rootProcessIdentity: envelope.readProcessIdentity(process.pid) }), /Malformed/);
  const child = spawn(process.execPath, ['-e', "const fs=require('fs'),net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[1],String(s.address().port)+'\\n/devtools/browser/test\\n'));setTimeout(()=>{},30000)", path.join(userData, 'DevToolsActivePort')], { stdio: 'ignore' });
  try {
    for (let index = 0; index < 100 && !/^\d+/.test(fs.readFileSync(path.join(userData, 'DevToolsActivePort'), 'utf8')); index++) await new Promise(resolve => setTimeout(resolve, 20));
    const discovered = envelope.discoverOwnedCdp({ userDataDir: userData, rootProcessIdentity: envelope.readProcessIdentity(process.pid) });
    assert.strictEqual(discovered.listenerIdentity.pid, child.pid);
    assert.match(discovered.browserPath, /^\/devtools\/browser/);
  } finally { child.kill(); }
});

test('cleanup refuses mutated and foreign process groups without sending a signal', () => {
  const identity = envelope.readProcessIdentity(process.pid);
  let called = false;
  assert.throws(() => envelope.terminateOwnedProcessGroup({ ...identity, startTicks: '0' }, 'SIGTERM', () => { called = true; }), /identity changed/);
  assert.strictEqual(called, false);
  if (identity.processGroup !== identity.pid) assert.throws(() => envelope.terminateOwnedProcessGroup(identity, 'SIGTERM', () => { called = true; }), /foreign process group/);
  assert.strictEqual(called, false);
});

test('terminal reports bind envelope, publication time, provenance, lane and ownership', () => {
  const created = makeEnvelope();
  const reportPath = path.join(created.paths.childrenDir, 'bound.json');
  const identity = envelope.readProcessIdentity(process.pid);
  const report = {
    schemaVersion: 1,
    status: 'success',
    ok: true,
    classification: 'none',
    generatedAt: new Date().toISOString(),
    runId: created.runId,
    lane: 'telemetry-320f-1r',
    envelopeDigest: created.digest,
    provenance: created.provenance,
    process: { root: { ...identity }, listener: { ...identity } }
  };
  envelope.publishJsonOnce(reportPath, report, { runRoot: created.paths.runRoot });
  const options = { envelope: created, reportPath, stat: fs.statSync(reportPath), expectedLane: report.lane };
  assert.deepStrictEqual(envelope.validateEnvelopeBinding({ ...options, report }), []);
  for (const mutate of [
    value => value.status = 'pending',
    value => value.runId = 'stale',
    value => value.lane = 'foreign',
    value => value.envelopeDigest = '0'.repeat(64),
    value => value.provenance = { foreign: true },
    value => value.generatedAt = new Date(0).toISOString(),
    value => value.process.listener.processGroup += 1
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.notDeepStrictEqual(envelope.validateEnvelopeBinding({ ...options, report: changed }), []);
  }
});

test('readEnvelopeForAggregate binds the canonical aggregate and envelope digest', () => {
  const created = makeEnvelope();
  assert.strictEqual(envelope.readEnvelopeForAggregate(created.paths.aggregateResult, created.digest).digest, created.digest);
  assert.throws(() => envelope.readEnvelopeForAggregate(path.join(created.paths.runRoot, 'foreign.json'), created.digest), /aggregate path/);
  assert.throws(() => envelope.readEnvelopeForAggregate(created.paths.aggregateResult, '0'.repeat(64)), /digest does not match/);
  fs.chmodSync(created.envelopePath, 0o600);
  assert.throws(() => envelope.readEnvelopeForAggregate(created.paths.aggregateResult, created.digest), /not an immutable/);
});

test('readRunEnvelope rejects deleted executable provenance fields', () => {
  const created = makeEnvelope();
  const stored = JSON.parse(fs.readFileSync(created.envelopePath, 'utf8'));
  delete stored.provenance.node.stat.dev;
  refreshProvenanceDigest(stored.provenance);
  const body = { ...stored };
  delete body.digest;
  stored.digest = crypto.createHash('sha256').update(stableJson(body)).digest('hex');
  fs.chmodSync(created.envelopePath, 0o600);
  fs.writeFileSync(created.envelopePath, `${JSON.stringify(stored)}\n`);
  fs.chmodSync(created.envelopePath, 0o400);
  assert.throws(() => envelope.readRunEnvelope(created.envelopePath), /stat/);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok - ${name}`); }
    catch (error) { console.error(`not ok - ${name}`); console.error(error); process.exitCode = 1; }
  }
})();
