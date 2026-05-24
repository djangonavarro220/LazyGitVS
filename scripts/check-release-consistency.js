#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));

const pkg = json('package.json');
const lock = json('package-lock.json');
const version = pkg.version;
const expectedTag = `v${version}`;
const failures = [];

function fail(message) {
  failures.push(message);
}

function requireMatch(file, regex, expected, label) {
  const text = read(file);
  const match = text.match(regex);
  if (!match) {
    fail(`${file}: missing ${label}`);
    return;
  }
  if (match[1] !== expected) {
    fail(`${file}: ${label} is ${match[1]}, expected ${expected}`);
  }
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`package.json: version ${version} is not semver-ish`);
}

if (lock.version !== version) {
  fail(`package-lock.json: top-level version is ${lock.version}, expected ${version}`);
}
if (lock.packages?.['']?.version !== version) {
  fail(`package-lock.json: root package version is ${lock.packages?.['']?.version}, expected ${version}`);
}

requireMatch('README.md', /Current preview:\s*\*\*([^*]+)\*\*/, version, 'Current preview version');

const changelog = read('CHANGELOG.md');
if (!new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm').test(changelog)) {
  fail(`CHANGELOG.md: missing top-level entry for ${version}`);
}

const releaseDocs = ['README.md', 'BUILDING.md', 'MARKETPLACE.md'];
for (const file of releaseDocs) {
  const text = read(file);
  for (const match of text.matchAll(/lazygitvs-(\d+\.\d+\.\d+)\.vsix/g)) {
    if (match[1] !== version) {
      fail(`${file}: VSIX example uses ${match[1]}, expected ${version} or <version>`);
    }
  }
  for (const match of text.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)) {
    if (match[1] !== version) {
      fail(`${file}: tag example uses v${match[1]}, expected ${expectedTag} or v<version>`);
    }
  }
}

const building = read('BUILDING.md');
if (building.includes('../releases/LazyGitVS/lazygitvs-<version>.vsix')) {
  fail('BUILDING.md: local dogfood VSIX output must use <commit>, not <version>');
}

const publish = read('.github/workflows/publish.yml');
if (!publish.includes('npm run check:release')) {
  fail('.github/workflows/publish.yml: publish workflow must run npm run check:release');
}
if (!publish.includes('git checkout --detach "$INPUT_TAG"')) {
  fail('.github/workflows/publish.yml: workflow_dispatch tag input must checkout the requested tag before publishing');
}
if (!publish.includes('HEAD_SHA="$(git rev-parse HEAD)"') || !publish.includes('TAG_SHA="$(git rev-list -n 1 "$TAG")"')) {
  fail('.github/workflows/publish.yml: publish workflow must verify HEAD matches the release tag');
}
if (publish.indexOf('name: Publish to Visual Studio Marketplace') > publish.indexOf('name: Create GitHub release')) {
  fail('.github/workflows/publish.yml: Marketplace publish must happen before GitHub release creation to avoid partial releases');
}
if (!publish.includes('name: Verify Marketplace token')) {
  fail('.github/workflows/publish.yml: publish workflow must fail early when VSCE_PAT is missing');
}

const ci = read('.github/workflows/ci.yml');
if (!ci.includes('npm run check:release')) {
  fail('.github/workflows/ci.yml: CI must run npm run check:release');
}

if (failures.length) {
  console.error('Release consistency check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Release consistency OK for ${version}`);
