const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const squashPath = path.join(root, 'out', 'commitSquash.js');
const todoPath = path.join(root, 'out', 'commitRebaseTodo.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(squashPath), 'Commits Squash-down must live in a small compiled commitSquash module.');
assert(fs.existsSync(todoPath), 'Drop and Squash must share one compiled private rebase-todo utility.');

const {
  SQUASH_COMMIT_PROMPT,
  SQUASH_COMMIT_TITLE,
  rewriteSquashTodo,
  squashSelectedCommits,
} = require(squashPath);
const { INTERACTIVE_REBASE_ARGS, rewriteSelectedPickTodo } = require(todoPath);
const { detectGitOperationState } = require('../out/gitOperationState');

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
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_EDITOR: 'true' },
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

function commit(dir, subject, files, options = {}) {
  for (const [file, content] of Object.entries(files)) write(dir, file, content);
  if (Object.keys(files).length) git(dir, 'add', '.');
  git(dir, 'commit', ...(options.allowEmpty ? ['--allow-empty'] : []), '-m', subject);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

function short(dir, ref) {
  return git(dir, 'rev-parse', '--short', ref).trim();
}

function snapshot(dir, file = 'shared.txt') {
  return {
    branch: git(dir, 'branch', '--show-current').trim(),
    head: git(dir, 'rev-parse', 'HEAD').trim(),
    status: git(dir, 'status', '--porcelain=v1', '--untracked-files=all'),
    log: git(dir, 'log', '--format=%H%x09%s'),
    file: fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : undefined,
  };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function privateEditorDirectories() {
  return fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('lazygitvs-squash-')).sort();
}

function squash(dir, visibleHashes, selectedIndex, range = { mode: 'none' }, options = {}) {
  return squashSelectedCommits({
    repoPath: dir,
    visibleHashes,
    selectedIndex,
    range,
    viewBranch: options.viewBranch,
    confirm: options.confirm || (async () => true),
    onStart: options.onStart,
  });
}

function createLinearFixture(prefix = 'lgvs-squash-linear-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n', 'shared.txt': 'base\n' });
  const target = commit(dir, 'target', { 'target.txt': 'target\n' });
  const selected = commit(dir, 'selected', { 'selected.txt': 'selected\n' });
  const head = commit(dir, 'head', { 'head.txt': 'head\n' });
  return { dir, base, target, selected, head, visible: [short(dir, head), short(dir, selected), short(dir, target), short(dir, base)] };
}

function createRangeFixture(prefix = 'lgvs-squash-range-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n' });
  const target = commit(dir, 'target', { 'target.txt': 'target\n' });
  const olderSelected = commit(dir, 'older selected', { 'older.txt': 'older\n' });
  const newerSelected = commit(dir, 'newer selected', { 'newer.txt': 'newer\n' });
  const head = commit(dir, 'head', { 'head.txt': 'head\n' });
  return { dir, base, target, olderSelected, newerSelected, head, visible: [short(dir, head), short(dir, newerSelected), short(dir, olderSelected), short(dir, target), short(dir, base)] };
}

function assertBlocked(outcome, reason, fragment) {
  assert.equal(outcome.kind, 'blocked');
  assert.equal(outcome.reason, reason);
  if (fragment) assert.match(outcome.message, fragment);
}

