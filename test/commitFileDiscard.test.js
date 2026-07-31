const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitFileDiscard.js');
const todoPath = path.join(root, 'out', 'commitRebaseTodo.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const securityPath = path.join(root, 'src', 'webviewSecurity.ts');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Commit-files discard must live in a small compiled commitFileDiscard module.');

const {
  COMMIT_FILE_DISCARD_PROMPT,
  COMMIT_FILE_DISCARD_TITLE,
  discardCommitFileChanges,
  normaliseCommitFileDiscardPaths,
} = require(modulePath);
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
    env: { ...process.env, GIT_EDITOR: 'true', LC_ALL: 'C' },
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
  git(dir, 'add', '-A');
  git(dir, 'commit', ...(options.allowEmpty ? ['--allow-empty'] : []), '-m', subject);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

function short(dir, ref) {
  return git(dir, 'rev-parse', '--short', ref).trim();
}

function file(pathValue, status = 'M', oldPath) {
  return oldPath === undefined ? { status, path: pathValue } : { status, path: pathValue, oldPath };
}

function fileRow(item) {
  return { kind: 'file', path: item.path, label: item.path, depth: 0, file: item };
}

function directoryRow(pathValue) {
  return { kind: 'dir', path: pathValue, label: pathValue, depth: 0, collapsed: false };
}

function snapshot(dir) {
  return {
    branch: git(dir, 'branch', '--show-current').trim(),
    head: git(dir, 'rev-parse', 'HEAD').trim(),
    tree: git(dir, 'rev-parse', 'HEAD^{tree}').trim(),
    status: git(dir, 'status', '--porcelain=v1', '--untracked-files=all'),
    cached: git(dir, 'diff', '--cached', '--binary'),
    working: git(dir, 'diff', '--binary'),
    log: git(dir, 'log', '--format=%H%x09%P%x09%s'),
    refs: git(dir, 'show-ref'),
  };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function privateEditorDirectories() {
  return fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('lazygitvs-commit-file-discard-')).sort();
}

function discard(dir, commitHash, commitFiles, row, options = {}) {
  return discardCommitFileChanges({
    repoPath: dir,
    commitHash,
    commitFiles,
    row,
    rangeMode: options.rangeMode || 'none',
    isLocalCommits: options.isLocalCommits !== false,
    confirm: options.confirm || (async () => true),
    onStart: options.onStart,
    validateContext: options.validateContext,
    canMutate: options.canMutate,
  });
}

function commitHashForSubject(dir, subject) {
  const match = git(dir, 'log', '--format=%H%x09%s').split('\n').map(line => line.split('\t')).find(([, value]) => value === subject);
  assert(match, `expected rewritten ${subject} commit`);
  return match[0];
}

function assertBlocked(outcome, reason, fragment) {
  assert.equal(outcome.kind, 'blocked');
  assert.equal(outcome.reason, reason);
  if (fragment) assert.match(outcome.message, fragment);
}

function linearFixture(prefix = 'lgvs-commit-file-discard-linear-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'changed.txt': 'parent\n', 'keep.txt': 'base\n' });
  const selected = commit(dir, 'selected', { 'changed.txt': 'selected\n', 'keep.txt': 'base\n' });
  const head = commit(dir, 'head', { 'changed.txt': 'selected\n', 'keep.txt': 'head\n' });
  return { dir, base, selected, head };
}

function activeOperationFixture(kind) {
  const dir = initRepo(`lgvs-commit-file-discard-active-${kind}-`);
  if (kind === 'merge' || kind === 'rebase' || kind === 'cherry-pick') {
    commit(dir, 'base', { 'shared.txt': 'base\n' });
    const branch = git(dir, 'branch', '--show-current').trim();
    git(dir, 'checkout', '-b', 'side');
    const side = commit(dir, 'side', { 'shared.txt': 'side\n' });
    git(dir, 'checkout', branch);
    commit(dir, 'current', { 'shared.txt': 'current\n' });
    try {
      if (kind === 'merge') git(dir, 'merge', 'side');
      if (kind === 'rebase') git(dir, 'rebase', 'side');
      if (kind === 'cherry-pick') git(dir, 'cherry-pick', side);
    } catch (_) {}
    return { dir, abort: () => git(dir, kind, '--abort') };
  }
  commit(dir, 'base', { 'shared.txt': 'one\ntwo\n' });
  const selected = commit(dir, 'selected', { 'shared.txt': 'one\nselected\n' });
  commit(dir, 'current', { 'shared.txt': 'one\ncurrent\n' });
  try { git(dir, 'revert', selected); } catch (_) {}
  return { dir, abort: () => git(dir, 'revert', '--abort') };
}

