#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { fixtureKey, parseFixtureSelector, makeTelemetryReport, validateTelemetryReport } = require('./dogfood/telemetry');
const { captureProvenance, createRunEnvelope, publishJsonOnce, validateEnvelopeBinding } = require('./dogfood/run-envelope');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.LGVS_TELEMETRY_OUTPUT || path.join(root, 'dogfood-output', 'telemetry.json'));
const warmSamples = String(Math.max(2, Math.min(20, Number(process.env.LGVS_TELEMETRY_WARM_SAMPLES || 5))));

function runChild(command, args, options) {
  return new Promise(resolve => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
    }, options.timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 10 * 1024 * 1024) stdout = stdout.slice(-10 * 1024 * 1024); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 10 * 1024 * 1024) stderr = stderr.slice(-10 * 1024 * 1024); });
    child.on('error', error => { clearTimeout(timer); resolve({ status: null, error, stdout, stderr, pid: child.pid }); });
    child.on('exit', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr, pid: child.pid }); });
  });
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

(async () => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const injection = process.env.LGVS_TELEMETRY_TEST_INJECTION;
  const codePath = injection ? process.execPath : await require('@vscode/test-electron').downloadAndUnzipVSCode('stable');
  const provenance = injection ? { head: 'a'.repeat(40), tree: 'b'.repeat(40), digest: 'c'.repeat(64), extensionVersion: pkg.version } : captureProvenance({ repoRoot: root, extensionVersion: pkg.version, nodeExecutable: process.execPath, vscodeExecutable: codePath });
  const runId = crypto.randomUUID();
  const runEnvelope = createRunEnvelope({ outputPath: output, repoRoot: root, runId, lane: 'telemetry-matrix', provenance });
  let published = false;
  const publishTerminal = report => {
    if (published) throw new Error('Coordinator terminal result was already published');
    publishJsonOnce(runEnvelope.paths.aggregateResult, report, { runRoot: runEnvelope.paths.runRoot });
    published = true;
  };
  try {
  if (injection === 'post-envelope-exception') throw Object.assign(new Error(process.env.LGVS_TELEMETRY_TEST_MESSAGE || 'injected coordinator exception'), { coordinatorCode: 'COORDINATOR_EXCEPTION' });
  const selection = parseFixtureSelector(process.env.LGVS_TELEMETRY_FIXTURES);
  const runs = [];
  const failures = [];
  for (const fixture of selection.fixtures) {
    const lane = `telemetry-${fixture.fileCount}f-${fixture.repoCount}r`;
    const childDir = path.join(runEnvelope.paths.tempDir, fixtureKey(fixture));
    fs.mkdirSync(childDir, { mode: 0o700 });
    const reportPath = path.join(runEnvelope.paths.childrenDir, `${fixtureKey(fixture)}.json`);
    const dogfoodArgs = [process.execPath, path.join(__dirname, 'dogfood-ui.js')];
    const command = process.env.DISPLAY ? dogfoodArgs.shift() : 'xvfb-run';
    const args = process.env.DISPLAY ? dogfoodArgs : ['-a', ...dogfoodArgs];
    const result = await runChild(injection === 'zero-result' ? process.execPath : injection === 'launch-failure' ? path.join(runEnvelope.paths.tempDir, 'missing-executable') : command, injection === 'zero-result' ? ['-e', ''] : args, {
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
        LGVS_DOGFOOD_REPORT_PATH: reportPath,
        LGVS_TELEMETRY_LANE: lane,
        LGVS_TELEMETRY_ENVELOPE_DIGEST: runEnvelope.digest,
        LGVS_TELEMETRY_VSCODE_PATH: codePath
      }
    });
    let dogfoodReport;
    let reportStat;
    try {
      dogfoodReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      reportStat = fs.statSync(reportPath);
    } catch {}
    const bindingErrors = dogfoodReport && reportStat
      ? validateEnvelopeBinding({ envelope: runEnvelope, report: dogfoodReport, reportPath, stat: reportStat, expectedLane: lane })
      : ['child did not atomically publish a current terminal result'];
    if (result.status !== 0 || dogfoodReport?.status !== 'success' || !dogfoodReport?.telemetry || bindingErrors.length) {
      const error = bindingErrors.join('; ') || dogfoodReport?.error || result.error || result.stderr || `dogfood exited ${result.status}${result.signal ? ` (${result.signal})` : ''}`;
      const code = result.error ? 'CHILD_LAUNCH_FAILED' : !dogfoodReport ? 'CHILD_RESULT_MISSING_OR_INVALID' : result.status !== 0 ? 'CHILD_EXECUTION_FAILED' : dogfoodReport.status !== 'success' || !dogfoodReport.telemetry ? 'CHILD_RESULT_FAILED' : 'CHILD_BINDING_INVALID';
      const classification = ['infrastructure', 'product'].includes(dogfoodReport?.classification) ? dogfoodReport.classification : 'infrastructure';
      failures.push({ fixture, outcome: 'failure', phase: 'coordinator', code, classification, error: String(error).slice(0, 8000) });
      break;
    }
    runs.push(dogfoodReport.telemetry);
    console.log(`telemetry ${fixture.fileCount} files / ${fixture.repoCount} repos: ok`);
  }
  const report = makeTelemetryReport({
    versions: { node: process.version, vscode: runs[0]?.launch?.vscodeVersion || 'stable', extension: pkg.version, platform: `${os.platform()} ${os.release()}` },
    runs,
    scope: selection.scope,
    identity: { runId, lane: 'telemetry-matrix', source: provenance.head, build: provenance.digest, reportPath: runEnvelope.paths.aggregateResult },
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
    process.exit(1);
  }
  console.log(`Telemetry matrix passed: ${runs.length} fixtures -> ${runEnvelope.paths.aggregateResult}`);
  } catch (error) {
    if (!published) publishTerminal(coordinatorFailure(runEnvelope, provenance, error.coordinatorCode || 'COORDINATOR_EXCEPTION', error.message || error));
    throw error;
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
