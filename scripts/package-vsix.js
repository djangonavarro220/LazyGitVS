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
const relOut = path.relative(root, outFile);
const isDistBuild = relOut === 'dist' || relOut.startsWith(`dist${path.sep}`);
const rewriteRelativeLinks = process.env.LGVS_REWRITE_RELATIVE_LINKS === '1' || isDistBuild;

fs.mkdirSync(path.dirname(outFile), { recursive: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['vsce', 'package', '--no-dependencies', '--out', outFile];
if (!rewriteRelativeLinks) args.push('--no-rewrite-relative-links');
const result = spawnSync(npx, args, {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`VSIX: ${outFile}`);
