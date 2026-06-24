#!/usr/bin/env node
/* Inspect a generated VSIX for Marketplace hygiene.
 *
 * This is intentionally small and dependency-free: it shells out to unzip so the
 * package command proves the actual archive contents, not just .vscodeignore.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const vsix = process.argv[2];
if (!vsix) {
  console.error('Usage: node scripts/inspect-vsix-content.js <path-to.vsix>');
  process.exit(2);
}

function runUnzip(args) {
  const result = spawnSync('unzip', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`unzip ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

const entries = runUnzip(['-Z1', vsix]).split(/\r?\n/).filter(Boolean).sort();
const entrySet = new Set(entries);
const failures = [];

const requiredFiles = [
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/readme.md',
  'extension/LICENSE.txt',
  'extension/changelog.md',
  'extension/out/extension.js',
  'extension/resources/icon.png',
  'extension/docs/assets/readme-hunk-mode.png'
];

for (const file of requiredFiles) {
  if (!entrySet.has(file)) failures.push(`missing required VSIX file: ${file}`);
}

const allowedFiles = [
  /^extension\.vsixmanifest$/,
  /^\[Content_Types\]\.xml$/,
  /^extension\/(?:package|package-lock)\.json$/,
  /^extension\/(?:readme|changelog)\.md$/,
  /^extension\/LICENSE\.txt$/,
  /^extension\/out\/[A-Za-z0-9_-]+\.js$/,
  /^extension\/resources\/icon\.png$/,
  /^extension\/docs\/assets\/readme-hunk-mode\.png$/,
  /^extension\/docs\/(?:known-bugs|testing-and-verification|testing-coverage-implementation-plan)\.md$/
];

const bannedPathPatterns = [
  /^extension\/(?:src|test|scripts|dogfood-output|dist|coverage|node_modules)\//,
  /^extension\/(?:\.git|\.github|\.vscode|\.vscode-test|\.nyc_output|\.local)\//,
  /^extension\/docs\/(?:plans|dogfooding-|lazygit-)/,
  /^extension\/out\/.*\.map$/,
  /^extension\/.*\.vsix$/,
  /^extension\/.*\.log$/,
  /^extension\/.*(?:^|\/)\.env(?:\..*)?$/,
  /^extension\/.*\.local$/,
  /^extension\/(?:AGENTS|BUILDING|MARKETPLACE)\.md$/,
  /^extension\/(?:tsconfig\.json|resources\/logo\.png)$/
];

for (const entry of entries) {
  if (bannedPathPatterns.some((pattern) => pattern.test(entry))) {
    failures.push(`banned VSIX path present: ${entry}`);
  }
  if (!allowedFiles.some((pattern) => pattern.test(entry))) {
    failures.push(`unexpected VSIX file: ${entry}`);
  }
}

const textEntries = entries.filter((entry) => entry !== '[Content_Types].xml' && /\.(?:js|json|md|txt|vsixmanifest)$/.test(entry));
const bannedStringPatterns = [
  { pattern: /\/home\/saldo/i, label: 'private absolute path /home/saldo' },
  { pattern: /syncthing\/openclaw-saldo/i, label: 'private absolute path fragment syncthing/openclaw-saldo' },
  { pattern: /LGVS_VSIX_OUT_FILE=\/home/i, label: 'private absolute path in local VSIX override example' },
  { pattern: /BEGIN (?:RSA |OPENSSH |DSA |EC )?PRIVATE KEY/i, label: 'private key material' },
  { pattern: /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/, label: 'GitHub token-looking secret' }
];

for (const entry of textEntries) {
  const text = runUnzip(['-p', vsix, entry]);
  for (const { pattern, label } of bannedStringPatterns) {
    if (pattern.test(text)) failures.push(`banned VSIX string (${label}) in ${entry}`);
  }
}

if (failures.length) {
  console.error(`VSIX content inspection failed for ${path.resolve(vsix)}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('\nVSIX entries:');
  for (const entry of entries) console.error(entry);
  process.exit(1);
}

console.log(`VSIX content inspection passed: ${path.resolve(vsix)}`);
console.log(`VSIX files (${entries.length}):`);
for (const entry of entries) console.log(entry);