(async () => {
  await test('the shared pure rebase-todo transformer changes only selected picks and preserves directives byte-for-byte', () => {
    const todo = [
      '# preserve this comment verbatim\r\n',
      'label onto\n',
      'reset onto\n',
      'pick aaaaaaa target\n',
      'merge -C ccccccc side-merge # preserve merge\n',
      'pick bbbbbbb selected\n',
      'update-ref refs/heads/topic\n',
      'exec git status --short\n',
      'pick ddddddd later\n',
    ].join('');
    const squashTodo = rewriteSelectedPickTodo(todo, ['bbbbbbb'], 'squash');
    const dropTodo = rewriteSelectedPickTodo(todo, ['bbbbbbb'], 'drop');
    assert.equal(squashTodo, todo.replace('pick bbbbbbb selected\n', 'squash bbbbbbb selected\n'));
    assert.equal(dropTodo, todo.replace('pick bbbbbbb selected\n', 'drop bbbbbbb selected\n'));
    assert.equal(rewriteSquashTodo(todo, ['bbbbbbb']), squashTodo, 'Squash must use the shared generic transformer rather than a second editor implementation');
    assert.throws(() => rewriteSelectedPickTodo(todo, ['eeeeeee'], 'squash'), /exactly one|missing/i, 'missing picks must fail closed');
    assert.throws(() => rewriteSelectedPickTodo(`${todo}pick bbbbbbb duplicate\n`, ['bbbbbbb'], 'squash'), /exactly one|duplicate/i, 'duplicate todo picks must fail closed');
    assert.throws(() => rewriteSelectedPickTodo(todo, ['bbbbbbb', 'bbbbbbb'], 'drop'), /duplicate/i, 'duplicate requested hashes must never be coalesced');
    assert.throws(() => rewriteSelectedPickTodo(todo, ['bbbbbbb'], 'squash', '-C'), /fixup|flag/i, 'the Fixup-only -C flag must not change Squash semantics');
    assert.throws(() => rewriteSelectedPickTodo(todo, ['bbbbbbb'], 'drop', '-C'), /fixup|flag/i, 'the Fixup-only -C flag must not change Drop semantics');
    assert.throws(() => rewriteSelectedPickTodo(todo.replace('pick bbbbbbb selected', 'fixup bbbbbbb selected'), ['bbbbbbb'], 'squash'), /exactly one|missing/i, 'only a generated pick directive may be changed');
  });

  await test('configured squashDown routes only from top-level Commits and documents its bounded parity', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitSquash.ts'), 'utf8');
    const shared = fs.readFileSync(path.join(root, 'src', 'commitRebaseTodo.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitSquash'"), 'extension.ts must delegate Squash-down to the bounded module');
    assert(config.includes("squashDown: 's'"), 'the default must remain lazygit keybinding.commits.squashDown = s');
    assert(extension.includes("key: key(k.squashDown) || 's', label: '$(combine) Squash selected commit(s)'"), 'Commits Squash must read keybinding.commits.squashDown');
    assert(extension.includes("panel==='commits'&&!${this.commitFilesFor ? 'true' : 'false'}&&hit(e,u.remove,c.squashDown"), 'only the top-level Commits route may promote configured squashDown into a commit action');
    assert(extension.includes('if ((cherryPickBufferAction || dropAction || squashAction || fixupAction) && this.commitFilesFor) return;'), 'Squash must not execute from the commit-files subview');
    assert(extension.includes("if(panel==='hunks'&&hit(e,u.select,u.togglePanel,u.remove"), 'Hunks must retain their own configured d path');
    assert(extension.includes("if(hit(e,u.remove)){e.preventDefault();vscode.postMessage({type:'discardMenu'});return;}"), 'Files must retain their configured d discard path');
    assert(model.includes("SQUASH_COMMIT_TITLE = 'Squash'") && model.includes("SQUASH_COMMIT_PROMPT = 'Are you sure you want to squash the selected commit(s) into the commit below?'"), 'Squash must retain the upstream title and prompt');
    assert(extension.includes("this.statusLine = 'Squashing'"), 'the user-visible mutation status must say Squashing');
    assert(shared.includes("cp.execFile('git'"), 'the shared runner must use execFile argv rather than a shell');
    assert.deepEqual(INTERACTIVE_REBASE_ARGS, ['rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges'], 'the bounded interactive rebase argv must stay exact');
    assert(!shared.includes('--empty=keep'), 'InteractiveRebase parity must not invent --empty=keep');
    assert(shared.includes("GIT_EDITOR: 'true'") && shared.includes("LC_ALL: 'C'"), 'the shared runner must accept Git default squash messages without a terminal and use a stable locale');
    assert(shared.includes('0o700') && shared.includes("'git-rebase-todo'"), 'the one private editor must be 0700 and only edit Git generated todos');
    assert(readme.includes('partial Commits Squash-down parity'), 'README must call Squash-down partial, not full parity');
    assert(keybindingAudit.includes('configured `keybinding.commits.squashDown`') && keybindingAudit.includes('partial Squash-down parity'), 'keybinding audit must state configured s routing and bounds');
    assert(parity.includes('Bounded partial Squash-down slice') && parity.includes('active-rebase todo edits'), 'parity report must preserve the explicit remaining gaps');
  });

  await test('Squash combines an intermediate ordinary commit with Git default messages and cleans its private editor', async () => {
    const fixture = createLinearFixture('lgvs-squash-intermediate-');
    const editorsBefore = privateEditorDirectories();
    try {
      const prompts = [];
      const outcome = await squash(fixture.dir, fixture.visible, 1, { mode: 'none' }, {
        confirm: async (title, prompt) => { prompts.push({ title, prompt }); return true; },
      });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.startIndex, 1, 'the controller can restore the prior range start at the new combined commit');
      assert.deepEqual(prompts, [{ title: SQUASH_COMMIT_TITLE, prompt: SQUASH_COMMIT_PROMPT }]);
      assert.deepEqual(git(fixture.dir, 'log', '--format=%s').trim().split('\n'), ['head', 'target', 'base']);
      assert.equal(git(fixture.dir, 'log', '-1', '--skip=1', '--format=%B'), 'target\n\nselected\n\n', 'GIT_EDITOR=true must keep Git default combined squash messages');
      assert.equal(git(fixture.dir, 'status', '--porcelain=v1'), '');
      assert.deepEqual(privateEditorDirectories(), editorsBefore, 'private GIT_SEQUENCE_EDITOR files must always be deleted');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('Squash handles HEAD, a visible multi-range, and a target root through --root', async () => {
    const headFixture = createLinearFixture('lgvs-squash-head-');
    try {
      const outcome = await squash(headFixture.dir, headFixture.visible, 0);
      assert.equal(outcome.kind, 'success');
      assert.equal(git(headFixture.dir, 'log', '-1', '--format=%s').trim(), 'selected', 'squashing HEAD must retain its immediate parent as the combined commit');
      assert.equal(git(headFixture.dir, 'log', '-1', '--format=%B'), 'selected\n\nhead\n\n');
    } finally {
      cleanup(headFixture.dir);
    }

    const rangeFixture = createRangeFixture();
    try {
      const outcome = await squash(rangeFixture.dir, rangeFixture.visible, 1, { mode: 'sticky', anchor: 2 });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.startIndex, 1);
      assert.deepEqual(git(rangeFixture.dir, 'log', '--format=%s').trim().split('\n'), ['head', 'target', 'base']);
      assert.equal(git(rangeFixture.dir, 'log', '-1', '--skip=1', '--format=%B'), 'target\n\nolder selected\n\nnewer selected\n\n');
    } finally {
      cleanup(rangeFixture.dir);
    }

    const rootFixture = initRepo('lgvs-squash-target-root-');
    try {
      const rootCommit = commit(rootFixture, 'root target', { 'root.txt': 'root\n' });
      const selected = commit(rootFixture, 'selected', { 'selected.txt': 'selected\n' });
      const outcome = await squash(rootFixture, [short(rootFixture, selected), short(rootFixture, rootCommit)], 0);
      assert.equal(outcome.kind, 'success');
      assert.equal(git(rootFixture, 'log', '-1', '--format=%s').trim(), 'root target');
      assert.equal(git(rootFixture, 'log', '-1', '--format=%B'), 'root target\n\nselected\n\n');
      assert.equal(fs.readFileSync(path.join(rootFixture, 'root.txt'), 'utf8'), 'root\n');
      assert.equal(fs.readFileSync(path.join(rootFixture, 'selected.txt'), 'utf8'), 'selected\n');
    } finally {
      cleanup(rootFixture);
    }
  });

  await test('Squash rejects selected roots/ranges reaching root and selected merges before confirmation', async () => {
    const fixture = createLinearFixture('lgvs-squash-no-target-');
    try {
      const before = snapshot(fixture.dir);
      const root = await squash(fixture.dir, fixture.visible, fixture.visible.length - 1, { mode: 'none' }, { confirm: async () => { throw new Error('root must not prompt'); } });
      assertBlocked(root, 'no-target', /There's no commit below to squash into/i);
      const rangeToRoot = await squash(fixture.dir, fixture.visible, fixture.visible.length - 1, { mode: 'sticky', anchor: 0 }, { confirm: async () => { throw new Error('root range must not prompt'); } });
      assertBlocked(rangeToRoot, 'no-target', /There's no commit below to squash into/i);
      assert.deepEqual(snapshot(fixture.dir), before);
    } finally {
      cleanup(fixture.dir);
    }

    const merge = initRepo('lgvs-squash-selected-merge-');
    try {
      const base = commit(merge, 'base', { 'shared.txt': 'base\n' });
      const branch = git(merge, 'branch', '--show-current').trim();
      git(merge, 'checkout', '-b', 'side');
      commit(merge, 'side', { 'side.txt': 'side\n' });
      git(merge, 'checkout', branch);
      const main = commit(merge, 'main', { 'main.txt': 'main\n' });
      git(merge, 'merge', '--no-ff', 'side', '-m', 'merge side');
      const mergeCommit = git(merge, 'rev-parse', 'HEAD').trim();
      const after = commit(merge, 'after', { 'after.txt': 'after\n' });
      const before = snapshot(merge);
      const outcome = await squash(merge, [short(merge, after), short(merge, mergeCommit), short(merge, main), short(merge, base)], 1, { mode: 'none' }, { confirm: async () => { throw new Error('merge must not prompt'); } });
      assertBlocked(outcome, 'merge-commit', /Cannot squash or fixup a merge commit/i);
      assert.deepEqual(snapshot(merge), before);
    } finally {
      cleanup(merge);
    }
  });

  await test('Squash does not autosquash fixup subjects, retains an empty selected commit, and preserves updateRefs', async () => {
    const fixup = initRepo('lgvs-squash-fixup-subject-');
    try {
      const base = commit(fixup, 'base', { 'base.txt': 'base\n' });
      const target = commit(fixup, 'target', { 'target.txt': 'target\n' });
      const bridge = commit(fixup, 'bridge', { 'bridge.txt': 'bridge\n' });
      const selected = commit(fixup, 'fixup! target', { 'selected.txt': 'selected\n' });
      const outcome = await squash(fixup, [short(fixup, selected), short(fixup, bridge), short(fixup, target), short(fixup, base)], 0);
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(git(fixup, 'log', '--format=%s').trim().split('\n'), ['bridge', 'target', 'base'], '--no-autosquash must leave the fixup!-subject immediately below the selected row rather than moving it to its named target');
      assert.equal(git(fixup, 'log', '-1', '--format=%B'), 'bridge\n\n', 'GIT_EDITOR=true must accept Git default combined message behavior for a fixup!-subject without invoking autosquash');
      assert.equal(fs.readFileSync(path.join(fixup, 'selected.txt'), 'utf8'), 'selected\n', 'the selected fixup!-subject tree change must still be squashed');
    } finally {
      cleanup(fixup);
    }

    const empty = initRepo('lgvs-squash-empty-');
    try {
      const base = commit(empty, 'base', { 'base.txt': 'base\n' });
      const target = commit(empty, 'target', { 'target.txt': 'target\n' });
      const selected = commit(empty, 'empty selected', {}, { allowEmpty: true });
      const head = commit(empty, 'head', { 'head.txt': 'head\n' });
      const outcome = await squash(empty, [short(empty, head), short(empty, selected), short(empty, target), short(empty, base)], 1);
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(git(empty, 'log', '--format=%s').trim().split('\n'), ['head', 'target', 'base']);
      assert.equal(git(empty, 'log', '-1', '--skip=1', '--format=%B'), 'target\n\nempty selected\n\n');
    } finally {
      cleanup(empty);
    }

    const refs = createLinearFixture('lgvs-squash-update-refs-');
    try {
      git(refs.dir, 'config', 'rebase.updateRefs', 'true');
      git(refs.dir, 'branch', 'bookmark-selected', refs.selected);
      const beforeBookmark = git(refs.dir, 'rev-parse', 'bookmark-selected').trim();
      const outcome = await squash(refs.dir, refs.visible, 1);
      assert.equal(outcome.kind, 'success');
      const afterBookmark = git(refs.dir, 'rev-parse', 'bookmark-selected').trim();
      assert.notEqual(afterBookmark, beforeBookmark, 'Git rebase.updateRefs must be allowed to update refs while squash rewrites target history');
      assert.equal(afterBookmark, git(refs.dir, 'rev-parse', 'HEAD^').trim(), 'the bookmark must follow the rewritten combined target');
    } finally {
      cleanup(refs.dir);
    }
  });

  await test('staged, unstaged, and untracked changes each reject Squash without a modal or mutation', async () => {
    for (const kind of ['staged', 'unstaged', 'untracked']) {
      const fixture = createLinearFixture(`lgvs-squash-dirty-${kind}-`);
      try {
        if (kind === 'staged') { write(fixture.dir, 'staged.txt', 'staged\n'); git(fixture.dir, 'add', 'staged.txt'); }
        if (kind === 'unstaged') write(fixture.dir, 'shared.txt', 'unstaged\n');
        if (kind === 'untracked') write(fixture.dir, 'untracked.txt', 'untracked\n');
        const before = snapshot(fixture.dir);
        const outcome = await squash(fixture.dir, fixture.visible, 1, { mode: 'none' }, { confirm: async () => { throw new Error(`${kind} changes must not prompt`); } });
        assertBlocked(outcome, 'dirty-worktree');
        assert.deepEqual(snapshot(fixture.dir), before, kind);
      } finally {
        cleanup(fixture.dir);
      }
    }
  });

  await test('real merge, rebase, cherry-pick, and revert operations all block Squash before confirmation', async () => {
    const cases = [
      {
        kind: 'merge',
        create: () => {
          const dir = initRepo('lgvs-squash-active-merge-');
          commit(dir, 'base', { 'shared.txt': 'base\n' });
          const branch = git(dir, 'branch', '--show-current').trim();
          git(dir, 'checkout', '-b', 'side'); commit(dir, 'side', { 'shared.txt': 'side\n' });
          git(dir, 'checkout', branch); commit(dir, 'current', { 'shared.txt': 'current\n' });
          try { git(dir, 'merge', 'side'); } catch (_) {}
          return { dir, abort: () => git(dir, 'merge', '--abort') };
        },
      },
      {
        kind: 'rebase',
        create: () => {
          const dir = initRepo('lgvs-squash-active-rebase-');
          commit(dir, 'base', { 'shared.txt': 'base\n' });
          const branch = git(dir, 'branch', '--show-current').trim();
          git(dir, 'checkout', '-b', 'side'); commit(dir, 'side', { 'shared.txt': 'side\n' });
          git(dir, 'checkout', branch); commit(dir, 'current', { 'shared.txt': 'current\n' });
          try { git(dir, 'rebase', 'side'); } catch (_) {}
          return { dir, abort: () => git(dir, 'rebase', '--abort') };
        },
      },
      {
        kind: 'cherry-pick',
        create: () => {
          const dir = initRepo('lgvs-squash-active-cherry-pick-');
          commit(dir, 'base', { 'shared.txt': 'base\n' });
          const branch = git(dir, 'branch', '--show-current').trim();
          git(dir, 'checkout', '-b', 'side'); const side = commit(dir, 'side', { 'shared.txt': 'side\n' });
          git(dir, 'checkout', branch); commit(dir, 'current', { 'shared.txt': 'current\n' });
          try { git(dir, 'cherry-pick', side); } catch (_) {}
          return { dir, abort: () => git(dir, 'cherry-pick', '--abort') };
        },
      },
      {
        kind: 'revert',
        create: () => {
          const dir = initRepo('lgvs-squash-active-revert-');
          commit(dir, 'base', { 'shared.txt': 'one\ntwo\n' });
          const selected = commit(dir, 'selected', { 'shared.txt': 'one\nselected\n' });
          commit(dir, 'current', { 'shared.txt': 'one\ncurrent\n' });
          try { git(dir, 'revert', selected); } catch (_) {}
          return { dir, abort: () => git(dir, 'revert', '--abort') };
        },
      },
    ];
    for (const active of cases) {
      const fixture = active.create();
      try {
        assert.equal(detectGitOperationState(fixture.dir).kind, active.kind, `${active.kind} fixture must create a real in-progress operation`);
        const before = snapshot(fixture.dir);
        const outcome = await squash(fixture.dir, [short(fixture.dir, 'HEAD'), short(fixture.dir, 'HEAD^')], 0, { mode: 'none' }, { confirm: async () => { throw new Error(`${active.kind} must not prompt`); } });
        assertBlocked(outcome, 'active-operation');
        assert.deepEqual(snapshot(fixture.dir), before, active.kind);
      } finally {
        fixture.abort();
        cleanup(fixture.dir);
      }
    }
  });

  await test('Squash rejects detached, non-current, and unreachable branch contexts before confirmation', async () => {
    const fixture = createLinearFixture('lgvs-squash-branch-guards-');
    try {
      const branch = git(fixture.dir, 'branch', '--show-current').trim();
      git(fixture.dir, 'checkout', '-b', 'other', fixture.base);
      const other = commit(fixture.dir, 'other', { 'other.txt': 'other\n' });
      git(fixture.dir, 'checkout', branch);
      const before = snapshot(fixture.dir);
      const mismatch = await squash(fixture.dir, fixture.visible, 1, { mode: 'none' }, { viewBranch: 'other', confirm: async () => { throw new Error('mismatched view must not prompt'); } });
      assertBlocked(mismatch, 'branch-mismatch');
      const unreachable = await squash(fixture.dir, [short(fixture.dir, other), fixture.visible[1], fixture.visible[2]], 0, { mode: 'none' }, { confirm: async () => { throw new Error('unreachable hash must not prompt'); } });
      assertBlocked(unreachable, 'unreachable');
      assert.deepEqual(snapshot(fixture.dir), before);
      git(fixture.dir, 'checkout', '--detach');
      const detachedBefore = snapshot(fixture.dir);
      const detached = await squash(fixture.dir, [short(fixture.dir, 'HEAD'), fixture.visible[1]], 0, { mode: 'none' }, { confirm: async () => { throw new Error('detached HEAD must not prompt'); } });
      assertBlocked(detached, 'detached-head');
      assert.deepEqual(snapshot(fixture.dir), detachedBefore);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('cancellation and post-confirmation drift do not start a Squash rebase', async () => {
    const cancelled = createLinearFixture('lgvs-squash-cancel-');
    try {
      const before = snapshot(cancelled.dir);
      const editorsBefore = privateEditorDirectories();
      const prompts = [];
      let starts = 0;
      const outcome = await squash(cancelled.dir, cancelled.visible, 1, { mode: 'none' }, { confirm: async (title, prompt) => { prompts.push({ title, prompt }); return false; }, onStart: () => { starts += 1; } });
      assert.equal(outcome.kind, 'cancelled');
      assert.equal(starts, 0, 'cancellation must not enter mutation status');
      assert.deepEqual(prompts, [{ title: SQUASH_COMMIT_TITLE, prompt: SQUASH_COMMIT_PROMPT }]);
      assert.deepEqual(snapshot(cancelled.dir), before);
      assert.deepEqual(privateEditorDirectories(), editorsBefore);
    } finally {
      cleanup(cancelled.dir);
    }

    const started = createLinearFixture('lgvs-squash-start-status-');
    try {
      let starts = 0;
      const outcome = await squash(started.dir, started.visible, 1, { mode: 'none' }, { onStart: () => { starts += 1; } });
      assert.equal(outcome.kind, 'success');
      assert.equal(starts, 1, 'mutation status must start exactly once after confirmation and revalidation');
    } finally {
      cleanup(started.dir);
    }

    const drift = createLinearFixture('lgvs-squash-drift-');
    try {
      const initialHead = git(drift.dir, 'rev-parse', 'HEAD').trim();
      const outcome = await squash(drift.dir, drift.visible, 1, { mode: 'none' }, { confirm: async () => { commit(drift.dir, 'drift', { 'drift.txt': 'drift\n' }); return true; } });
      assertBlocked(outcome, 'drift', /changed while confirmation/i);
      assert.notEqual(git(drift.dir, 'rev-parse', 'HEAD').trim(), initialHead, 'the test deliberately moves HEAD during the modal');
      assert.equal(detectGitOperationState(drift.dir), undefined, 'drift must not start a rebase');
    } finally {
      cleanup(drift.dir);
    }
  });

  await test('a generated todo exec conflict remains active for Status recovery and real abort restores the exact snapshot', async () => {
    const dir = initRepo('lgvs-squash-exec-conflict-');
    try {
      const base = commit(dir, 'base', { 'shared.txt': 'base\n' });
      const branch = git(dir, 'branch', '--show-current').trim();
      git(dir, 'checkout', '-b', 'conflict-side');
      commit(dir, 'side', { 'shared.txt': 'side\n' });
      git(dir, 'checkout', branch);
      const target = commit(dir, 'target', { 'shared.txt': 'target\n' });
      const selected = commit(dir, 'selected', { 'selected.txt': 'selected\n' });
      git(dir, 'config', 'rebase.instructionFormat', '%s%nexec git merge conflict-side');
      const visible = [short(dir, selected), short(dir, target), short(dir, base)];
      const before = snapshot(dir);
      const outcome = await squash(dir, visible, 0);
      assert.equal(outcome.kind, 'rebase-active');
      assert.match(outcome.message, /Status|rebase|merg/i);
      assert(fs.existsSync(path.join(dir, '.git', 'rebase-merge')), 'the generated exec must leave the real interactive rebase active');
      assert.match(git(dir, 'status', '--porcelain=v1'), /UU shared\.txt/, 'the preserved exec must create a real merge conflict');
      git(dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(dir), before, 'Git rebase --abort must restore the exact pre-Squash snapshot');
    } finally {
      cleanup(dir);
    }
  });

  await test('a target merge is permitted when Git can safely transform the generated todo', async () => {
    const safe = initRepo('lgvs-squash-merge-target-safe-');
    try {
      const base = commit(safe, 'base', { 'base.txt': 'base\n' });
      const branch = git(safe, 'branch', '--show-current').trim();
      git(safe, 'checkout', '-b', 'side');
      commit(safe, 'side', { 'side.txt': 'side\n' });
      git(safe, 'checkout', branch);
      const main = commit(safe, 'main', { 'main.txt': 'main\n' });
      git(safe, 'merge', '--no-ff', 'side', '-m', 'merge side');
      const merge = git(safe, 'rev-parse', 'HEAD').trim();
      const selected = commit(safe, 'selected', { 'selected.txt': 'selected\n' });
      const outcome = await squash(safe, [short(safe, selected), short(safe, merge), short(safe, main), short(safe, base)], 0);
      assert.equal(outcome.kind, 'success');
      assert.equal(git(safe, 'log', '-1', '--format=%s').trim(), 'merge side');
      assert.equal(git(safe, 'log', '-1', '--format=%B'), 'merge side\n\nselected\n\n');
    } finally {
      cleanup(safe);
    }
  });

  await test('a non-operation failure audits 0700 editor permissions and always cleans it up', async () => {
    const fixture = createLinearFixture('lgvs-squash-hook-failure-');
    const privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-squash-editor-audit-'));
    const audit = path.join(privateTmp, 'editor-audit.txt');
    const previousTmpdir = process.env.TMPDIR;
    const previousAudit = process.env.LGVS_SQUASH_AUDIT;
    try {
      process.env.TMPDIR = privateTmp;
      process.env.LGVS_SQUASH_AUDIT = audit;
      const hook = path.join(fixture.dir, '.git', 'hooks', 'pre-rebase');
      fs.writeFileSync(hook, '#!/bin/sh\nfor d in "$TMPDIR"/lazygitvs-squash-*; do\n  if [ -d "$d" ]; then stat -c "%a" "$d" > "$LGVS_SQUASH_AUDIT"; stat -c "%a" "$d/sequence-editor" >> "$LGVS_SQUASH_AUDIT"; fi\ndone\necho squash hook refusal >&2\nexit 17\n', { mode: 0o755 });
      await assert.rejects(() => squash(fixture.dir, fixture.visible, 1), /squash hook refusal/i, 'a failed rebase without an operation must surface the real Git error');
      assert.match(fs.readFileSync(audit, 'utf8'), /^700\n700\n?$/, 'the live temporary editor and directory must both be private 0700');
      assert.deepEqual(fs.readdirSync(privateTmp), ['editor-audit.txt'], 'the temporary editor must be deleted after a non-operation rebase failure');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmpdir;
      if (previousAudit === undefined) delete process.env.LGVS_SQUASH_AUDIT; else process.env.LGVS_SQUASH_AUDIT = previousAudit;
      cleanup(privateTmp);
      cleanup(fixture.dir);
    }
  });

  if (!process.exitCode) console.log('commitSquash tests passed');
})();
