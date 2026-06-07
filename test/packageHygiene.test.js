const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vscodeignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8').split(/\r?\n/).filter(Boolean);
const packageVsix = fs.readFileSync(path.join(root, 'scripts', 'package-vsix.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const building = fs.readFileSync(path.join(root, 'BUILDING.md'), 'utf8');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function hasIgnore(pattern) {
  assert(vscodeignore.includes(pattern), `.vscodeignore must include ${pattern}`);
}

test('package scripts separate local dogfood output from portable dist output', () => {
  assert.strictEqual(pkg.scripts.package, 'LGVS_VSIX_OUT_DIR=../releases/LazyGitVS npm run package:vsix');
  assert.strictEqual(pkg.scripts['package:dist'], 'LGVS_VSIX_OUT_DIR=dist npm run package:vsix');
  assert.strictEqual(pkg.scripts['package:local'], 'node scripts/package-vsix.js');
  assert.match(packageVsix, /LGVS_VSIX_OUT_FILE/);
  assert.match(packageVsix, /LGVS_VSIX_OUT_DIR/);
});

test('VSIX ignore rules exclude generated, test, dogfood and local artifacts', () => {
  for (const pattern of [
    'node_modules/**',
    'src/**',
    'test/**',
    '.git/**',
    '.github/**',
    '*.vsix',
    '.vscode/**',
    '*.log',
    'out/**/*.map',
    'tsconfig.json',
    'docs/plans/**',
    'dogfood-output/**',
    'scripts/**',
    '.vscode-test/**',
    'dist/**',
    'coverage/**',
    '.nyc_output/**',
    '.local/**',
    '.env',
    '.env.*',
    '*.local'
  ]) {
    hasIgnore(pattern);
  }
});

test('VSIX keeps the README screenshot while excluding source-only assets', () => {
  hasIgnore('docs/assets/**');
  hasIgnore('!docs/assets/readme-hunk-mode.png');
  hasIgnore('resources/logo.png');
  assert(readme.includes('docs/assets/readme-hunk-mode.png'), 'README must reference the screenshot explicitly re-included in the VSIX');
});

test('public docs do not leak private local absolute paths', () => {
  const publicDocs = { README: readme, BUILDING: building };
  for (const [name, text] of Object.entries(publicDocs)) {
    assert(!text.includes('/home/saldo'), `${name} must not include host-local /home/saldo paths`);
    assert(!text.includes('syncthing/openclaw-saldo'), `${name} must not include private Syncthing paths`);
    assert(!text.includes('LGVS_VSIX_OUT_FILE=/home'), `${name} must not include private output overrides`);
  }
});

test('Marketplace/public metadata is consistent and not placeholder-local', () => {
  assert.strictEqual(pkg.publisher, 'lazygitvs');
  assert.strictEqual(pkg.repository.type, 'git');
  assert.match(pkg.repository.url, /^https:\/\/github\.com\//);
  assert.match(pkg.bugs.url, /^https:\/\/github\.com\//);
  assert.match(pkg.homepage, /^https:\/\/github\.com\//);
  assert(!/example\.com|localhost|127\.0\.0\.1/.test(JSON.stringify(pkg.repository) + JSON.stringify(pkg.bugs) + pkg.homepage));
});
