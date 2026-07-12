const fs = require('fs');
const path = require('path');
const { assertImmutablePublishedFile, canonicalEqual, validateEnvelopeBinding } = require('./run-envelope');
const { fixtureManifestDigest } = require('./fixtures');

const SIGNALS = {
  phases: ['sidebarReadyMs', 'panelRenderedReadyMs'],
  input: ['dispatchAcknowledgedMs'],
  memory: ['rssBytes'],
  dom: ['nodeCount'],
  subprocess: ['childCount']
};

const EXACT_FIXTURE_SELECTOR = '320x1,320x4,320x16,2000x1,2000x4,2000x16,10000x1,10000x4,10000x16';
const INPUT_DISPATCH_ACK_WARM_P95_BUDGET_MS = 100;

function requiredFixtures() {
  return [320, 2000, 10000].flatMap(fileCount => [1, 4, 16].map(repoCount => ({ fileCount, repoCount })));
}

function fixtureKey(fixture) {
  return `${fixture.fileCount}x${fixture.repoCount}`;
}

function parseFixtureSelector(selector) {
  if (selector === undefined) return { scope: 'full', fixtures: requiredFixtures() };
  if (selector !== EXACT_FIXTURE_SELECTOR) throw new Error(`LGVS_TELEMETRY_FIXTURES must equal exactly ${EXACT_FIXTURE_SELECTOR}`);
  return { scope: 'full', fixtures: requiredFixtures() };
}

