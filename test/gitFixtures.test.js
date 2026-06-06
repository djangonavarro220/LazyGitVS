const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { createRealisticRepo, createWorkspaceRepos, git, cleanupFixture } = require('./helpers/gitFixtures');

function test(name, fn) {
  let fixture;
  try {
    fixture = createRealisticRepo();
    fn(fixture);
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stderr || error.stdout || error);
    process.exitCode = 1;
  } finally {
    if (fixture) cleanupFixture(fixture);
  }
}

test('realistic fixture exposes mixed staged/unstaged/untracked status', ({ dir }) => {
  const status = git(dir, 'status', '--short');
  assert.match(status, /^MM settings\.json/m, 'settings.json should have staged and unstaged edits');
  assert.match(status, /^ M README\.md/m, 'README.md should have an unstaged edit');
  assert.match(status, /^ M src\/app\.ts/m, 'src/app.ts should have an unstaged edit');
  assert.match(status, /^\?\? notes\.md/m, 'fixture should include an untracked file');
});

test('realistic fixture includes navigation metadata for branches tags remotes and stash', ({ dir }) => {
  assert.match(git(dir, 'branch', '--list'), /feature\/dogfood/);
  assert.match(git(dir, 'tag', '--list'), /v0\.0\.1/);
  assert.match(git(dir, 'remote', '-v'), /example\.invalid\/lazygitvs-dogfood\.git/);
  assert.match(git(dir, 'stash', 'list'), /dogfood stash entry/);
});

test('realistic fixture keeps close JSON replacements as separate zero-context hunks', ({ dir }) => {
  const diff = git(dir, 'diff', '--cached', '--unified=0', '--', 'settings.json');
  const hunkCount = (diff.match(/^@@ /gm) || []).length;
  assert.strictEqual(hunkCount, 2, diff);
});

test('realistic fixture includes renamed deleted and nested-path changes', ({ dir }) => {
  const status = git(dir, 'status', '--short');
  assert.match(status, /^R  docs\/old-name\.md -> docs\/renamed-name\.md/m, 'fixture should include a staged rename');
  assert.match(status, /^ D obsolete\.txt/m, 'fixture should include an unstaged deletion');
  assert.match(status, /^ M src\/features\/nested\/deep-file\.ts/m, 'fixture should include a nested-path edit');
  assert.match(status, /^ M root-file\.txt/m, 'fixture should include a root-level edit beside nested paths');
});

test('realistic fixture can create merge conflict on demand', ({ dir, createConflict }) => {
  createConflict();
  const status = git(dir, 'status', '--short');
  assert.match(status, /^UU conflict\.txt/m);
  assert.match(fs.readFileSync(path.join(dir, 'conflict.txt'), 'utf8'), /<<<<<<< HEAD/);
});

test('multi-root fixture creates two separate repos without nested pollution', () => {
  const workspace = createWorkspaceRepos();
  try {
    assert.match(git(workspace.primary, 'status', '--short'), /^ M primary-only\.txt/m);
    assert.match(git(workspace.secondary, 'status', '--short'), /^ M secondary-only\.txt/m);
    assert.doesNotMatch(git(workspace.primary, 'status', '--short'), /secondary-only\.txt/);
    assert.doesNotMatch(git(workspace.secondary, 'status', '--short'), /primary-only\.txt/);
  } finally {
    cleanupFixture(workspace.root);
  }
});
