const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const fixupPath = path.join(root, 'out', 'commitFixup.js');
const todoPath = path.join(root, 'out', 'commitRebaseTodo.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(fixupPath), 'Commits Fixup must live in a small compiled commitFixup module.');
assert(fs.existsSync(todoPath), 'Fixup must reuse the shared private rebase-todo utility.');

const {
  FIXUP_MENU_ITEMS,
  FIXUP_MENU_TITLE,
  fixupSelectedCommits,
  rewriteFixupTodo,
} = require(fixupPath);
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
  return fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('lazygitvs-fixup-')).sort();
}

function fixup(dir, visibleHashes, selectedIndex, range = { mode: 'none' }, options = {}) {
  return fixupSelectedCommits({
    repoPath: dir,
    visibleHashes,
    selectedIndex,
    range,
    viewBranch: options.viewBranch,
    chooseAction: options.chooseAction || (async () => options.actionFlag ?? ''),
    onStart: options.onStart,
  });
}

function createLinearFixture(prefix = 'lgvs-fixup-linear-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n', 'shared.txt': 'base\n' });
  const target = commit(dir, 'target', { 'target.txt': 'target\n' });
  const selected = commit(dir, 'selected', { 'selected.txt': 'selected\n' });
  const head = commit(dir, 'head', { 'head.txt': 'head\n' });
  return { dir, base, target, selected, head, visible: [short(dir, head), short(dir, selected), short(dir, target), short(dir, base)] };
}

