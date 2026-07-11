const fs = require('fs');
const path = require('path');

const SIGNALS = {
  phases: ['sidebarReadyMs', 'panelReadyMs'],
  input: ['panelSwitchMs'],
  memory: ['rssBytes'],
  dom: ['nodeCount'],
  subprocess: ['childCount']
};

function requiredFixtures() {
  return [320, 2000, 10000].flatMap(fileCount => [1, 4, 16].map(repoCount => ({ fileCount, repoCount })));
}

function fixtureKey(fixture) {
  return `${fixture.fileCount}x${fixture.repoCount}`;
}

function parseFixtureSelector(selector) {
  if (selector === undefined) return { scope: 'full', fixtures: requiredFixtures() };
  if (typeof selector !== 'string' || !selector.trim()) throw new Error('Telemetry fixture selector must not be empty');
  const tokens = selector.split(',').map(value => value.trim());
  if (tokens.some(token => !token)) throw new Error('Telemetry fixture selector contains an empty item');
  const allowed = new Map(requiredFixtures().map(fixture => [fixtureKey(fixture), fixture]));
  const seen = new Set();
  const fixtures = tokens.map(token => {
    if (!/^\d+x\d+$/.test(token) || !allowed.has(token)) throw new Error(`Unknown telemetry fixture selector: ${token}`);
    if (seen.has(token)) throw new Error(`Duplicate telemetry fixture selector: ${token}`);
    seen.add(token);
    return allowed.get(token);
  });
  return { scope: fixtures.length === allowed.size ? 'full' : 'partial', fixtures };
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
  return { samples: values, p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
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

function validateTelemetryReport(report, options = {}) {
  const errors = [];
  const fixtures = requiredFixtures();
  if (report?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (report?.contract !== 'lgvs-telemetry') errors.push('contract must be lgvs-telemetry');
  if (report?.ok !== true) errors.push('report must have ok=true');
  if (report?.classification !== 'none') errors.push('successful report classification must be none');
  if (report?.scope !== 'full') errors.push('acceptance report scope must be full');
  if (Array.isArray(report?.failures) && report.failures.length) errors.push('successful report must not contain failures');
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
    for (const [group, signals] of Object.entries(SIGNALS)) {
      for (const signal of signals) {
        const metric = run[group]?.[signal];
        if (!metric) { errors.push(`${label} missing ${group}.${signal}`); continue; }
        if (!metric.cold?.samples?.length && group === 'phases') errors.push(`${label} ${group}.${signal} requires cold samples`);
        if (!metric.warm?.samples?.length) errors.push(`${label} ${group}.${signal} requires warm samples`);
        for (const kind of ['all', 'warm']) {
          if (!Number.isFinite(metric[kind]?.p50) || !Number.isFinite(metric[kind]?.p95)) errors.push(`${label} ${group}.${signal}.${kind} requires finite p50/p95`);
        }
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
  for (const [index, run] of report.runs.entries()) {
    const expectedFixture = expectedKeys[index];
    if (!expectedFixture) continue;
    for (const field of ['runId', 'source', 'build']) {
      if (run?.identity?.[field] !== report?.identity?.[field]) errors.push(`${expectedFixture} identity.${field} does not match aggregate`);
    }
    if (run?.identity?.lane !== `telemetry-${expectedFixture.replace('x', 'f-')}r`) errors.push(`${expectedFixture} identity.lane is invalid`);
    if (run?.identity?.fixture !== expectedFixture) errors.push(`${expectedFixture} identity.fixture is invalid`);
    if (typeof run?.identity?.reportPath !== 'string' || !run.identity.reportPath) errors.push(`${expectedFixture} identity.reportPath is required`);
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

module.exports = { requiredFixtures, fixtureKey, parseFixtureSelector, summarizeSamples, makeFixtureResult, makeTelemetryReport, validateTelemetryReport, classifyFailure, collectProcessTreeMetrics };
