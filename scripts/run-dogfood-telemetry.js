#!/usr/bin/env node
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { fixtureKey, parseFixtureSelector, makeTelemetryReport, validateTelemetryReport, classifyFailure } = require('./dogfood/telemetry');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.LGVS_TELEMETRY_OUTPUT || path.join(root, 'dogfood-output', 'telemetry.json'));
const warmSamples = String(Math.max(2, Math.min(20, Number(process.env.LGVS_TELEMETRY_WARM_SAMPLES || 5))));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function foreignDogfoodProcesses() {
  const matches = [];
  for (const entry of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const args = fs.readFileSync(path.join('/proc', entry, 'cmdline'), 'utf8').split('\0').filter(Boolean);
      const dogfoodScript = args.find(arg => /(?:^|\/)scripts\/dogfood-ui\.js$/.test(arg));
      if (dogfoodScript && !path.resolve(dogfoodScript).startsWith(root + path.sep)) matches.push({ pid: Number(entry), command: args.join(' ').slice(0, 500) });
    } catch { /* process exited */ }
  }
  return matches;
}

(async () => {
  const contamination = foreignDogfoodProcesses();
  if (contamination.length) throw new Error(`Telemetry host is contaminated by another dogfood run: ${JSON.stringify(contamination)}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const selection = parseFixtureSelector(process.env.LGVS_TELEMETRY_FIXTURES);
  const fixtures = selection.fixtures;
  const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(source)) throw new Error('Could not determine telemetry source identity');
  const runId = crypto.randomUUID();
  const build = `${source}:${pkg.version}`;
  const runRoot = path.join(path.dirname(output), 'runs', runId);
  const runs = [];
  const failures = [];
  for (const fixture of fixtures) {
    const port = await freePort();
    const lane = `telemetry-${fixture.fileCount}f-${fixture.repoCount}r`;
    const reportPath = path.join(runRoot, `${lane}.json`);
    fs.mkdirSync(runRoot, { recursive: true });
    const dogfoodArgs = [process.execPath, path.join(__dirname, 'dogfood-ui.js')];
    const command = process.env.DISPLAY ? dogfoodArgs.shift() : 'xvfb-run';
    const args = process.env.DISPLAY ? dogfoodArgs : ['-a', ...dogfoodArgs];
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: Number(process.env.LGVS_TELEMETRY_RUN_TIMEOUT_MS || 1200000),
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        LGVS_DOGFOOD_VARIANT: 'no-vim',
        LGVS_DOGFOOD_TELEMETRY: '1',
        LGVS_TELEMETRY_FILE_COUNT: String(fixture.fileCount),
        LGVS_TELEMETRY_REPO_COUNT: String(fixture.repoCount),
        LGVS_TELEMETRY_WARM_SAMPLES: warmSamples,
        LGVS_DOGFOOD_CDP_PORT: String(port),
        LGVS_DOGFOOD_REPORT_PATH: reportPath,
        LGVS_TELEMETRY_RUN_ID: runId,
        LGVS_TELEMETRY_LANE: lane,
        LGVS_TELEMETRY_SOURCE: source,
        LGVS_TELEMETRY_BUILD: build
      }
    });
    let dogfoodReport;
    try { dogfoodReport = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { dogfoodReport = undefined; }
    const expectedChildIdentity = { runId, lane, source, build, fixture: fixtureKey(fixture), reportPath };
    const childIdentityMatches = Object.entries(expectedChildIdentity).every(([key, value]) => dogfoodReport?.telemetry?.identity?.[key] === value);
    if (result.status !== 0 || !dogfoodReport?.ok || !dogfoodReport.telemetry || !childIdentityMatches) {
      const error = dogfoodReport?.error || result.error || result.stderr || `dogfood exited ${result.status}`;
      failures.push({ fixture, classification: dogfoodReport?.classification || classifyFailure(error), error: String(error).slice(0, 8000) });
      break;
    }
    runs.push(dogfoodReport.telemetry);
    console.log(`telemetry ${fixture.fileCount} files / ${fixture.repoCount} repos: ok`);
  }
  const report = makeTelemetryReport({
    versions: { node: process.version, vscode: runs[0]?.launch?.vscodeVersion || 'stable', extension: pkg.version, platform: `${os.platform()} ${os.release()}` },
    runs,
    scope: selection.scope,
    identity: { runId, lane: 'telemetry-matrix', source, build, reportPath: output },
    samples: { warm: Number(warmSamples), cold: 1 },
    failures
  });
  if (failures.length) {
    report.ok = false;
    report.classification = failures.some(failure => failure.classification === 'product') ? 'product' : 'infrastructure';
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  const errors = failures.length ? [] : validateTelemetryReport(report, {
    expectedIdentity: { runId, lane: 'telemetry-matrix', source, build, reportPath: output },
    reportPath: output
  });
  if (failures.length || errors.length) {
    if (errors.length) console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`Telemetry matrix passed: ${runs.length} fixtures -> ${output}`);
})().catch(error => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, ok: false, classification: classifyFailure(error), error: String(error?.stack || error) }, null, 2));
  console.error(error);
  process.exit(1);
});
