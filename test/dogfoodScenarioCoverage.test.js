const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');

function readJsonIfExists(rel) {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

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

test('dogfood scenario coverage has a canonical manifest and checker', () => {
  const manifest = readJsonIfExists('scripts/dogfood/coverage-manifest.json');
  assert(manifest, 'scripts/dogfood/coverage-manifest.json must exist');
  assert(Array.isArray(manifest.scenarios), 'manifest must expose scenarios array');
  assert(manifest.scenarios.length >= 30, 'manifest should cover the current broad dogfood surface plus new high-risk gaps');
  for (const scenario of manifest.scenarios) {
    assert(scenario.id && /^[a-z0-9-]+$/.test(scenario.id), `bad scenario id: ${scenario.id}`);
    assert(scenario.risk, `${scenario.id} must declare risk`);
    assert(scenario.lane, `${scenario.id} must declare lane`);
    assert(scenario.check, `${scenario.id} must declare dogfood check name`);
  }
  assert.strictEqual(pkg.scripts['dogfood:coverage'], 'node scripts/dogfood-coverage.js');
  assert(fs.existsSync(path.join(root, 'scripts', 'dogfood-coverage.js')), 'dogfood coverage checker must exist');
});

test('dogfood reports are lane-stable and do not overwrite full no-vim/vim runs', () => {
  assert.match(dogfood, /TARGETED_LANE/, 'dogfood harness must compute targeted lane names');
  assert.match(dogfood, /last-run-\$\{REPORT_SLUG\}\.json/, 'report filename must include variant plus targeted/full lane slug');
  assert(!dogfood.includes("VARIANT ? `last-run-${VARIANT}.json` : 'last-run.json'"), 'targeted runs must not overwrite last-run-no-vim.json');
});

test('dogfood covers high-risk gaps beyond the existing happy path', () => {
  const manifest = readJsonIfExists('scripts/dogfood/coverage-manifest.json');
  const ids = new Set((manifest?.scenarios || []).map(s => s.id));
  for (const id of [
    'conflict-choose-ours-cancel-safe',
    'conflict-choose-ours-physical-resolution',
    'deleted-preview-sane',
    'renamed-preview-sane',
    'binary-file-preview-sane',
    'large-repo-refresh-budget',
    'dark-theme-smoke',
    'high-contrast-theme-smoke',
    'git-failure-path-visible',
    'destructive-discard-cancel-safe'
  ]) {
    assert(ids.has(id), `missing high-risk dogfood scenario ${id}`);
  }
  for (const token of [
    'LGVS_DOGFOOD_BINARY_FILE',
    'LGVS_DOGFOOD_LARGE_REPO',
    'LGVS_DOGFOOD_GIT_FAILURE',
    'LGVS_DOGFOOD_DESTRUCTIVE_CANCEL',
    'Deleted file preview stays sane',
    'Renamed file preview stays sane',
    'Binary file preview stays sane',
    'Large repo refresh stays inside budget',
    'Conflict choose ours can be cancelled safely',
    'Conflict choose ours resolves physical conflict path',
    'Git failure path is visible and non-fatal',
    'Destructive discard cancel keeps worktree intact'
  ]) {
    assert(dogfood.includes(token), `dogfood harness missing ${token}`);
  }
});
