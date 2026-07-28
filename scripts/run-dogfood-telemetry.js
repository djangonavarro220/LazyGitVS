#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { fixtureKey, parseFixtureSelector, makeTelemetryReport, validateTelemetryReport } = require('./dogfood/telemetry');
const { captureProvenance, createRunEnvelope, publishJsonOnce, validateEnvelopeBinding } = require('./dogfood/run-envelope');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.LGVS_TELEMETRY_OUTPUT || path.join(root, 'dogfood-output', 'telemetry.json'));
const warmSamples = String(Math.max(2, Math.min(20, Number(process.env.LGVS_TELEMETRY_WARM_SAMPLES || 5))));

function runChild(command, args, options, spawnChild = spawn) {
  return new Promise(resolve => {
    const child = spawnChild(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutSignal;
    let settled = false;
    let graceTimer;
    const settle = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve({ timedOut, status: null, signal: null, stdout, stderr, pid: child.pid, timeoutSignal, ...result });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutSignal = 'SIGTERM';
      try { child.kill(timeoutSignal); } catch {}
      graceTimer = setTimeout(() => {
        timeoutSignal = 'SIGKILL';
        try { child.kill(timeoutSignal); } catch {}
      }, 10000);
    }, options.timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 10 * 1024 * 1024) stdout = stdout.slice(-10 * 1024 * 1024); });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => settle({ error }));
    child.on('exit', (status, signal) => settle({ status, signal }));
  });
}

function readPhaseSnapshot(phasePath, childDir) {
  try {
    if (path.dirname(phasePath) !== childDir || fs.lstatSync(phasePath).isSymbolicLink()) return undefined;
    const snapshot = JSON.parse(fs.readFileSync(phasePath, 'utf8'));
    return snapshot?.schemaVersion === 1 && typeof snapshot.phase === 'string' && typeof snapshot.at === 'string' ? snapshot.phase : undefined;
  } catch { return undefined; }
}

function coordinatorFailure(runEnvelope, provenance, code, message) {
  return {
    schemaVersion: 1, contract: 'lgvs-telemetry', status: 'failure', ok: false,
    classification: 'infrastructure', outcome: 'failure', phase: 'coordinator', code,
    message: String(message).slice(0, 8000), generatedAt: new Date().toISOString(),
    runId: runEnvelope.runId, lane: runEnvelope.lane, envelopeDigest: runEnvelope.digest, provenance,
    identity: { runId: runEnvelope.runId, lane: runEnvelope.lane, source: provenance.head, build: provenance.digest, reportPath: runEnvelope.paths.aggregateResult }
  };
}

