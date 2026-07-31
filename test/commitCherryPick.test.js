const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitCherryPick.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const rowsPath = path.join(root, 'src', 'panelRows.ts');
const readmePath = path.join(root, 'README.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Commits cherry-pick range parity needs one compiled commitCherryPick model module.');

const {
  CHERRY_PICK_TITLE,
  EMPTY_CHERRY_PICK_BUFFER,
  EMPTY_COMMIT_RANGE,
  cherryPickArgs,
  cherryPickPrompt,
  commitRangeBounds,
  extendNonStickyCommitRange,
  findCommitIndexByHash,
  hasVisibleCopiedCommit,
  moveCommitSelection,
  pasteCopiedCommits,
  resetCherryPickBuffer,
  toggleCopiedCommitRange,
  toggleStickyCommitRange
} = require(modulePath);

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch(error => {
      console.error(`not ok - ${name}`);
      console.error(error && (error.stderr || error.stdout || error.stack || error));
      process.exitCode = 1;
    });
}

function git(cwd, ...args) {
  return cp.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function write(dir, file, content) {
  const target = path.join(dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function initRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'lgvs@example.test');
  git(dir, 'config', 'user.name', 'LazyGitVS Test');
  return dir;
}

function commit(dir, subject, files) {
  for (const [file, content] of Object.entries(files)) write(dir, file, content);
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', subject);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

function snapshot(dir) {
  return {
    head: git(dir, 'rev-parse', 'HEAD').trim(),
    status: git(dir, 'status', '--porcelain'),
    log: git(dir, 'log', '--format=%H%x09%s', '--max-count=8')
  };
}

function createSequenceFixture(prefix) {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'sequence.txt': 'base\n' });
  git(dir, 'checkout', '-b', 'source');
  const first = commit(dir, 'source one', { 'sequence.txt': 'one\n' });
  const second = commit(dir, 'source two', { 'sequence.txt': 'two\n' });
  git(dir, 'checkout', '-b', 'target', base);
  const targetSelection = commit(dir, 'target anchor', { 'target.txt': 'anchor\n' });
  return { dir, base, first, second, targetSelection };
}

function sourceBuffer(repoPath, hashes, listContext = 'branch:source') {
  return { sourceRepoPath: repoPath, sourceListContext: listContext, hashes: [...hashes], didPaste: false };
}