function percentile(values, percentileValue) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function stats(samples) {
  const values = samples.map(sample => sample.value);
  return { samples: samples.map(sample => ({ kind: sample.kind, value: sample.value })), p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

function summarizeSamples(samples) {
  return {
    cold: stats(samples.filter(sample => sample.kind === 'cold')),
    warm: stats(samples.filter(sample => sample.kind === 'warm')),
    all: stats(samples)
  };
}

function summarizeGroup(group) {
  return Object.fromEntries(Object.entries(group).map(([name, samples]) => [name, summarizeSamples(samples)]));
}

function makeFixtureResult({ fixture, phases, input, memory, dom, subprocess, ...extra }) {
  return {
    fixture,
    phases: summarizeGroup(phases),
    input: summarizeGroup(input),
    memory: summarizeGroup(memory),
    dom: summarizeGroup(dom),
    subprocess: summarizeGroup(subprocess),
    ...extra
  };
}

function makeTelemetryReport({ versions, runs, ...extra }) {
  return { schemaVersion: 1, contract: 'lgvs-telemetry', ok: true, classification: 'none', generatedAt: new Date().toISOString(), versions, runs, ...extra };
}

function expectedFixtureManifest(fixture) {
  let remaining = fixture.fileCount;
  return {
    repositories: Array.from({ length: fixture.repoCount }, (_, index) => {
      const trackedFileCount = Math.ceil(remaining / (fixture.repoCount - index));
      remaining -= trackedFileCount;
      return { path: `repo-${String(index + 1).padStart(2, '0')}`, trackedFileCount, changedFileCount: Math.min(trackedFileCount, 20) };
    })
  };
}

function validateMetric(metric, { label, group, signal, warmSamples }) {
  const errors = [];
  const metricLabel = `${label} ${group}.${signal}`;
  if (!metric || typeof metric !== 'object') return [`${metricLabel} is required`];
  const expectedKinds = { cold: 1, warm: warmSamples };
  for (const [kind, count] of Object.entries(expectedKinds)) {
    const samples = metric[kind]?.samples;
    if (!Array.isArray(samples) || samples.length !== count) {
      errors.push(`${metricLabel}.${kind}.samples must contain exactly ${count} samples`);
      continue;
    }
    for (const [index, sample] of samples.entries()) {
      if (!sample || sample.kind !== kind || !Number.isFinite(sample.value) || sample.value < 0) errors.push(`${metricLabel}.${kind}.samples[${index}] must be a finite non-negative ${kind} sample`);
    }
  }
  const cold = metric.cold?.samples;
  const warm = metric.warm?.samples;
  const all = metric.all?.samples;
  if (!Array.isArray(all) || !Array.isArray(cold) || !Array.isArray(warm) || JSON.stringify(all) !== JSON.stringify([...cold, ...warm])) errors.push(`${metricLabel}.all.samples must exactly equal cold followed by warm`);
  for (const kind of ['cold', 'warm', 'all']) {
    const samples = metric[kind]?.samples;
    const values = Array.isArray(samples) ? samples.map(sample => sample?.value) : [];
    for (const percentileName of ['p50', 'p95']) {
      const expected = percentile(values, percentileName === 'p50' ? 0.5 : 0.95);
      if (!Number.isFinite(metric[kind]?.[percentileName]) || metric[kind][percentileName] !== expected) errors.push(`${metricLabel}.${kind}.${percentileName} must equal the recomputed percentile`);
    }
  }
  return errors;
}

function validateFixture(fixture, label) {
  const errors = [];
  const expected = expectedFixtureManifest(fixture || {});
  if (!fixture || fixture.fileCount !== Number(label.split('/')[0]) || fixture.repoCount !== Number(label.split('/')[1])) return [`${label} fixture identity is invalid`];
  if (fixture.actualRepoCount !== fixture.repoCount) errors.push(`${label} fixture actualRepoCount must equal repoCount`);
  const manifest = fixture.manifest;
  if (!manifest || !Array.isArray(manifest.repositories)) return [...errors, `${label} fixture manifest is required`];
  if (manifest.repositories.length !== fixture.actualRepoCount) errors.push(`${label} fixture manifest repository count is invalid`);
  if (JSON.stringify(manifest.repositories) !== JSON.stringify(expected.repositories)) errors.push(`${label} fixture manifest does not match the canonical observed repository matrix`);
  if (manifest.repositories.reduce((total, repository) => total + repository.trackedFileCount, 0) !== fixture.fileCount) errors.push(`${label} fixture manifest tracked-file total is invalid`);
  if (manifest.digest !== fixtureManifestDigest(manifest)) errors.push(`${label} fixture manifest digest is invalid`);
  return errors;
}

function validateTelemetryReport(report, options = {}) {
  const errors = [];
  const fixtures = requiredFixtures();
  if (report?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (report?.contract !== 'lgvs-telemetry') errors.push('contract must be lgvs-telemetry');
  if (report?.ok !== true) errors.push('report must have ok=true');
  if (report?.classification !== 'none') errors.push('successful report classification must be none');
  if (report?.scope !== 'full') errors.push('acceptance report scope must be full');
  if (Array.isArray(report?.failures) && report.failures.length) errors.push('successful report must not contain failures');
  const warmSamples = report?.samples?.warm;
  if (!Number.isInteger(warmSamples) || warmSamples < 2 || warmSamples > 20 || report?.samples?.cold !== 1) errors.push('samples must declare exactly one cold and 2-20 warm samples');
  for (const field of ['node', 'vscode', 'extension', 'platform']) {
    if (!report?.versions?.[field]) errors.push(`versions.${field} is required`);
  }
  if (!Array.isArray(report?.runs)) return [...errors, 'runs must be an array'];
  const actualKeys = report.runs.map(run => fixtureKey(run.fixture || {}));
  const expectedKeys = fixtures.map(fixtureKey);
  if (report.runs.length !== fixtures.length) errors.push(`runs must contain exactly ${fixtures.length} fixtures`);
  if (new Set(actualKeys).size !== actualKeys.length) errors.push('runs must contain unique fixtures');
  if (actualKeys.join(',') !== expectedKeys.join(',')) errors.push(`fixtures must use canonical order: ${expectedKeys.join(',')}`);
  for (const [index, fixture] of fixtures.entries()) {
    const label = `${fixture.fileCount}/${fixture.repoCount}`;
    const run = report.runs[index];
    if (!run) { errors.push(`missing fixture ${label}`); continue; }
    errors.push(...validateFixture(run.fixture, label));
    for (const [group, signals] of Object.entries(SIGNALS)) {
      for (const signal of signals) {
        errors.push(...validateMetric(run[group]?.[signal], { label, group, signal, warmSamples }));
      }
    }
    const dispatch = run.input?.dispatchAcknowledgedMs;
    const rendered = run.phases?.panelRenderedReadyMs;
    if (Number.isFinite(dispatch?.warm?.p95) && dispatch.warm.p95 > INPUT_DISPATCH_ACK_WARM_P95_BUDGET_MS) errors.push(`${label} input.dispatchAcknowledgedMs.warm.p95 exceeds ${INPUT_DISPATCH_ACK_WARM_P95_BUDGET_MS}ms acceptance budget`);
    const dispatchAll = dispatch?.all?.samples;
    const renderedAll = rendered?.all?.samples;
    if (Array.isArray(dispatchAll) && Array.isArray(renderedAll)) {
      if (JSON.stringify(dispatchAll) === JSON.stringify(renderedAll)) errors.push(`${label} input dispatch acknowledgement must not duplicate rendered-ready samples`);
      for (let sampleIndex = 0; sampleIndex < Math.min(dispatchAll.length, renderedAll.length); sampleIndex++) {
        if (dispatchAll[sampleIndex]?.value > renderedAll[sampleIndex]?.value) errors.push(`${label} input dispatch acknowledgement must precede rendered-ready sample ${sampleIndex}`);
      }
    }
  }
  const identityFields = ['runId', 'lane', 'source', 'build', 'reportPath'];
  for (const field of identityFields) if (typeof report?.identity?.[field] !== 'string' || !report.identity[field]) errors.push(`identity.${field} is required`);
  const expected = options.expectedIdentity || {};
  for (const field of identityFields) {
    if (expected[field] !== undefined && report?.identity?.[field] !== expected[field]) errors.push(`identity.${field} does not match expected identity`);
  }
  const generatedAt = Date.parse(report?.generatedAt);
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
  if (!Number.isFinite(generatedAt)) errors.push('generatedAt must be a valid timestamp');
  else if (generatedAt > now + 1000 || now - generatedAt > maxAgeMs) errors.push('report is stale');
  if (options.reportPath && path.resolve(report?.identity?.reportPath || '') !== path.resolve(options.reportPath)) errors.push('identity.reportPath does not match checked path');
  const envelope = options.envelope;
  if (envelope) {
    if (report?.envelopeDigest !== envelope.digest) errors.push('aggregate envelope digest does not match');
    if (!canonicalEqual(report?.provenance, envelope.provenance)) errors.push('aggregate provenance does not match envelope');
    if (report?.identity?.runId !== envelope.runId || report?.identity?.lane !== envelope.lane) errors.push('aggregate envelope identity does not match');
    if (report?.identity?.source !== envelope.provenance?.head || report?.identity?.build !== envelope.provenance?.digest) errors.push('aggregate source/build does not match envelope');
    for (const executable of ['node', 'vscode']) {
      if (!canonicalEqual(report?.identity?.executables?.[executable], envelope.provenance?.[executable])) errors.push(`aggregate ${executable} executable identity does not match envelope`);
    }
    if (path.resolve(report?.identity?.reportPath || '') !== envelope.paths.aggregateResult) errors.push('aggregate report path does not match envelope');
  }
  const childPaths = new Set();
  for (const [index, run] of report.runs.entries()) {
    const expectedFixture = expectedKeys[index];
    if (!expectedFixture) continue;
    for (const field of ['runId', 'source', 'build']) {
      if (run?.identity?.[field] !== report?.identity?.[field]) errors.push(`${expectedFixture} identity.${field} does not match aggregate`);
    }
    if (run?.identity?.lane !== `telemetry-${expectedFixture.replace('x', 'f-')}r`) errors.push(`${expectedFixture} identity.lane is invalid`);
    if (run?.identity?.fixture !== expectedFixture) errors.push(`${expectedFixture} identity.fixture is invalid`);
    if (typeof run?.identity?.reportPath !== 'string' || !run.identity.reportPath) errors.push(`${expectedFixture} identity.reportPath is required`);
    if (envelope && typeof run?.identity?.reportPath === 'string') {
      const childPath = path.resolve(run.identity.reportPath);
      if (childPaths.has(childPath)) errors.push(`${expectedFixture} child report path is duplicated`);
      childPaths.add(childPath);
      if (childPath !== path.join(envelope.paths.childrenDir, `${expectedFixture}.json`)) errors.push(`${expectedFixture} child report path is not canonical`);
      try {
        const stat = assertImmutablePublishedFile(childPath);
        const child = JSON.parse(fs.readFileSync(childPath, 'utf8'));
        errors.push(...validateEnvelopeBinding({ envelope, report: child, reportPath: childPath, stat, expectedLane: run.identity.lane, now, maxAgeMs }).map(error => `${expectedFixture} ${error}`));
        if (!canonicalEqual(child.telemetry, run)) errors.push(`${expectedFixture} child telemetry does not match aggregate`);
      } catch (error) {
        errors.push(`${expectedFixture} child report is unavailable or invalid: ${error.message}`);
      }
    }
  }
  return errors;
}

function classifyFailure(error) {
  const text = String(error?.stack || error || '');
  return /ECONNREFUSED|CDP targets|download|xvfb|xdotool|EADDRINUSE|ENOENT|MODULE_NOT_FOUND|Cannot find module|contaminated by another dogfood|SIG(?:TERM|KILL)|timed out.*(?:launch|process)/i.test(text)
    ? 'infrastructure'
    : 'product';
}

function readProcessStat(pid) {
  const stat = fs.readFileSync(path.join('/proc', String(pid), 'stat'), 'utf8');
  const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return { ppid: Number(afterName[1]), rssPages: Number(afterName[21]) };
}

function collectProcessTreeMetrics(rootPid) {
  const processIds = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(Number);
  const entries = new Map();
  for (const pid of processIds) {
    try { entries.set(pid, readProcessStat(pid)); } catch { /* process exited */ }
  }
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, entry] of entries) {
      if (!descendants.has(pid) && descendants.has(entry.ppid)) { descendants.add(pid); changed = true; }
    }
  }
  const pageSize = 4096;
  const rssBytes = [...descendants].reduce((sum, pid) => sum + Math.max(0, entries.get(pid)?.rssPages || 0) * pageSize, 0);
  return { rssBytes, childCount: Math.max(0, descendants.size - 1), processCount: descendants.size };
}

module.exports = { EXACT_FIXTURE_SELECTOR, INPUT_DISPATCH_ACK_WARM_P95_BUDGET_MS, requiredFixtures, fixtureKey, parseFixtureSelector, summarizeSamples, makeFixtureResult, makeTelemetryReport, expectedFixtureManifest, validateTelemetryReport, classifyFailure, collectProcessTreeMetrics };
