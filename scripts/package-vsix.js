#!/usr/bin/env node
/* Package LazyGitVS into a VSIX.
 *
 * Default local build output: ../releases/LazyGitVS/lazygitvs-<commit>.vsix via package.json
 * Dist/Marketplace output: dist/lazygitvs-<version>.vsix
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
const relOutDir = path.relative(root, outDir);
const isDistOutDir = relOutDir === 'dist' || relOutDir.startsWith(`dist${path.sep}`);
const gitShortHash = () => {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Failed to resolve git commit hash for local VSIX filename');
  return result.stdout.trim();
};
const outFile = process.env.LGVS_VSIX_OUT_FILE
  ? path.resolve(process.env.LGVS_VSIX_OUT_FILE)
  : path.join(outDir, `lazygitvs-${isDistOutDir ? pkg.version : gitShortHash()}.vsix`);
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