function recordingGit(calls) {
  return async (args, cwd) => {
    calls.push({ args: [...args], cwd });
    return git(cwd, ...args);
  };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
  await test('Commits range state mirrors sticky v, non-sticky Shift navigation, reverse ranges, and normal movement', () => {
    let range = toggleStickyCommitRange(EMPTY_COMMIT_RANGE, 3);
    assert.deepEqual(range, { mode: 'sticky', anchor: 3 }, 'v starts a sticky range at the current commit');

    let moved = moveCommitSelection(range, 3, -2, 7);
    assert.equal(moved.selected, 1);
    assert.deepEqual(moved.range, { mode: 'sticky', anchor: 3 }, 'normal movement extends a sticky range');
    assert.deepEqual(commitRangeBounds(moved.range, moved.selected, 7), [1, 3], 'range bounds are order-independent');

    moved = extendNonStickyCommitRange(moved.range, moved.selected, 1, 7);
    assert.equal(moved.selected, 2);
    assert.deepEqual(moved.range, { mode: 'nonsticky', anchor: 3 }, 'Shift+Down changes the visual range to non-sticky without changing its anchor');

    moved = moveCommitSelection(moved.range, moved.selected, 1, 7);
    assert.equal(moved.selected, 3);
    assert.deepEqual(moved.range, EMPTY_COMMIT_RANGE, 'normal movement clears only a non-sticky range');

    range = extendNonStickyCommitRange(EMPTY_COMMIT_RANGE, 4, -2, 7).range;
    assert.deepEqual(commitRangeBounds(range, 2, 7), [2, 4], 'Shift+Up creates a reverse non-sticky range');
    assert.deepEqual(toggleStickyCommitRange(range, 2), EMPTY_COMMIT_RANGE, 'v cancels an active non-sticky range');
  });

  await test('C toggles complete ranges, de-duplicates hashes in current newest-first order, and keeps range state separate', () => {
    const hashes = ['newest', 'middle', 'oldest'];
    const range = { mode: 'sticky', anchor: 2 };
    let buffer = toggleCopiedCommitRange(EMPTY_CHERRY_PICK_BUFFER, {
      repoPath: '/repo/a',
      listContext: 'branch:source',
      newestFirstHashes: hashes,
      range,
      selectedIndex: 0
    });
    assert.deepEqual(buffer.hashes, hashes, 'C copies a reverse selected range in the rendered newest-first order');
    assert.equal(buffer.sourceRepoPath, '/repo/a');
    assert.equal(buffer.sourceListContext, 'branch:source');
    assert.deepEqual(range, { mode: 'sticky', anchor: 2 }, 'copying does not clear the visual selection range');

    buffer = toggleCopiedCommitRange(buffer, {
      repoPath: '/repo/a',
      listContext: 'branch:source',
      newestFirstHashes: hashes,
      range,
      selectedIndex: 0
    });
    assert.deepEqual(buffer.hashes, [], 'C over an already-copied complete range removes that range');

    buffer = toggleCopiedCommitRange(sourceBuffer('/repo/a', ['middle']), {
      repoPath: '/repo/a',
      listContext: 'branch:source',
      newestFirstHashes: hashes,
      range: { mode: 'nonsticky', anchor: 2 },
      selectedIndex: 1
    });
    assert.deepEqual(buffer.hashes, ['middle', 'oldest'], 'partial C adds only missing hashes and reorders by the current newest-first list');
    assert.deepEqual(cherryPickArgs(buffer), ['cherry-pick', 'oldest', 'middle'], 'V always reverses the copied newest-first buffer into oldest-first Git argv');

    const pasted = { ...buffer, didPaste: true };
    assert.equal(hasVisibleCopiedCommit(pasted, { repoPath: '/repo/a', listContext: 'branch:source', hash: 'middle' }), false, 'didPaste hides copied-row visual mode without discarding the reusable buffer');
    const removedAfterPaste = toggleCopiedCommitRange(pasted, { repoPath: '/repo/a', listContext: 'branch:source', newestFirstHashes: hashes, range: { mode: 'nonsticky', anchor: 2 }, selectedIndex: 1 });
    assert.deepEqual(removedAfterPaste.hashes, [], 'didPaste is visual-only: C still removes a complete copied range after a successful V');
    assert.equal(removedAfterPaste.didPaste, false, 'the next C restores copied visual mode semantics');
    const changedListContext = toggleCopiedCommitRange(sourceBuffer('/repo/a', ['middle']), { repoPath: '/repo/a', listContext: 'local', newestFirstHashes: hashes, range: EMPTY_COMMIT_RANGE, selectedIndex: 0 });
    assert.deepEqual(changedListContext.hashes, ['newest'], 'C starts a fresh buffer when the source list context changes');
    assert.equal(changedListContext.sourceListContext, 'local');
    assert.deepEqual(resetCherryPickBuffer(), EMPTY_CHERRY_PICK_BUFFER, 'reset returns an empty buffer model');
  });

  await test('source routing includes configured C/V/reset, the partial visual state, and honest documentation', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const rows = fs.readFileSync(rowsPath, 'utf8');
    const modelSource = fs.readFileSync(path.join(root, 'src', 'commitCherryPick.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitCherryPick'"), 'extension.ts must delegate range/buffer/argv decisions to the small Commits model module');
    assert(extension.includes('private cherryPickBuffer'), 'the controller must retain source-aware copied-commit buffer state');
    assert(!extension.includes('cherryPickCommitHashes'), 'the old hash-only buffer must not bypass source/context isolation');
    assert(config.includes("resetCherryPick: '<ctrl+r>'"), 'the lazygit default resetCherryPick binding must remain ctrl+r');
    assert(extension.includes('c.resetCherryPick'), 'the Commits webview router must dispatch the configured resetCherryPick key');
    assert(extension.includes('Reset copied (cherry-picked) commits selection'), 'the Commits catalog must expose reset without a Git mutation');
    assert(modelSource.includes("CHERRY_PICK_TITLE = 'Cherry-pick'") && modelSource.includes('cherryPickPrompt'), 'V must use the canonical Cherry-pick title and exact confirmation wording');
    assert(extension.includes('pasteCopiedCommits'), 'V must use the isolated preflight/paste path instead of direct inline Git argv');
    assert(extension.includes('findCommitIndexByHash'), 'successful V must restore the target selection by hash after refresh');
    assert(rows.includes('commitRow(sel: boolean, commit: Commit, index: number, klass = \'\')'), 'commit rows need an independent range/copied visual class hook');
    assert(readme.includes('partial Commits cherry-pick range parity'), 'README must state that the C/V/reset slice is partial parity');
    assert(parity.includes('Bounded partial C/V/reset cherry-pick slice') && parity.includes('Full upstream cherry-pick parity remains open'), 'the parity ledger prose must record the bounded slice without claiming the full Commits gap is closed');
    assert(parity.includes('auto-stash') && parity.includes('merge commits'), 'deferred dirty-worktree and merge-commit behavior must stay explicit in parity docs');
  });

  await test('real Git V cherry-picks one copied commit, confirms with the exact prompt, and preserves the copied buffer as didPaste', async () => {
    const fixture = createSequenceFixture('lgvs-cherry-single-');
    try {
      const calls = [];
      const buffer = sourceBuffer(fixture.dir, [fixture.first]);
      const prompts = [];
      const outcome = await pasteCopiedCommits({
        buffer,
        targetRepoPath: fixture.dir,
        runGit: recordingGit(calls),
        confirm: async (title, prompt) => { prompts.push({ title, prompt }); return true; }
      });
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(prompts, [{ title: CHERRY_PICK_TITLE, prompt: 'Are you sure you want to cherry-pick the 1 copied commit(s) onto this branch?' }]);
      assert.deepEqual(calls.filter(call => call.args[0] === 'cherry-pick'), [{ args: ['cherry-pick', fixture.first], cwd: fixture.dir }]);
      assert.equal(fs.readFileSync(path.join(fixture.dir, 'sequence.txt'), 'utf8'), 'one\n');
      assert.deepEqual(outcome.buffer.hashes, [fixture.first], 'successful paste keeps the copied buffer reusable');
      assert.equal(outcome.buffer.didPaste, true, 'successful paste hides copied visual state only');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('real Git V applies a multi-commit newest-first buffer oldest-first and restores the prior target selection by hash', async () => {
    const fixture = createSequenceFixture('lgvs-cherry-multi-');
    try {
      const calls = [];
      const buffer = sourceBuffer(fixture.dir, [fixture.second, fixture.first]);
      const outcome = await pasteCopiedCommits({
        buffer,
        targetRepoPath: fixture.dir,
        runGit: recordingGit(calls),
        confirm: async () => true
      });
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(calls.filter(call => call.args[0] === 'cherry-pick'), [{ args: ['cherry-pick', fixture.first, fixture.second], cwd: fixture.dir }], 'a newest-first buffer must become one oldest-first cherry-pick argv');
      assert.equal(fs.readFileSync(path.join(fixture.dir, 'sequence.txt'), 'utf8'), 'two\n', 'the second source change proves Git applied the first change before it');
      const afterHashes = git(fixture.dir, 'log', '--format=%H').trim().split('\n');
      assert.equal(findCommitIndexByHash(afterHashes, fixture.targetSelection, 0), 2, 'after paste the pre-existing target commit remains selected by hash, not a stale row index');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('configured reset model and cancelled V leave a real repository and buffer unchanged', async () => {
    const fixture = createSequenceFixture('lgvs-cherry-cancel-');
    try {
      const buffer = sourceBuffer(fixture.dir, [fixture.first]);
      const beforeReset = snapshot(fixture.dir);
      const reset = resetCherryPickBuffer();
      assert.deepEqual(reset, EMPTY_CHERRY_PICK_BUFFER, 'ctrl+r clears only copied-buffer state');
      assert.deepEqual(snapshot(fixture.dir), beforeReset, 'ctrl+r does not mutate Git');

      const calls = [];
      const beforeCancel = snapshot(fixture.dir);
      const outcome = await pasteCopiedCommits({
        buffer,
        targetRepoPath: fixture.dir,
        runGit: recordingGit(calls),
        confirm: async () => false
      });
      assert.equal(outcome.kind, 'cancelled');
      assert.deepEqual(outcome.buffer, buffer, 'cancel keeps copied hashes and source context reusable');
      assert.deepEqual(snapshot(fixture.dir), beforeCancel, 'cancelling V leaves real Git state untouched');
      assert.equal(calls.some(call => call.args[0] === 'cherry-pick'), false, 'cancel never invokes git cherry-pick');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('dirty working trees and merge commits are clearly rejected before real Git mutation', async () => {
    const dirty = createSequenceFixture('lgvs-cherry-dirty-');
    try {
      write(dirty.dir, 'dirty.txt', 'not clean\n');
      const calls = [];
      const before = snapshot(dirty.dir);
      const outcome = await pasteCopiedCommits({
        buffer: sourceBuffer(dirty.dir, [dirty.first]),
        targetRepoPath: dirty.dir,
        runGit: recordingGit(calls),
        confirm: async () => { throw new Error('dirty preflight must reject before confirmation'); }
      });
      assert.equal(outcome.kind, 'dirty-worktree');
      assert.match(outcome.message, /clean working tree/i);
      assert.deepEqual(snapshot(dirty.dir), before);
      assert.equal(calls.some(call => call.args[0] === 'cherry-pick'), false);
    } finally {
      cleanup(dirty.dir);
    }

    const merge = initRepo('lgvs-cherry-merge-');
    try {
      const base = commit(merge, 'base', { 'merge.txt': 'base\n' });
      git(merge, 'checkout', '-b', 'side');
      const side = commit(merge, 'side change', { 'side.txt': 'side\n' });
      git(merge, 'checkout', 'master');
      git(merge, 'merge', '--no-ff', 'side', '-m', 'merge side');
      const mergeHash = git(merge, 'rev-parse', 'HEAD').trim();
      git(merge, 'checkout', '-b', 'target', base);
      assert.equal(git(merge, 'rev-list', '--parents', '-n', '1', mergeHash).trim().split(/\s+/).length, 3, 'fixture must contain a real two-parent merge commit');
      assert.equal(side.length, 40);

      const calls = [];
      const before = snapshot(merge);
      const outcome = await pasteCopiedCommits({
        buffer: sourceBuffer(merge, [mergeHash]),
        targetRepoPath: merge,
        runGit: recordingGit(calls),
        confirm: async () => { throw new Error('merge preflight must reject before confirmation'); }
      });
      assert.equal(outcome.kind, 'merge-commit');
      assert.match(outcome.message, /merge commits/i);
      assert.deepEqual(snapshot(merge), before);
      assert.equal(calls.some(call => call.args[0] === 'cherry-pick'), false);
    } finally {
      cleanup(merge);
    }
  });

  await test('a real cherry-pick conflict retains the original buffer, and another repository cannot receive it', async () => {
    const conflict = initRepo('lgvs-cherry-conflict-');
    try {
      const base = commit(conflict, 'base', { 'conflict.txt': 'base\n' });
      git(conflict, 'checkout', '-b', 'source');
      const source = commit(conflict, 'source change', { 'conflict.txt': 'source\n' });
      git(conflict, 'checkout', '-b', 'target', base);
      commit(conflict, 'target change', { 'conflict.txt': 'target\n' });
      const buffer = sourceBuffer(conflict, [source]);
      const calls = [];
      await assert.rejects(
        () => pasteCopiedCommits({
          buffer,
          targetRepoPath: conflict,
          runGit: recordingGit(calls),
          confirm: async () => true
        }),
        /conflict/i
      );
      assert.deepEqual(buffer, sourceBuffer(conflict, [source]), 'failed/conflicted V must not clear or mark the copied buffer pasted');
      assert.match(git(conflict, 'status', '--porcelain'), /UU conflict\.txt/, 'the real Git conflict remains available for existing Status operation handling');
      assert.equal(calls.filter(call => call.args[0] === 'cherry-pick').length, 1);
    } finally {
      cleanup(conflict);
    }

    const sourceRepo = createSequenceFixture('lgvs-cherry-source-isolation-');
    const otherRepo = createSequenceFixture('lgvs-cherry-other-isolation-');
    try {
      const before = snapshot(otherRepo.dir);
      const outcome = await pasteCopiedCommits({
        buffer: sourceBuffer(sourceRepo.dir, [sourceRepo.first]),
        targetRepoPath: otherRepo.dir,
        runGit: async () => { throw new Error('a cross-repository buffer must be rejected before Git is called'); },
        confirm: async () => { throw new Error('a cross-repository buffer must be rejected before confirmation'); }
      });
      assert.equal(outcome.kind, 'source-mismatch');
      assert.deepEqual(outcome.buffer, EMPTY_CHERRY_PICK_BUFFER, 'repository mismatch clears the unsafe copied buffer');
      assert.deepEqual(snapshot(otherRepo.dir), before, 'a copied buffer from another real repository cannot mutate this target repository');
    } finally {
      cleanup(sourceRepo.dir);
      cleanup(otherRepo.dir);
    }
  });

  if (!process.exitCode) console.log('commitCherryPick tests passed');
})();