function createRangeFixture(prefix = 'lgvs-fixup-range-') {
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
  await test('the shared pure rebase-todo transformer emits exact normal and -C fixup directives while preserving everything else byte-for-byte', () => {
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
    const normal = rewriteFixupTodo(todo, ['bbbbbbb']);
    const useSelectedMessage = rewriteFixupTodo(todo, ['bbbbbbb'], '-C');
    assert.equal(normal, todo.replace('pick bbbbbbb selected\n', 'fixup bbbbbbb selected\n'));
    assert.equal(useSelectedMessage, todo.replace('pick bbbbbbb selected\n', 'fixup -C bbbbbbb selected\n'));
    assert.equal(rewriteSelectedPickTodo(todo, ['bbbbbbb'], 'fixup'), normal, 'Fixup must delegate to the shared generic transformer rather than a second editor implementation');
    assert.equal(rewriteSelectedPickTodo(todo, ['bbbbbbb'], 'fixup', '-C'), useSelectedMessage, 'the generic transformer must support only the explicit fixup -C form');
    assert.throws(() => rewriteFixupTodo(todo, ['eeeeeee']), /exactly one|missing/i, 'missing picks must fail closed before todo write');
    assert.throws(() => rewriteFixupTodo(todo, ['bbbbbbb'], '--invalid'), /invalid/i, 'Fixup must fail closed for unknown todo flags');
    assert.throws(() => rewriteFixupTodo(`${todo}pick bbbbbbb duplicate\n`, ['bbbbbbb']), /exactly one|duplicate/i, 'duplicate generated pick rows must fail closed');
    assert.throws(() => rewriteFixupTodo(todo, ['bbbbbbb', 'bbbbbbb']), /duplicate/i, 'duplicate requested hashes must never be coalesced');
    assert.throws(() => rewriteFixupTodo(todo.replace('pick bbbbbbb selected', 'fixup bbbbbbb selected'), ['bbbbbbb']), /exactly one|missing/i, 'only a generated pick directive may be changed');
    assert.throws(() => rewriteSelectedPickTodo(todo, ['bbbbbbb'], 'squash', '-C'), /fixup|flag/i, '-C must not leak into Squash');
    assert.throws(() => rewriteSelectedPickTodo(todo, ['bbbbbbb'], 'drop', '-C'), /fixup|flag/i, '-C must not leak into Drop');
  });

  await test('configured f routes only from top-level Commits, opens the exact upstream Fixup menu, and removes the unused hash-copy placeholder', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitFixup.ts'), 'utf8');
    const shared = fs.readFileSync(path.join(root, 'src', 'commitRebaseTodo.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitFixup'"), 'extension.ts must delegate Fixup to the bounded module');
    assert(config.includes("markCommitAsFixup: 'f'"), 'the default must remain lazygit keybinding.commits.markCommitAsFixup = f');
    assert(extension.includes("key: key(k.markCommitAsFixup) || 'f', label: '$(combine) Fixup selected commit(s)'"), 'Commits Fixup must read configured markCommitAsFixup');
    assert(extension.includes("panel==='commits'&&!${this.commitFilesFor ? 'true' : 'false'}&&hit(e,u.remove,c.squashDown,c.markCommitAsFixup"), 'only the top-level Commits route may promote configured f into Fixup');
    assert(extension.includes('const fixupAction = !!findMenuItemByKey'), 'Fixup must be recognized as a top-level commit action before generic menu execution');
    assert(extension.includes('if ((cherryPickBufferAction || dropAction || squashAction || fixupAction) && this.commitFilesFor) return;'), 'Fixup must not execute from the commit-files subview');
    assert(!extension.includes('c.setFixupMessage'), 'setFixupMessage c must remain a menu choice, not a competing top-level Commits route');
    assert(extension.includes("key: key(k.createFixupCommit) || 'F', label: '$(tools) Create fixup commit'"), 'F/create-fixup must remain separate and unchanged');
    assert(!extension.includes('Mark commit as fixup target'), 'the incorrect hash-copy placeholder label must be removed');
    assert(!extension.includes('copy fixup target') && !extension.includes('fixup target copied'), 'the unused hash-copy result must be removed');
    assert(extension.includes("this.statusLine = 'Fixing up'"), 'the user-visible mutation status must be exactly Fixing up');
    assert(extension.includes('pickGitAction(FIXUP_MENU_TITLE'), 'the explicit Fixup menu choice must be the action without a second confirmation');
    assert(extension.includes("if(panel==='hunks'&&hit(e,u.select,u.togglePanel,u.remove"), 'Hunks must retain their own configured d path');
    assert(extension.includes("if(hit(e,u.remove)){e.preventDefault();vscode.postMessage({type:'discardMenu'});return;}"), 'Files must retain their configured d discard path');
    assert.equal(FIXUP_MENU_TITLE, 'Fixup');
    assert.deepEqual(FIXUP_MENU_ITEMS, [
      {
        key: 'f',
        label: 'Fixup',
        tooltip: 'Meld the selected commit into the commit below it. Similar to squash, but the selected commit\'s message will be discarded.',
        actionFlag: '',
      },
      {
        key: 'c',
        label: 'Fixup and use this commit\'s message',
        tooltip: 'Squash the selected commit into the commit below, using this commit\'s message, discarding the message of the commit below.',
        actionFlag: '-C',
      },
    ]);
    assert(model.includes("FIXUP_MENU_TITLE = 'Fixup'") && model.includes("temporaryDirectoryPrefix: 'lazygitvs-fixup-'"), 'Fixup must stay in its own bounded module and private editor namespace');
    assert(shared.includes("'fixup'") && shared.includes("LGVS_REBASE_TODO_FLAG"), 'the shared editor must explicitly validate and receive a typed Fixup flag');
    assert(shared.includes("cp.execFile('git'"), 'the shared runner must use execFile argv rather than a shell');
    assert.deepEqual(INTERACTIVE_REBASE_ARGS, ['rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges'], 'the bounded interactive rebase argv must stay exact');
    assert(shared.includes("GIT_EDITOR: 'true'") && shared.includes('0o700') && shared.includes("'git-rebase-todo'"), 'Fixup must keep the private noninteractive sequence editor contract');
    assert(readme.includes('partial Commits Fixup parity'), 'README must call Fixup partial, not full parity');
    assert(keybindingAudit.includes('configured `keybinding.commits.markCommitAsFixup`') && keybindingAudit.includes('partial Fixup parity'), 'keybinding audit must document configured f routing and its bounds');
    assert(parity.includes('Bounded partial Fixup slice') && parity.includes('active-rebase todo edits'), 'gap report must preserve the explicit remaining Fixup gaps');
  });

  await test('Fixup normal combines an intermediate ordinary commit, discards its message, starts only after menu selection, and cleans its private editor', async () => {
    const fixture = createLinearFixture('lgvs-fixup-intermediate-');
    const editorsBefore = privateEditorDirectories();
    try {
      let choices = 0;
      let starts = 0;
      const outcome = await fixup(fixture.dir, fixture.visible, 1, { mode: 'none' }, {
        chooseAction: async () => { choices += 1; return ''; },
        onStart: () => { starts += 1; },
      });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.startIndex, 1, 'the controller can restore the prior range start at the new combined target');
      assert.equal(choices, 1, 'the menu action must be chosen exactly once after preflight');
      assert.equal(starts, 1, 'mutation status must begin only after post-menu revalidation');
      assert.deepEqual(git(fixture.dir, 'log', '--format=%s').trim().split('\n'), ['head', 'target', 'base']);
      assert.equal(git(fixture.dir, 'log', '-1', '--skip=1', '--format=%B'), 'target\n\n', 'normal Fixup must retain the target message and discard selected message');
      assert.equal(fs.readFileSync(path.join(fixture.dir, 'selected.txt'), 'utf8'), 'selected\n');
      assert.equal(git(fixture.dir, 'status', '--porcelain=v1'), '');
      assert.deepEqual(privateEditorDirectories(), editorsBefore, 'private GIT_SEQUENCE_EDITOR files must always be deleted');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('Fixup -C uses the selected message, and a HEAD selection keeps its target position', async () => {
    const useSelectedMessage = createLinearFixture('lgvs-fixup-use-selected-message-');
    try {
      const outcome = await fixup(useSelectedMessage.dir, useSelectedMessage.visible, 1, { mode: 'none' }, { actionFlag: '-C' });
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(git(useSelectedMessage.dir, 'log', '--format=%s').trim().split('\n'), ['head', 'selected', 'base']);
      assert.equal(git(useSelectedMessage.dir, 'log', '-1', '--skip=1', '--format=%B'), 'selected\n\n', 'fixup -C must discard the target message in favour of selected message');
    } finally {
      cleanup(useSelectedMessage.dir);
    }

    const headFixture = createLinearFixture('lgvs-fixup-head-');
    try {
      const outcome = await fixup(headFixture.dir, headFixture.visible, 0);
      assert.equal(outcome.kind, 'success');
      assert.equal(git(headFixture.dir, 'log', '-1', '--format=%s').trim(), 'selected', 'fixing up HEAD must leave its immediate parent as the combined commit');
      assert.equal(git(headFixture.dir, 'log', '-1', '--format=%B'), 'selected\n\n');
    } finally {
      cleanup(headFixture.dir);
    }
  });

  await test('Fixup handles a visible multi-range with normal and -C messages and a root target through --root', async () => {
    const normalRange = createRangeFixture('lgvs-fixup-range-normal-');
    try {
      const outcome = await fixup(normalRange.dir, normalRange.visible, 1, { mode: 'sticky', anchor: 2 });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.startIndex, 1);
      assert.deepEqual(git(normalRange.dir, 'log', '--format=%s').trim().split('\n'), ['head', 'target', 'base']);
      assert.equal(git(normalRange.dir, 'log', '-1', '--skip=1', '--format=%B'), 'target\n\n', 'normal range Fixup retains the target message');
    } finally {
      cleanup(normalRange.dir);
    }

    const selectedMessageRange = createRangeFixture('lgvs-fixup-range-c-');
    try {
      const outcome = await fixup(selectedMessageRange.dir, selectedMessageRange.visible, 1, { mode: 'sticky', anchor: 2 }, { actionFlag: '-C' });
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(git(selectedMessageRange.dir, 'log', '--format=%s').trim().split('\n'), ['head', 'newer selected', 'base']);
      assert.equal(git(selectedMessageRange.dir, 'log', '-1', '--skip=1', '--format=%B'), 'newer selected\n\n', 'the final chronological fixup -C selects the newer selected commit message');
    } finally {
      cleanup(selectedMessageRange.dir);
    }

    const rootFixture = initRepo('lgvs-fixup-target-root-');
    try {
      const rootCommit = commit(rootFixture, 'root target', { 'root.txt': 'root\n' });
      const selected = commit(rootFixture, 'selected', { 'selected.txt': 'selected\n' });
      const outcome = await fixup(rootFixture, [short(rootFixture, selected), short(rootFixture, rootCommit)], 0);
      assert.equal(outcome.kind, 'success');
      assert.equal(git(rootFixture, 'log', '-1', '--format=%s').trim(), 'root target');
      assert.equal(git(rootFixture, 'log', '-1', '--format=%B'), 'root target\n\n');
      assert.equal(fs.readFileSync(path.join(rootFixture, 'selected.txt'), 'utf8'), 'selected\n');
    } finally {
      cleanup(rootFixture);
    }
  });

  await test('Fixup rejects selected roots/ranges reaching root and selected merges before opening the menu', async () => {
    const fixture = createLinearFixture('lgvs-fixup-no-target-');
    try {
      const before = snapshot(fixture.dir);
      const root = await fixup(fixture.dir, fixture.visible, fixture.visible.length - 1, { mode: 'none' }, { chooseAction: async () => { throw new Error('root must not open menu'); } });
      assertBlocked(root, 'no-target', /There's no commit below to squash into/i);
      const rangeToRoot = await fixup(fixture.dir, fixture.visible, fixture.visible.length - 1, { mode: 'sticky', anchor: 0 }, { chooseAction: async () => { throw new Error('root range must not open menu'); } });
      assertBlocked(rangeToRoot, 'no-target', /There's no commit below to squash into/i);
      assert.deepEqual(snapshot(fixture.dir), before);
    } finally {
      cleanup(fixture.dir);
    }

    const merge = initRepo('lgvs-fixup-selected-merge-');
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
      const outcome = await fixup(merge, [short(merge, after), short(merge, mergeCommit), short(merge, main), short(merge, base)], 1, { mode: 'none' }, { chooseAction: async () => { throw new Error('merge must not open menu'); } });
      assertBlocked(outcome, 'merge-commit', /Cannot squash or fixup a merge commit/i);
      assert.deepEqual(snapshot(merge), before);
    } finally {
      cleanup(merge);
    }
  });

  await test('Fixup keeps --no-autosquash, handles empty selected commits, and permits rebase.updateRefs', async () => {
    const autosquash = initRepo('lgvs-fixup-subject-');
    try {
      const base = commit(autosquash, 'base', { 'base.txt': 'base\n' });
      const target = commit(autosquash, 'target', { 'target.txt': 'target\n' });
      const bridge = commit(autosquash, 'bridge', { 'bridge.txt': 'bridge\n' });
      const selected = commit(autosquash, 'fixup! target', { 'selected.txt': 'selected\n' });
      const outcome = await fixup(autosquash, [short(autosquash, selected), short(autosquash, bridge), short(autosquash, target), short(autosquash, base)], 0);
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(git(autosquash, 'log', '--format=%s').trim().split('\n'), ['bridge', 'target', 'base'], '--no-autosquash must leave a fixup!-subject immediately below its visible target');
      assert.equal(git(autosquash, 'log', '-1', '--format=%B'), 'bridge\n\n');
      assert.equal(fs.readFileSync(path.join(autosquash, 'selected.txt'), 'utf8'), 'selected\n');
    } finally {
      cleanup(autosquash);
    }

    const empty = initRepo('lgvs-fixup-empty-');
    try {
      const base = commit(empty, 'base', { 'base.txt': 'base\n' });
      const target = commit(empty, 'target', { 'target.txt': 'target\n' });
      const selected = commit(empty, 'empty selected', {}, { allowEmpty: true });
      const head = commit(empty, 'head', { 'head.txt': 'head\n' });
      const outcome = await fixup(empty, [short(empty, head), short(empty, selected), short(empty, target), short(empty, base)], 1);
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(git(empty, 'log', '--format=%s').trim().split('\n'), ['head', 'target', 'base']);
      assert.equal(git(empty, 'log', '-1', '--skip=1', '--format=%B'), 'target\n\n');
    } finally {
      cleanup(empty);
    }

    const refs = createLinearFixture('lgvs-fixup-update-refs-');
    try {
      git(refs.dir, 'config', 'rebase.updateRefs', 'true');
      git(refs.dir, 'branch', 'bookmark-selected', refs.selected);
      const beforeBookmark = git(refs.dir, 'rev-parse', 'bookmark-selected').trim();
      const outcome = await fixup(refs.dir, refs.visible, 1);
      assert.equal(outcome.kind, 'success');
      const afterBookmark = git(refs.dir, 'rev-parse', 'bookmark-selected').trim();
      assert.notEqual(afterBookmark, beforeBookmark, 'Git rebase.updateRefs must be allowed to update refs while Fixup rewrites target history');
      assert.equal(afterBookmark, git(refs.dir, 'rev-parse', 'HEAD^').trim(), 'the bookmark must follow the rewritten combined target');
    } finally {
      cleanup(refs.dir);
    }
  });

  await test('staged, unstaged, and untracked changes each reject Fixup before the menu or mutation', async () => {
    for (const kind of ['staged', 'unstaged', 'untracked']) {
      const fixture = createLinearFixture(`lgvs-fixup-dirty-${kind}-`);
      try {
        if (kind === 'staged') { write(fixture.dir, 'staged.txt', 'staged\n'); git(fixture.dir, 'add', 'staged.txt'); }
        if (kind === 'unstaged') write(fixture.dir, 'shared.txt', 'unstaged\n');
        if (kind === 'untracked') write(fixture.dir, 'untracked.txt', 'untracked\n');
        const before = snapshot(fixture.dir);
        const outcome = await fixup(fixture.dir, fixture.visible, 1, { mode: 'none' }, { chooseAction: async () => { throw new Error(`${kind} changes must not open menu`); } });
        assertBlocked(outcome, 'dirty-worktree');
        assert.deepEqual(snapshot(fixture.dir), before, kind);
      } finally {
        cleanup(fixture.dir);
      }
    }
  });

  await test('real merge, rebase, cherry-pick, and revert operations all block Fixup before the menu', async () => {
    const cases = [
      {
        kind: 'merge',
        create: () => {
          const dir = initRepo('lgvs-fixup-active-merge-');
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
          const dir = initRepo('lgvs-fixup-active-rebase-');
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
          const dir = initRepo('lgvs-fixup-active-cherry-pick-');
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
          const dir = initRepo('lgvs-fixup-active-revert-');
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
        const outcome = await fixup(fixture.dir, [short(fixture.dir, 'HEAD'), short(fixture.dir, 'HEAD^')], 0, { mode: 'none' }, { chooseAction: async () => { throw new Error(`${active.kind} must not open menu`); } });
        assertBlocked(outcome, 'active-operation');
        assert.deepEqual(snapshot(fixture.dir), before, active.kind);
      } finally {
        fixture.abort();
        cleanup(fixture.dir);
      }
    }
  });

  await test('Fixup rejects detached, non-current, and unreachable branch contexts before the menu', async () => {
    const fixture = createLinearFixture('lgvs-fixup-branch-guards-');
    try {
      const branch = git(fixture.dir, 'branch', '--show-current').trim();
      git(fixture.dir, 'checkout', '-b', 'other', fixture.base);
      const other = commit(fixture.dir, 'other', { 'other.txt': 'other\n' });
      git(fixture.dir, 'checkout', branch);
      const before = snapshot(fixture.dir);
      const mismatch = await fixup(fixture.dir, fixture.visible, 1, { mode: 'none' }, { viewBranch: 'other', chooseAction: async () => { throw new Error('mismatched view must not open menu'); } });
      assertBlocked(mismatch, 'branch-mismatch');
      const unreachable = await fixup(fixture.dir, [short(fixture.dir, other), fixture.visible[1], fixture.visible[2]], 0, { mode: 'none' }, { chooseAction: async () => { throw new Error('unreachable hash must not open menu'); } });
      assertBlocked(unreachable, 'unreachable');
      assert.deepEqual(snapshot(fixture.dir), before);
      git(fixture.dir, 'checkout', '--detach');
      const detachedBefore = snapshot(fixture.dir);
      const detached = await fixup(fixture.dir, [short(fixture.dir, 'HEAD'), fixture.visible[1]], 0, { mode: 'none' }, { chooseAction: async () => { throw new Error('detached HEAD must not open menu'); } });
      assertBlocked(detached, 'detached-head');
      assert.deepEqual(snapshot(fixture.dir), detachedBefore);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('menu cancellation and post-menu drift are read-only and do not start Fixup', async () => {
    const cancelled = createLinearFixture('lgvs-fixup-cancel-');
    try {
      const before = snapshot(cancelled.dir);
      const editorsBefore = privateEditorDirectories();
      let starts = 0;
      let choices = 0;
      const outcome = await fixup(cancelled.dir, cancelled.visible, 1, { mode: 'none' }, {
        chooseAction: async () => { choices += 1; return undefined; },
        onStart: () => { starts += 1; },
      });
      assert.equal(outcome.kind, 'cancelled');
      assert.equal(choices, 1, 'valid initial preflight opens exactly one menu');
      assert.equal(starts, 0, 'cancellation must not enter mutation status');
      assert.deepEqual(snapshot(cancelled.dir), before);
      assert.deepEqual(privateEditorDirectories(), editorsBefore);
    } finally {
      cleanup(cancelled.dir);
    }

    const drift = createLinearFixture('lgvs-fixup-drift-');
    try {
      const initialHead = git(drift.dir, 'rev-parse', 'HEAD').trim();
      let starts = 0;
      const outcome = await fixup(drift.dir, drift.visible, 1, { mode: 'none' }, {
        chooseAction: async () => { commit(drift.dir, 'drift', { 'drift.txt': 'drift\n' }); return ''; },
        onStart: () => { starts += 1; },
      });
      assertBlocked(outcome, 'drift', /changed while .*menu/i);
      assert.equal(starts, 0, 'post-menu drift must not enter mutation status');
      assert.notEqual(git(drift.dir, 'rev-parse', 'HEAD').trim(), initialHead, 'the test deliberately moves HEAD while the menu is open');
      assert.equal(detectGitOperationState(drift.dir), undefined, 'drift must not start a rebase');
    } finally {
      cleanup(drift.dir);
    }
  });

  await test('a generated todo exec conflict remains active for Status recovery and real abort restores the exact snapshot', async () => {
    const dir = initRepo('lgvs-fixup-exec-conflict-');
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
      const outcome = await fixup(dir, visible, 0);
      assert.equal(outcome.kind, 'rebase-active');
      assert.match(outcome.message, /Status|rebase|merg/i);
      assert(fs.existsSync(path.join(dir, '.git', 'rebase-merge')), 'the generated exec must leave the real interactive rebase active');
      assert.match(git(dir, 'status', '--porcelain=v1'), /UU shared\.txt/, 'the preserved exec must create a real merge conflict');
      git(dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(dir), before, 'Git rebase --abort must restore the exact pre-Fixup snapshot');
    } finally {
      cleanup(dir);
    }
  });

  await test('a merge target is permitted when Git can safely transform the generated todo', async () => {
    const safe = initRepo('lgvs-fixup-merge-target-safe-');
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
      const outcome = await fixup(safe, [short(safe, selected), short(safe, merge), short(safe, main), short(safe, base)], 0);
      assert.equal(outcome.kind, 'success');
      assert.equal(git(safe, 'log', '-1', '--format=%s').trim(), 'merge side');
      assert.equal(git(safe, 'log', '-1', '--format=%B'), 'merge side\n\n');
    } finally {
      cleanup(safe);
    }
  });

  await test('a non-operation failure audits 0700 editor permissions, cleans up, and surfaces the real Git error', async () => {
    const fixture = createLinearFixture('lgvs-fixup-hook-failure-');
    const privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-fixup-editor-audit-'));
    const audit = path.join(privateTmp, 'editor-audit.txt');
    const previousTmpdir = process.env.TMPDIR;
    const previousAudit = process.env.LGVS_FIXUP_AUDIT;
    try {
      process.env.TMPDIR = privateTmp;
      process.env.LGVS_FIXUP_AUDIT = audit;
      const hook = path.join(fixture.dir, '.git', 'hooks', 'pre-rebase');
      fs.writeFileSync(hook, '#!/bin/sh\nfor d in "$TMPDIR"/lazygitvs-fixup-*; do\n  if [ -d "$d" ]; then stat -c "%a" "$d" > "$LGVS_FIXUP_AUDIT"; stat -c "%a" "$d/sequence-editor" >> "$LGVS_FIXUP_AUDIT"; fi\ndone\necho fixup hook refusal >&2\nexit 17\n', { mode: 0o755 });
      await assert.rejects(() => fixup(fixture.dir, fixture.visible, 1), /fixup hook refusal/i, 'a failed rebase without an in-progress operation must surface the real failure');
      assert.match(fs.readFileSync(audit, 'utf8'), /^700\n700\n?$/, 'the live temporary editor and directory must both be private 0700');
      assert.deepEqual(fs.readdirSync(privateTmp), ['editor-audit.txt'], 'the temporary editor must be deleted after a non-operation rebase failure');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmpdir;
      if (previousAudit === undefined) delete process.env.LGVS_FIXUP_AUDIT; else process.env.LGVS_FIXUP_AUDIT = previousAudit;
      cleanup(privateTmp);
      cleanup(fixture.dir);
    }
  });

  if (!process.exitCode) console.log('commitFixup tests passed');
})();