(async () => {
  await test('source routing reserves configured universal.remove for Commit-files d and documents its bounded parity', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const controller = fs.readFileSync(path.join(root, 'src', 'commitFilesController.ts'), 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitFileDiscard.ts'), 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const security = fs.readFileSync(securityPath, 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');
    const shared = fs.readFileSync(path.join(root, 'src', 'commitRebaseTodo.ts'), 'utf8');

    assert(extension.includes("from './commitFilesController'") && controller.includes("from './commitFileDiscard'"), 'the authoritative controller must delegate Commit-files history rewriting to the bounded module');
    assert(config.includes("remove: 'd'"), 'lazygit universal.remove must retain d by default');
    assert(extension.includes("panel==='commits'&&${this.commitFilesController.commit ? 'true' : 'false'}&&hit(e,u.remove)"), 'only the Commit-files webview route may post the dedicated discard message');
    assert(extension.includes("vscode.postMessage({type:'discardCommitFile'})"), 'Commit-files d must not be promoted through top-level commitAction');
    assert(extension.includes('private async discardCurrentCommitFile()'), 'controller must own a bounded Commit-files discard completion path');
    assert(extension.includes('isLocalCommits: !this.commitListForBranch'), 'branch-scoped commit views must never be treated as LocalCommits');
    assert(extension.includes("this.statusLine = 'Rebasing'"), 'the status must say exactly Rebasing only after model preflight/confirmation');
    assert(extension.includes("if (this.statusLine === 'Rebasing') this.statusLine = ''"), 'a failed rebase start with no active operation must clear the transient Rebasing status');
    assert(extension.includes('this.commitFilesController.invalidate()'), 'success must exit stale Commit-files drilldown through the authoritative controller');
    assert(extension.includes("await this.restorePanelFocusAfterModal('commits', () => this.commitFilesController.active);"), 'success/failure must restore Commit-files/Commits focus');
    assert(security.includes("'discardCommitFile'"), 'webview message validation must allow only the dedicated Commit-files discard message');
    assert(model.includes("COMMIT_FILE_DISCARD_TITLE = 'Discard file changes'"), 'upstream title must be exact');
    assert(model.includes("COMMIT_FILE_DISCARD_PROMPT = 'Are you sure you want to discard changes to the selected file(s) from this commit?\\n\\nThis action will start a rebase, reverting these file changes. Be aware that if subsequent commits depend on these changes, you may need to resolve conflicts.'"), 'upstream confirmation body must be exact');
    assert(model.includes("action: 'edit'") && model.includes('keepEmpty: false') && model.includes("temporaryDirectoryPrefix: 'lazygitvs-commit-file-discard-'"), 'only the selected todo pick may become typed edit through the private shared runner, without preserving descendants made empty');
    assert(model.includes("['checkout', 'HEAD^', '--', filePath]") && model.includes("['rm', '--ignore-unmatch', '--', filePath]"), 'path rollback must use exact argv without shell interpolation');
    assert(model.includes("['commit', '--amend', '--no-edit', '--allow-empty', '--allow-empty-message']") && model.includes("['rebase', '--continue']"), 'the edit must amend an allowed empty commit and continue noninteractively');
    assert(shared.includes("action !== 'drop' && action !== 'squash' && action !== 'fixup' && action !== 'edit'"), 'the shared editor must add only the typed edit directive');
    assert.deepEqual(INTERACTIVE_REBASE_ARGS, ['rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges'], 'the private editor must keep the existing explicit interactive rebase argv');
    assert(readme.includes('partial Commit-files discard parity'), 'README must call this a partial Commit-files history-rewrite slice');
    assert(keybindingAudit.includes('configured `universal.remove`') && keybindingAudit.includes('Commit-files discard'), 'keybinding audit must state d routing and scope');
    assert(parity.includes('Bounded partial Commit-files discard slice') && parity.includes('active-rebase todo editing'), 'gap report must preserve the explicit bounded gaps');
  });

  await test('normalization expands a directory only to literal contained Commit-files rows and edit todos remain fail-closed', () => {
    const selected = [file('dir/a.txt'), file('dir/b.txt', 'A'), file('directory/not-selected.txt'), file('dirish/nope.txt')];
    assert.deepEqual(normaliseCommitFileDiscardPaths(directoryRow('dir'), selected), ['dir/a.txt', 'dir/b.txt']);
    assert.deepEqual(normaliseCommitFileDiscardPaths(fileRow(selected[0]), selected), ['dir/a.txt']);
    assert.deepEqual(normaliseCommitFileDiscardPaths(directoryRow('missing'), selected), []);
    const todo = 'pick aaaaaaa base\npick bbbbbbb selected\npick ccccccc later\n# untouched\n';
    assert.equal(rewriteSelectedPickTodo(todo, ['bbbbbbb'], 'edit'), todo.replace('pick bbbbbbb selected', 'edit bbbbbbb selected'));
    assert.throws(() => rewriteSelectedPickTodo(todo, ['ddddddd'], 'edit'), /exactly one|missing/i);
    assert.throws(() => rewriteSelectedPickTodo(`${todo}pick bbbbbbb duplicate\n`, ['bbbbbbb'], 'edit'), /exactly one|duplicate/i);
  });

  await test('discarding a middle modified file restores its parent contents, starts after confirmation, and leaves a clean rewritten history', async () => {
    const fixture = linearFixture('lgvs-commit-file-discard-middle-');
    const editorsBefore = privateEditorDirectories();
    try {
      const prompts = [];
      let starts = 0;
      const outcome = await discard(fixture.dir, short(fixture.dir, fixture.selected), [file('changed.txt')], fileRow(file('changed.txt')), {
        confirm: async (title, prompt) => { prompts.push({ title, prompt }); return true; },
        onStart: () => { starts += 1; },
      });
      assert.equal(outcome.kind, 'success');
      assert.equal(starts, 1, 'Rebasing status callback starts once after confirmed revalidation');
      assert.deepEqual(prompts, [{ title: COMMIT_FILE_DISCARD_TITLE, prompt: COMMIT_FILE_DISCARD_PROMPT }]);
      const rewritten = commitHashForSubject(fixture.dir, 'selected');
      assert.equal(git(fixture.dir, 'show', `${rewritten}:changed.txt`), 'parent\n', 'the selected commit must now contain its parent version');
      assert.equal(fs.readFileSync(path.join(fixture.dir, 'keep.txt'), 'utf8'), 'head\n', 'subsequent independent changes must be replayed');
      assert.equal(git(fixture.dir, 'status', '--porcelain=v1', '--untracked-files=all'), '');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
      assert.deepEqual(privateEditorDirectories(), editorsBefore, 'private sequence editor directory must be cleaned after success');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('discarding an added file makes it absent while retaining an intentionally empty rewritten commit', async () => {
    const dir = initRepo('lgvs-commit-file-discard-added-');
    try {
      const base = commit(dir, 'base', { 'base.txt': 'base\n' });
      const selected = commit(dir, 'selected only adds', { 'base.txt': 'base\n', 'added.txt': 'added\n' });
      commit(dir, 'head', { 'base.txt': 'base\n', 'added.txt': 'added\n', 'head.txt': 'head\n' });
      const outcome = await discard(dir, short(dir, selected), [file('added.txt', 'A')], fileRow(file('added.txt', 'A')));
      assert.equal(outcome.kind, 'success');
      const rewritten = commitHashForSubject(dir, 'selected only adds');
      assert.throws(() => git(dir, 'show', `${rewritten}:added.txt`), /does not exist|exists on disk|path/i, 'new selected file must be removed from the amended commit');
      assert.equal(git(dir, 'show', `${rewritten}:base.txt`), 'base\n');
      assert.equal(git(dir, 'log', '--format=%s').trim().split('\n').filter(subject => subject === 'selected only adds').length, 1, '--allow-empty must preserve the selected commit as an empty commit');
      assert.equal(fs.existsSync(path.join(dir, 'added.txt')), false);
      assert.equal(fs.readFileSync(path.join(dir, 'head.txt'), 'utf8'), 'head\n');
      assert.equal(base.length, 40);
    } finally {
      cleanup(dir);
    }
  });

  await test('discarding a selected directory restores/deletes every literal contained file and never touches similarly prefixed paths', async () => {
    const dir = initRepo('lgvs-commit-file-discard-directory-');
    try {
      commit(dir, 'base', { 'dir/a.txt': 'parent\n', 'directory/keep.txt': 'keep\n' });
      const selected = commit(dir, 'selected directory', { 'dir/a.txt': 'selected\n', 'dir/b.txt': 'added\n', 'directory/keep.txt': 'keep\n' });
      commit(dir, 'head', { 'dir/a.txt': 'selected\n', 'dir/b.txt': 'added\n', 'directory/keep.txt': 'head keep\n', 'head.txt': 'head\n' });
      const rows = [file('dir/a.txt'), file('dir/b.txt', 'A'), file('directory/keep.txt')];
      const outcome = await discard(dir, short(dir, selected), rows, directoryRow('dir'));
      assert.equal(outcome.kind, 'success');
      const rewritten = commitHashForSubject(dir, 'selected directory');
      assert.equal(git(dir, 'show', `${rewritten}:dir/a.txt`), 'parent\n');
      assert.throws(() => git(dir, 'show', `${rewritten}:dir/b.txt`), /does not exist|path/i);
      assert.equal(fs.readFileSync(path.join(dir, 'directory', 'keep.txt'), 'utf8'), 'head keep\n');
      assert.equal(fs.existsSync(path.join(dir, 'dir', 'b.txt')), false);
    } finally {
      cleanup(dir);
    }
  });

  await test('a root selected commit uses --root, removes its selected path, and replays descendants', async () => {
    const dir = initRepo('lgvs-commit-file-discard-root-');
    try {
      const rootCommit = commit(dir, 'root', { 'root.txt': 'root\n' });
      commit(dir, 'child', { 'root.txt': 'root\n', 'child.txt': 'child\n' });
      const outcome = await discard(dir, short(dir, rootCommit), [file('root.txt', 'A')], fileRow(file('root.txt', 'A')));
      assert.equal(outcome.kind, 'success');
      const rewrittenRoot = commitHashForSubject(dir, 'root');
      assert.throws(() => git(dir, 'show', `${rewrittenRoot}:root.txt`), /does not exist|path/i);
      assert.equal(fs.existsSync(path.join(dir, 'root.txt')), false);
      assert.equal(fs.readFileSync(path.join(dir, 'child.txt'), 'utf8'), 'child\n');
      assert.equal(git(dir, 'status', '--porcelain=v1'), '');
    } finally {
      cleanup(dir);
    }
  });

  await test('a dependent later change leaves a real rebase active and git rebase --abort restores the exact snapshot', async () => {
    const dir = initRepo('lgvs-commit-file-discard-conflict-');
    try {
      commit(dir, 'base', { 'shared.txt': 'one\ntwo\n' });
      const selected = commit(dir, 'selected', { 'shared.txt': 'one\nselected\n' });
      commit(dir, 'dependent', { 'shared.txt': 'one\ndependent\n' });
      const before = snapshot(dir);
      const outcome = await discard(dir, short(dir, selected), [file('shared.txt')], fileRow(file('shared.txt')));
      assert.equal(outcome.kind, 'rebase-active');
      assert.match(outcome.message, /Status|rebase/i);
      assert.equal(detectGitOperationState(dir).kind, 'rebase', 'the controller must preserve the operation for Status recovery');
      assert.match(git(dir, 'status', '--porcelain=v1'), /UU shared\.txt/);
      git(dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(dir), before, 'real Git abort must restore the complete captured repository snapshot');
    } finally {
      cleanup(dir);
    }
  });

  await test('cancellation, post-confirmation dirty drift, and post-confirmation HEAD drift are read-only and never start Rebasing', async () => {
    const cancelled = linearFixture('lgvs-commit-file-discard-cancel-');
    try {
      const before = snapshot(cancelled.dir);
      let starts = 0;
      const outcome = await discard(cancelled.dir, short(cancelled.dir, cancelled.selected), [file('changed.txt')], fileRow(file('changed.txt')), {
        confirm: async () => false,
        onStart: () => { starts += 1; },
      });
      assert.equal(outcome.kind, 'cancelled');
      assert.equal(starts, 0);
      assert.deepEqual(snapshot(cancelled.dir), before);
    } finally {
      cleanup(cancelled.dir);
    }

    const dirty = linearFixture('lgvs-commit-file-discard-post-confirm-dirty-');
    try {
      let starts = 0;
      const outcome = await discard(dirty.dir, short(dirty.dir, dirty.selected), [file('changed.txt')], fileRow(file('changed.txt')), {
        confirm: async () => { write(dirty.dir, 'late-untracked.txt', 'late\n'); return true; },
        onStart: () => { starts += 1; },
      });
      assertBlocked(outcome, 'dirty-worktree');
      assert.equal(starts, 0);
      assert.equal(detectGitOperationState(dirty.dir), undefined);
      assert.match(git(dirty.dir, 'status', '--porcelain=v1', '--untracked-files=all'), /\?\? late-untracked\.txt/);
    } finally {
      cleanup(dirty.dir);
    }

    const drift = linearFixture('lgvs-commit-file-discard-post-confirm-head-');
    try {
      const initialHead = git(drift.dir, 'rev-parse', 'HEAD').trim();
      let starts = 0;
      const outcome = await discard(drift.dir, short(drift.dir, drift.selected), [file('changed.txt')], fileRow(file('changed.txt')), {
        confirm: async () => { commit(drift.dir, 'drift', { 'drift.txt': 'drift\n' }); return true; },
        onStart: () => { starts += 1; },
      });
      assertBlocked(outcome, 'drift', /changed while confirmation/i);
      assert.equal(starts, 0);
      assert.notEqual(git(drift.dir, 'rev-parse', 'HEAD').trim(), initialHead);
      assert.equal(detectGitOperationState(drift.dir), undefined);
    } finally {
      cleanup(drift.dir);
    }

    const boundaryDrift = linearFixture('lgvs-commit-file-discard-mutation-boundary-');
    try {
      git(boundaryDrift.dir, 'branch', 'same-head');
      let starts = 0;
      const outcome = await discard(boundaryDrift.dir, short(boundaryDrift.dir, boundaryDrift.selected), [file('changed.txt')], fileRow(file('changed.txt')), {
        canMutate: () => { git(boundaryDrift.dir, 'checkout', 'same-head'); return true; },
        onStart: () => { starts += 1; },
      });
      assertBlocked(outcome, 'drift', /mutation boundary/i);
      assert.equal(starts, 0);
      assert.equal(git(boundaryDrift.dir, 'branch', '--show-current').trim(), 'same-head');
      assert.equal(detectGitOperationState(boundaryDrift.dir), undefined);
    } finally {
      cleanup(boundaryDrift.dir);
    }
  });

  await test('staged, unstaged, and untracked trees and every active Git operation block before confirmation', async () => {
    for (const kind of ['staged', 'unstaged', 'untracked']) {
      const fixture = linearFixture(`lgvs-commit-file-discard-dirty-${kind}-`);
      try {
        if (kind === 'staged') { write(fixture.dir, 'staged.txt', 'staged\n'); git(fixture.dir, 'add', 'staged.txt'); }
        if (kind === 'unstaged') write(fixture.dir, 'changed.txt', 'dirty\n');
        if (kind === 'untracked') write(fixture.dir, 'untracked.txt', 'untracked\n');
        const before = snapshot(fixture.dir);
        const outcome = await discard(fixture.dir, short(fixture.dir, fixture.selected), [file('changed.txt')], fileRow(file('changed.txt')), { confirm: async () => { throw new Error(`${kind} must not prompt`); } });
        assertBlocked(outcome, 'dirty-worktree');
        assert.deepEqual(snapshot(fixture.dir), before);
      } finally {
        cleanup(fixture.dir);
      }
    }

    for (const kind of ['merge', 'rebase', 'cherry-pick', 'revert']) {
      const fixture = activeOperationFixture(kind);
      try {
        assert.equal(detectGitOperationState(fixture.dir).kind, kind, `${kind} fixture must be active`);
        const outcome = await discard(fixture.dir, short(fixture.dir, 'HEAD'), [file('shared.txt')], fileRow(file('shared.txt')), { confirm: async () => { throw new Error(`${kind} must not prompt`); } });
        assertBlocked(outcome, 'active-operation');
      } finally {
        fixture.abort();
        cleanup(fixture.dir);
      }
    }
  });

  await test('non-local/range/detached/unreachable/merge/GPG/path/symlink/submodule/rename guards fail closed before confirmation', async () => {
    const local = linearFixture('lgvs-commit-file-discard-guards-');
    try {
      const target = short(local.dir, local.selected);
      assertBlocked(await discard(local.dir, target, [file('changed.txt')], fileRow(file('changed.txt')), { isLocalCommits: false, confirm: async () => { throw new Error('branch view must not prompt'); } }), 'not-local-commits');
      assertBlocked(await discard(local.dir, target, [file('changed.txt')], fileRow(file('changed.txt')), { rangeMode: 'sticky', confirm: async () => { throw new Error('range must not prompt'); } }), 'multiple-commits');
      for (const unsafe of ['', '.', '../escape.txt', 'dir/../escape.txt', '/tmp/escape.txt', ':(top)', 'glob*.txt']) {
        const outcome = await discard(local.dir, target, [file(unsafe, 'A')], fileRow(file(unsafe, 'A')), { confirm: async () => { throw new Error(`${unsafe} must not prompt`); } });
        assertBlocked(outcome, 'invalid-path');
      }
      assertBlocked(await discard(local.dir, target, [], directoryRow('missing'), { confirm: async () => { throw new Error('empty directory must not prompt'); } }), 'empty-selection');

      git(local.dir, 'checkout', '--detach');
      assertBlocked(await discard(local.dir, short(local.dir, 'HEAD'), [file('changed.txt')], fileRow(file('changed.txt')), { confirm: async () => { throw new Error('detached must not prompt'); } }), 'detached-head');
    } finally {
      cleanup(local.dir);
    }

    const unreachable = linearFixture('lgvs-commit-file-discard-unreachable-');
    try {
      const branch = git(unreachable.dir, 'branch', '--show-current').trim();
      git(unreachable.dir, 'checkout', '-b', 'other', unreachable.base);
      const other = commit(unreachable.dir, 'other', { 'other.txt': 'other\n' });
      git(unreachable.dir, 'checkout', branch);
      assertBlocked(await discard(unreachable.dir, short(unreachable.dir, other), [file('other.txt', 'A')], fileRow(file('other.txt', 'A')), { confirm: async () => { throw new Error('unreachable must not prompt'); } }), 'unreachable');
    } finally {
      cleanup(unreachable.dir);
    }

    const merge = initRepo('lgvs-commit-file-discard-merge-');
    try {
      commit(merge, 'base', { 'shared.txt': 'base\n' });
      const branch = git(merge, 'branch', '--show-current').trim();
      git(merge, 'checkout', '-b', 'side');
      commit(merge, 'side', { 'side.txt': 'side\n' });
      git(merge, 'checkout', branch);
      commit(merge, 'main', { 'main.txt': 'main\n' });
      git(merge, 'merge', '--no-ff', 'side', '-m', 'merge side');
      const mergeCommit = git(merge, 'rev-parse', 'HEAD').trim();
      assertBlocked(await discard(merge, short(merge, mergeCommit), [file('side.txt', 'A')], fileRow(file('side.txt', 'A')), { confirm: async () => { throw new Error('merge must not prompt'); } }), 'merge-commit');
    } finally {
      cleanup(merge);
    }

    const gpg = linearFixture('lgvs-commit-file-discard-gpg-');
    try {
      git(gpg.dir, 'config', 'commit.gpgSign', 'true');
      assertBlocked(await discard(gpg.dir, short(gpg.dir, gpg.selected), [file('changed.txt')], fileRow(file('changed.txt')), { confirm: async () => { throw new Error('GPG signing must not prompt'); } }), 'gpg-signing');
    } finally {
      cleanup(gpg.dir);
    }

    const symlink = initRepo('lgvs-commit-file-discard-symlink-');
    try {
      commit(symlink, 'base', { 'target.txt': 'target\n' });
      fs.symlinkSync('target.txt', path.join(symlink, 'link.txt'));
      git(symlink, 'add', 'link.txt');
      git(symlink, 'commit', '-m', 'symlink');
      const selected = git(symlink, 'rev-parse', 'HEAD').trim();
      assertBlocked(await discard(symlink, short(symlink, selected), [file('link.txt', 'A')], fileRow(file('link.txt', 'A')), { confirm: async () => { throw new Error('symlink must not prompt'); } }), 'unsupported-entry');
    } finally {
      cleanup(symlink);
    }

    const submodule = initRepo('lgvs-commit-file-discard-submodule-');
    const child = initRepo('lgvs-commit-file-discard-submodule-child-');
    try {
      commit(child, 'child', { 'child.txt': 'child\n' });
      commit(submodule, 'base', { 'base.txt': 'base\n' });
      git(submodule, '-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'submodule');
      git(submodule, 'commit', '-m', 'gitlink');
      const selected = git(submodule, 'rev-parse', 'HEAD').trim();
      assertBlocked(await discard(submodule, short(submodule, selected), [file('submodule', 'A')], fileRow(file('submodule', 'A')), { confirm: async () => { throw new Error('submodule must not prompt'); } }), 'unsupported-entry');
    } finally {
      cleanup(submodule);
      cleanup(child);
    }

    const renamed = initRepo('lgvs-commit-file-discard-rename-');
    try {
      commit(renamed, 'base', { 'old.txt': 'old\n' });
      git(renamed, 'mv', 'old.txt', 'new.txt');
      git(renamed, 'commit', '-m', 'rename');
      const selected = git(renamed, 'rev-parse', 'HEAD').trim();
      assertBlocked(await discard(renamed, short(renamed, selected), [file('new.txt', 'R100', 'old.txt')], fileRow(file('new.txt', 'R100', 'old.txt')), { confirm: async () => { throw new Error('rename must not prompt'); } }), 'unsupported-entry');
    } finally {
      cleanup(renamed);
    }
  });

  await test('the real private editor is 0700, exact Git failure surfaces before rebase start, and cleanup is guaranteed', async () => {
    const fixture = linearFixture('lgvs-commit-file-discard-editor-');
    const privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-commit-file-discard-editor-audit-'));
    const audit = path.join(privateTmp, 'editor-audit.txt');
    const previousTmpdir = process.env.TMPDIR;
    const previousAudit = process.env.LGVS_COMMIT_FILE_DISCARD_AUDIT;
    try {
      process.env.TMPDIR = privateTmp;
      process.env.LGVS_COMMIT_FILE_DISCARD_AUDIT = audit;
      const hook = path.join(fixture.dir, '.git', 'hooks', 'pre-rebase');
      fs.writeFileSync(hook, '#!/bin/sh\nfor d in "$TMPDIR"/lazygitvs-commit-file-discard-*; do\n  if [ -d "$d" ]; then stat -c "%a" "$d" > "$LGVS_COMMIT_FILE_DISCARD_AUDIT"; stat -c "%a" "$d/sequence-editor" >> "$LGVS_COMMIT_FILE_DISCARD_AUDIT"; fi\ndone\necho private editor hook refusal >&2\nexit 17\n', { mode: 0o755 });
      await assert.rejects(
        () => discard(fixture.dir, short(fixture.dir, fixture.selected), [file('changed.txt')], fileRow(file('changed.txt'))),
        /private editor hook refusal/i,
        'a failure before rebase stop with no active operation must surface the exact Git error',
      );
      assert.match(fs.readFileSync(audit, 'utf8'), /^700\n700\n?$/, 'the live sequence editor directory and executable must both be 0700');
      assert.deepEqual(fs.readdirSync(privateTmp), ['editor-audit.txt'], 'private editor files must be deleted after failure');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmpdir;
      if (previousAudit === undefined) delete process.env.LGVS_COMMIT_FILE_DISCARD_AUDIT; else process.env.LGVS_COMMIT_FILE_DISCARD_AUDIT = previousAudit;
      cleanup(privateTmp);
      cleanup(fixture.dir);
    }
  });

  await test('captured repo cwd isolates two repositories while only the selected source history is rewritten', async () => {
    const first = linearFixture('lgvs-commit-file-discard-repo-a-');
    const second = linearFixture('lgvs-commit-file-discard-repo-b-');
    try {
      const secondBefore = snapshot(second.dir);
      const outcome = await discard(first.dir, short(first.dir, first.selected), [file('changed.txt')], fileRow(file('changed.txt')));
      assert.equal(outcome.kind, 'success');
      assert.equal(git(first.dir, 'show', `${commitHashForSubject(first.dir, 'selected')}:changed.txt`), 'parent\n');
      assert.deepEqual(snapshot(second.dir), secondBefore, 'all preflight, rebase, amend, and continue subprocesses must stay in captured repository A');
    } finally {
      cleanup(first.dir);
      cleanup(second.dir);
    }
  });

  if (!process.exitCode) console.log('commitFileDiscard tests passed');
})();
