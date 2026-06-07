#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const testDir = path.join(ROOT, 'test');
const tests = fs.readdirSync(path.join(ROOT, 'test'))
  .filter(file => file.endsWith('.test.js'))
  .sort()
  .map(file => path.join('test', file));

const failures = [];
const started = Date.now();

for (const testFile of tests) {
  const label = testFile.replace(/\\/g, '/');
  const stepStarted = Date.now();
  console.log(`\n▶ ${label}`);
  const result = spawnSync(process.execPath, [testFile], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const elapsed = Date.now() - stepStarted;
  if (result.status === 0) {
    console.log(`✓ ${label} (${elapsed}ms)`);
  } else {
    failures.push({ file: label, status: result.status, elapsed });
    console.error(`✗ ${label} (${elapsed}ms, exit ${result.status})`);
  }
}

const totalElapsed = Date.now() - started;
if (failures.length) {
  console.error('\nFailure summary:');
  for (const failure of failures) {
    console.error(`- ${failure.file}: exit ${failure.status} (${failure.elapsed}ms)`);
  }
  console.error(`\n${failures.length}/${tests.length} test files failed in ${totalElapsed}ms.`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} test files passed in ${totalElapsed}ms.`);
