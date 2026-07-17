const assert = require('assert');
const cp = require('child_process');
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

function stateActions(state) { return state ? state.actions.map(action => action.command) : []; }
function createConflictBranches(dir) {
  git(dir, 'checkout', '-b', 'other');
  write(path.join(dir, 'file.txt'), 'other\n');
  git(dir, 'commit', '-am', 'other');
  git(dir, 'checkout', 'master');
  write(path.join(dir, 'file.txt'), 'master\n');
  git(dir, 'commit', '-am', 'master');
}
function createRevertConflict(dir) {
  write(path.join(dir, 'file.txt'), 'target\n');
  git(dir, 'commit', '-am', 'target');
  const target = git(dir, 'rev-parse', 'HEAD').trim();
  write(path.join(dir, 'file.txt'), 'later\n');
  git(dir, 'commit', '-am', 'later');
  try { git(dir, 'revert', target); } catch (_) {}
  return target;
}
function resolveAndStage(dir) { write(path.join(dir, 'file.txt'), 'resolved\n'); git(dir, 'add', 'file.txt'); }
function runOperationAction(dir, action) {
  return cp.execFileSync('git', action.args, {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_EDITOR: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

// Real Git conflict fixtures, not marker files: these prove the detector sees
// the same sequencer state that git itself exposes to lazygit.
test('detects no in-progress Git operation in a normal repo', dir => {
  assert.equal(detectGitOperationState(dir), undefined);
});

test('merge Status state uses lazygit lowercase label, exact menu, c/a order, and can continue for real', dir => {
  createConflictBranches(dir);
  try { git(dir, 'merge', 'other'); } catch (_) {}
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'merge');
  assert.equal(state.label, 'merging');
  assert.equal(state.menuTitle, 'Merge options');
  assert.deepEqual(state.actions.map(action => [action.key, action.label]), [['c', 'continue'], ['a', 'abort']]);
  assert.throws(() => runOperationAction(dir, state.actions[0]), /unmerged|conflict|resolved/i, 'continue must not stage conflict resolutions implicitly');
  assert.equal(detectGitOperationState(dir).kind, 'merge', 'a rejected unstaged continue must leave the operation intact');
  resolveAndStage(dir);
  runOperationAction(dir, state.actions[0]);
  assert.equal(detectGitOperationState(dir), undefined, 'merge continue must finish only after explicit staging');
});

test('rebase Status state exposes c/a/s in upstream order and abort is confirmed by the UI layer', dir => {
  createConflictBranches(dir);
  try { git(dir, 'rebase', 'other'); } catch (_) {}
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'rebase');
  assert.equal(state.label, 'rebasing');
  assert.equal(state.menuTitle, 'Rebase options');
  assert.deepEqual(state.actions.map(action => [action.key, action.label]), [['c', 'continue'], ['a', 'abort'], ['s', 'skip']]);
  assert.equal(state.actions[1].requiresConfirmation, true);
  git(dir, ...state.actions[1].args);
  assert.equal(detectGitOperationState(dir), undefined, 'rebase abort must perform the real Git abort');
});

test('cherry-pick Status state exposes c/a/s and keeps bisect out of Status', dir => {
  createConflictBranches(dir);
  try { git(dir, 'cherry-pick', 'other'); } catch (_) {}
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'cherry-pick');
  assert.equal(state.label, 'cherry-picking');
  assert.equal(state.menuTitle, 'Cherry-pick options');
  assert.deepEqual(state.actions.map(action => [action.key, action.label]), [['c', 'continue'], ['a', 'abort'], ['s', 'skip']]);
  git(dir, ...state.actions[1].args);
  write(path.join(dir, 'file.txt'), 'second\n');
  git(dir, 'commit', '-am', 'second');
  git(dir, 'bisect', 'start');
  assert.equal(detectGitOperationState(dir), undefined, 'bisect belongs to lazygit Commits/BisectController, never Status WorkingTreeState');
  git(dir, 'bisect', 'reset');
});

test('revert Status state exposes real c/a/s actions and each clears the real sequencer safely', dir => {
  const target = createRevertConflict(dir);
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'revert');
  assert.equal(state.label, 'reverting');
  assert.equal(state.menuTitle, 'Revert options');
  assert.deepEqual(state.actions.map(action => [action.key, action.label, action.args]), [
    ['c', 'continue', ['revert', '--continue']],
    ['a', 'abort', ['revert', '--abort']],
    ['s', 'skip', ['revert', '--skip']]
  ]);
  assert.equal(state.actions[1].requiresConfirmation, true);
  runOperationAction(dir, state.actions[1]);
  assert.equal(detectGitOperationState(dir), undefined, 'revert abort must clear REVERT_HEAD');

  try { git(dir, 'revert', target); } catch (_) {}
  runOperationAction(dir, detectGitOperationState(dir).actions.find(action => action.command === 'skip'));
  assert.equal(detectGitOperationState(dir), undefined, 'revert skip must advance and clear the real sequencer');

  try { git(dir, 'revert', target); } catch (_) {}
  const continueAction = detectGitOperationState(dir).actions.find(action => action.command === 'continue');
  assert.throws(() => runOperationAction(dir, continueAction), /unmerged|conflict|resolved/i);
  resolveAndStage(dir);
  runOperationAction(dir, continueAction);
  assert.equal(detectGitOperationState(dir), undefined, 'revert continue must finish after explicit conflict resolution');
});

test('rebase state wins over its matching internal CHERRY_PICK_HEAD', dir => {
  createConflictBranches(dir);
  try { git(dir, 'rebase', 'other'); } catch (_) {}
  const gitDir = git(dir, 'rev-parse', '--git-dir').trim();
  const stoppedShaPath = path.join(dir, gitDir, 'rebase-merge', 'stopped-sha');
  const stoppedSha = fs.readFileSync(stoppedShaPath, 'utf8').trim();
  write(path.join(dir, gitDir, 'CHERRY_PICK_HEAD'), `${stoppedSha}\n`);
  assert.equal(detectGitOperationState(dir).kind, 'rebase', 'Git rebase internals must not be misreported as a user cherry-pick');
});

test('rebase skip action advances the real sequencer and clears the operation', dir => {
  createConflictBranches(dir);
  try { git(dir, 'rebase', 'other'); } catch (_) {}
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'rebase');
  runOperationAction(dir, state.actions.find(action => action.command === 'skip'));
  assert.equal(detectGitOperationState(dir), undefined);
});

test('cherry-pick skip action advances the real sequencer and clears the operation', dir => {
  createConflictBranches(dir);
  try { git(dir, 'cherry-pick', 'other'); } catch (_) {}
  const state = detectGitOperationState(dir);
  assert.equal(state.kind, 'cherry-pick');
  runOperationAction(dir, state.actions.find(action => action.command === 'skip'));
  assert.equal(detectGitOperationState(dir), undefined);
});
