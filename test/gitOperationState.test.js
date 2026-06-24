const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { cleanupFixture, git, initRepo } = require('./helpers/gitFixtures');
const { detectGitOperationState } = require('../out/gitOperationState');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function test(name, fn) {
  const dir = initRepo('lgvs-operation-state-');
  try {
    write(path.join(dir, 'file.txt'), 'base\n');
    git(dir, 'add', 'file.txt');
    git(dir, 'commit', '-m', 'base');
    fn(dir);
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stderr || error.stdout || error);
    process.exitCode = 1;
  } finally {
    cleanupFixture(dir);
  }
}

function stateActions(state) {
  return state ? state.actions.map(action => action.command) : [];
}

function createConflictBranches(dir) {
  git(dir, 'checkout', '-b', 'other');
  write(path.join(dir, 'file.txt'), 'other\n');
  git(dir, 'commit', '-am', 'other');
  git(dir, 'checkout', 'master');
  write(path.join(dir, 'file.txt'), 'master\n');
  git(dir, 'commit', '-am', 'master');
}

test('detects no in-progress Git operation in a normal repo', dir => {
  assert.equal(detectGitOperationState(dir), undefined);
});

test('detects merge state and exposes continue/abort actions with confirmation on abort', dir => {
  createConflictBranches(dir);
  try { git(dir, 'merge', 'other'); } catch (_) {}
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'merge');
  assert.equal(state.label, 'Merge in progress');
  assert.deepEqual(stateActions(state), ['continue', 'abort']);
  assert.equal(state.actions.find(action => action.command === 'abort').requiresConfirmation, true);
});

test('detects rebase state and exposes continue/abort/skip actions', dir => {
  createConflictBranches(dir);
  try { git(dir, 'rebase', 'other'); } catch (_) {}
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'rebase');
  assert.equal(state.label, 'Rebase in progress');
  assert.deepEqual(stateActions(state), ['continue', 'abort', 'skip']);
  assert.equal(state.actions.find(action => action.command === 'abort').requiresConfirmation, true);
});

test('detects cherry-pick state and exposes continue/abort/skip actions', dir => {
  createConflictBranches(dir);
  git(dir, 'checkout', 'master');
  try { git(dir, 'cherry-pick', 'other'); } catch (_) {}
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'cherry-pick');
  assert.equal(state.label, 'Cherry-pick in progress');
  assert.deepEqual(stateActions(state), ['continue', 'abort', 'skip']);
  assert.equal(state.actions.find(action => action.command === 'abort').requiresConfirmation, true);
});

test('detects bisect state and exposes good/bad/reset actions with confirmation on reset', dir => {
  write(path.join(dir, 'file.txt'), 'second\n');
  git(dir, 'commit', '-am', 'second');
  git(dir, 'bisect', 'start');
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'bisect');
  assert.equal(state.label, 'Bisect in progress');
  assert.deepEqual(stateActions(state), ['good', 'bad', 'reset']);
  assert.equal(state.actions.find(action => action.command === 'reset').requiresConfirmation, true);
});
