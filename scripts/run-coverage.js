#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = [
  'c8',
  '--check-coverage',
  '--lines', '80',
  '--functions', '75',
  '--branches', '70',
  '--statements', '80',
  '--include', 'out/hunkPatch.js',
  '--include', 'out/lazygitConfig.js',
  '--include', 'out/lazygitMenu.js',
  '--include', 'out/gitService.js',
  process.execPath,
  'scripts/run-tests.js'
];

const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, NODE_V8_COVERAGE: path.join(ROOT, 'coverage', '.v8') }
});

process.exit(result.status ?? 1);