async function runTelemetryCoordinator(testOnly = undefined) {
  if (!testOnly && process.env.LGVS_TELEMETRY_TEST_INJECTION) {
    throw new Error('LGVS_TELEMETRY_TEST_INJECTION is not accepted by the production entry point');
  }
  const injection = testOnly?.injection;
  const knownInjections = new Set(['post-envelope-exception', 'launch-failure', 'zero-result']);
  if (injection && !knownInjections.has(injection)) throw new Error(`Unknown test injection: ${injection}`);
  const selection = parseFixtureSelector(process.env.LGVS_TELEMETRY_FIXTURES);
  const coordinatorOutput = testOnly?.outputPath || output;
  fs.mkdirSync(path.dirname(coordinatorOutput), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const codePath = testOnly?.codePath || await require('@vscode/test-electron').downloadAndUnzipVSCode('stable');
  const provenance = testOnly?.captureProvenance
    ? testOnly.captureProvenance({ repoRoot: root, extensionVersion: pkg.version, nodeExecutable: process.execPath, vscodeExecutable: codePath })
    : captureProvenance({ repoRoot: root, extensionVersion: pkg.version, nodeExecutable: process.execPath, vscodeExecutable: codePath });
  const runId = crypto.randomUUID();
  const runEnvelope = createRunEnvelope({ outputPath: coordinatorOutput, repoRoot: root, runId, lane: 'telemetry-matrix', provenance });
  let published = false;
  const publishTerminal = report => {
    if (published) throw new Error('Coordinator terminal result was already published');
    publishJsonOnce(runEnvelope.paths.aggregateResult, report, { runRoot: runEnvelope.paths.runRoot });
    published = true;
  };
  try {
  if (injection === 'post-envelope-exception') throw Object.assign(new Error(process.env.LGVS_TELEMETRY_TEST_MESSAGE || 'injected coordinator exception'), { coordinatorCode: 'COORDINATOR_EXCEPTION' });
  const runs = [];
  const failures = [];
  for (const fixture of selection.fixtures) {
    const lane = `telemetry-${fixture.fileCount}f-${fixture.repoCount}r`;
    const childDir = path.join(runEnvelope.paths.tempDir, fixtureKey(fixture));
    fs.mkdirSync(childDir, { mode: 0o700 });
    const phasePath = path.join(childDir, 'phase.json');
    const reportPath = path.join(runEnvelope.paths.childrenDir, `${fixtureKey(fixture)}.json`);
    const dogfoodArgs = [process.execPath, path.join(__dirname, 'dogfood-ui.js')];
    const command = process.env.DISPLAY ? dogfoodArgs.shift() : 'xvfb-run';
    const args = process.env.DISPLAY ? dogfoodArgs : ['-a', ...dogfoodArgs];
    const result = await (testOnly?.runChild || runChild)(injection === 'zero-result' ? process.execPath : injection === 'launch-failure' ? path.join(runEnvelope.paths.tempDir, 'missing-executable') : command, injection === 'zero-result' ? ['-e', ''] : args, {
      cwd: root,
      timeout: Number(process.env.LGVS_TELEMETRY_RUN_TIMEOUT_MS || 1200000),
      env: {
        ...process.env,
        LGVS_DOGFOOD_VARIANT: 'no-vim',
        LGVS_DOGFOOD_TELEMETRY: '1',
        LGVS_TELEMETRY_FILE_COUNT: String(fixture.fileCount),
        LGVS_TELEMETRY_REPO_COUNT: String(fixture.repoCount),
        LGVS_TELEMETRY_WARM_SAMPLES: warmSamples,
        LGVS_TELEMETRY_ENVELOPE_PATH: runEnvelope.envelopePath,
        LGVS_TELEMETRY_CHILD_DIR: childDir,
        LGVS_TELEMETRY_PHASE_PATH: phasePath,
        LGVS_DOGFOOD_REPORT_PATH: reportPath,
        LGVS_TELEMETRY_LANE: lane,
        LGVS_TELEMETRY_ENVELOPE_DIGEST: runEnvelope.digest,
        LGVS_TELEMETRY_VSCODE_PATH: codePath
      }
    });
    const child = { timedOut: !!result.timedOut, status: result.status ?? null, signal: result.signal ?? null, stderr: result.stderr || '', lastPhase: readPhaseSnapshot(phasePath, childDir), pid: result.pid ?? null, timeoutSignal: result.timeoutSignal ?? null };
    let dogfoodReport;
    let reportStat;
    try {
      dogfoodReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      reportStat = fs.statSync(reportPath);
    } catch {}
    const bindingErrors = dogfoodReport && reportStat
      ? validateEnvelopeBinding({ envelope: runEnvelope, report: dogfoodReport, reportPath, stat: reportStat, expectedLane: lane, maxAgeMs: 5 * 60 * 1000 })
      : ['child did not atomically publish a current terminal result'];
    if (result.status !== 0 || dogfoodReport?.status !== 'success' || !dogfoodReport?.telemetry || bindingErrors.length) {
      const error = bindingErrors.join('; ') || dogfoodReport?.error || result.error || result.stderr || `dogfood exited ${result.status}${result.signal ? ` (${result.signal})` : ''}`;
      const code = result.timedOut ? 'CHILD_TIMEOUT' : result.error ? 'CHILD_LAUNCH_FAILED' : !dogfoodReport ? 'CHILD_RESULT_MISSING_OR_INVALID' : result.status !== 0 ? 'CHILD_EXECUTION_FAILED' : dogfoodReport.status !== 'success' || !dogfoodReport.telemetry ? 'CHILD_RESULT_FAILED' : 'CHILD_BINDING_INVALID';
      const classification = ['infrastructure', 'product'].includes(dogfoodReport?.classification) ? dogfoodReport.classification : 'infrastructure';
      failures.push({ fixture, outcome: 'failure', phase: 'coordinator', code, classification: result.timedOut ? 'infrastructure' : classification, error: String(error).slice(0, 8000), child });
      break;
    }
    runs.push(dogfoodReport.telemetry);
    console.log(`telemetry ${fixture.fileCount} files / ${fixture.repoCount} repos: ok`);
  }
  const report = makeTelemetryReport({
    versions: { node: process.version, vscode: runs[0]?.launch?.vscodeVersion || 'stable', extension: pkg.version, platform: `${os.platform()} ${os.release()}` },
    runs,
    scope: selection.scope,
    identity: { runId, lane: 'telemetry-matrix', source: provenance.head, build: provenance.digest, reportPath: runEnvelope.paths.aggregateResult, executables: { node: provenance.node, vscode: provenance.vscode } },
    envelopeDigest: runEnvelope.digest,
    provenance,
    samples: { warm: Number(warmSamples), cold: 1 },
    failures
  });
  report.status = failures.length ? 'failure' : 'success';
  report.outcome = failures.length ? 'failure' : 'success';
  report.phase = 'coordinator';
  report.code = failures[0]?.code || 'COORDINATOR_COMPLETED';
  if (failures.length) {
    report.ok = false;
    report.classification = failures.some(failure => failure.classification === 'product') ? 'product' : 'infrastructure';
  }
  const errors = failures.length ? [] : validateTelemetryReport(report, {
    expectedIdentity: report.identity,
    reportPath: runEnvelope.paths.aggregateResult,
    envelope: runEnvelope
  });
  if (errors.length) {
    report.status = 'failure';
    report.outcome = 'failure';
    report.code = 'AGGREGATE_VALIDATION_FAILED';
    report.ok = false;
    report.classification = 'infrastructure';
    report.failures = [{ outcome: 'failure', phase: 'coordinator', code: 'AGGREGATE_VALIDATION_FAILED', classification: 'infrastructure', error: errors.join('; ') }];
  }
  publishTerminal(report);
  if (failures.length || errors.length) {
    if (errors.length) console.error(errors.join('\n'));
    if (testOnly?.runChild) return runEnvelope.paths.aggregateResult;
    process.exit(1);
  }
  console.log(`Telemetry matrix passed: ${runs.length} fixtures -> ${runEnvelope.paths.aggregateResult}`);
  return runEnvelope.paths.aggregateResult;
  } catch (error) {
    if (!published) publishTerminal(coordinatorFailure(runEnvelope, provenance, error.coordinatorCode || 'COORDINATOR_EXCEPTION', error.message || error));
    throw error;
  }
}

async function runTelemetryCoordinatorForTest({ outputPath, captureProvenance, runChild: testRunChild, phasePath }) {
  return JSON.parse(fs.readFileSync(await runTelemetryCoordinator({ outputPath, codePath: process.execPath, captureProvenance, runChild: async (command, args, options) => testRunChild({ command, args, phasePath: phasePath || options.env.LGVS_TELEMETRY_PHASE_PATH }) }), 'utf8'));
}

module.exports = { runChild, runTelemetryCoordinator, runTelemetryCoordinatorForTest };

if (require.main === module) {
  runTelemetryCoordinator().then(reportPath => {
    if (!process.argv.includes('--check')) return;
    const result = spawnSync(process.execPath, [path.join(__dirname, 'check-dogfood-telemetry.js'), reportPath], { cwd: root, stdio: 'inherit', env: process.env });
    if (result.status !== 0) process.exit(result.status || 1);
  }).catch(error => {
    console.error(error);
    process.exit(1);
  });
}
