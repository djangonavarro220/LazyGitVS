#!/usr/bin/env node
/* Package LazyGitVS into a VSIX.
 *
 * Default build output: ../releases/LazyGitVS/lazygitvs-<version>.vsix via package.json
 * Output override: LGVS_VSIX_OUT_DIR=/some/path npm run package:local
 * File override: LGVS_VSIX_OUT_FILE=/some/path/name.vsix npm run package:local
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const outDir = process.env.LGVS_VSIX_OUT_DIR
  ? path.resolve(process.env.LGVS_VSIX_OUT_DIR)
  : path.join(root, 'dist');
const outFile = process.env.LGVS_VSIX_OUT_FILE
  ? path.resolve(process.env.LGVS_VSIX_OUT_FILE)
  : path.join(outDir, `lazygitvs-${pkg.version}.vsix`);

fs.mkdirSync(path.dirname(outFile), { recursive: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, ['vsce', 'package', '--no-dependencies', '--out', outFile], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`VSIX: ${outFile}`);
