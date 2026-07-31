const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitDrop.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Commits Drop must live in a small compiled commitDrop module.');

const {
  DROP_COMMIT_PROMPT,
  DROP_COMMIT_TITLE,
  dropSelectedCommits,
  rewriteDropTodo,
} = require(modulePath);
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

function commit(dir, subject, files) {
  for (const [file, content] of Object.entries(files)) write(dir, file, content);
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', subject);
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
  return fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('lazygitvs-drop-')).sort();
}

function drop(dir, visibleHashes, selectedIndex, range = { mode: 'none' }, options = {}) {
  return dropSelectedCommits({
    repoPath: dir,
    visibleHashes,
    selectedIndex,
    range,
    viewBranch: options.viewBranch,
    confirm: options.confirm || (async () => true),
  });
}

function createLinearFixture(prefix = 'lgvs-drop-linear-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n', 'shared.txt': 'base\n' });
  const first = commit(dir, 'first', { 'first.txt': 'first\n' });
  const middle = commit(dir, 'middle', { 'middle.txt': 'middle\n' });
  const head = commit(dir, 'head', { 'head.txt': 'head\n' });
  return { dir, base, first, middle, head, visible: [short(dir, head), short(dir, middle), short(dir, first), short(dir, base)] };
}

function createConflictFixture(prefix = 'lgvs-drop-conflict-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'shared.txt': 'one\ntwo\n' });
  const selected = commit(dir, 'selected', { 'shared.txt': 'one\nselected\n' });
  const dependent = commit(dir, 'dependent', { 'shared.txt': 'one\ndependent\n' });
  return { dir, base, selected, dependent, visible: [short(dir, dependent), short(dir, selected), short(dir, base)] };
}

(async () => {
  await test('the pure rebase-todo rewriter changes only exactly one selected pick per hash and fails closed', () => {
    const todo = [
      'pick aaaaaaa base\n',
      'pick bbbbbbb selected\n',
      'pick ccccccc later\n',
      '# Rebase comments remain untouched\n',
    ].join('');
    const rewritten = rewriteDropTodo(todo, ['bbbbbbb']);
    assert.equal(rewritten, [
      'pick aaaaaaa base\n',
      'drop bbbbbbb selected\n',
      'pick ccccccc later\n',
      '# Rebase comments remain untouched\n',
    ].join(''));
    assert.throws(() => rewriteDropTodo(todo, ['ddddddd']), /exactly one|missing/i, 'a missing todo hash must fail before any file rewrite');
    assert.throws(() => rewriteDropTodo(`${todo}pick bbbbbbb duplicate\n`, ['bbbbbbb']), /exactly one|duplicate/i, 'a duplicate todo hash must fail closed');
    assert.throws(() => rewriteDropTodo(todo, ['bbbbbbb', 'bbbbbbb']), /duplicate/i, 'duplicate requested hashes are never silently coalesced');
  });

  await test('source routing uses configured universal.remove only for top-level Commits and documents bounded Drop parity', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitDrop.ts'), 'utf8');
    const shared = fs.readFileSync(path.join(root, 'src', 'commitRebaseTodo.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitDrop'"), 'extension.ts must delegate destructive Drop behavior to the bounded module');
    assert(config.includes("remove: 'd'"), 'the default must remain lazygit universal.remove = d');
    assert(extension.includes("key: key(u.remove) || 'd', label: '$(trash) Drop selected commit(s)'"), 'Commits Drop must read universal.remove instead of inventing a commits key');
    assert(extension.includes("panel==='commits'&&!${this.commitFilesFor ? 'true' : 'false'}&&hit(e,u.remove"), 'only the top-level Commits webview route may promote universal.remove into commitAction');
    assert(extension.includes('if ((cherryPickBufferAction || dropAction || squashAction || fixupAction) && this.commitFilesFor) return;'), 'Drop must not execute from the commit-files subview');
    assert(extension.includes("if(panel==='hunks'&&hit(e,u.select,u.togglePanel,u.remove"), 'Hunks must retain their own configured d path');
    assert(extension.includes("if(hit(e,u.remove)){e.preventDefault();vscode.postMessage({type:'discardMenu'});return;}"), 'Files must retain their existing configured d discard path');
    assert(model.includes("DROP_COMMIT_TITLE = 'Drop commit'") && model.includes("DROP_COMMIT_PROMPT = 'Are you sure you want to drop the selected commit(s)?'"), 'Drop must retain the exact modal title and body');
    assert(model.includes("from './commitRebaseTodo'"), 'Drop must delegate its private interactive rebase execution to the shared bounded utility');
    assert(shared.includes("cp.execFile('git'"), 'the shared utility must invoke Git through execFile argv, never a shell command');
    assert(shared.includes('GIT_SEQUENCE_EDITOR') && shared.includes('LGVS_REBASE_TODO_HASHES'), 'the private sequence editor must receive selected hashes through generic environment data');
    assert(shared.includes("GIT_EDITOR: 'true'") && shared.includes("LC_ALL: 'C'"), 'the shared rebase runner must remain non-interactive and locale-stable');
    assert(shared.includes('0o700') && shared.includes("'git-rebase-todo'"), 'the shared sequence editor must be private and edit only the generated todo');
    assert(shared.includes("'--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges'"), 'Drop must retain the bounded explicit interactive rebase argv through the shared utility');
    assert(readme.includes('partial Commits Drop parity'), 'README must call the Drop slice partial, not full parity');
    assert(keybindingAudit.includes('configured `universal.remove`') && keybindingAudit.includes('partial Drop parity'), 'keybinding audit must describe configured d routing and its bounds');
    assert(parity.includes('Bounded partial Drop slice') && parity.includes('full merge/active-rebase/dirty auto-stash'), 'parity gap report must state the bounded implementation and remaining gaps honestly');
  });

  await test('Drop removes an intermediate ordinary commit through real Git and cleans up its private editor', async () => {
    const fixture = createLinearFixture('lgvs-drop-intermediate-');
    const editorsBefore = privateEditorDirectories();
    try {
      const prompts = [];
      const outcome = await drop(fixture.dir, fixture.visible, 2, { mode: 'none' }, {
        confirm: async (title, prompt) => { prompts.push({ title, prompt }); return true; },
      });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.startIndex, 2, 'the controller can preserve the selected range start after refresh');
      assert.deepEqual(prompts, [{ title: DROP_COMMIT_TITLE, prompt: DROP_COMMIT_PROMPT }]);
      assert(!git(fixture.dir, 'log', '--format=%s').split('\n').includes('first'), 'the selected intermediate commit must be removed');
      assert(git(fixture.dir, 'log', '--format=%s').split('\n').includes('head'), 'later commits must be replayed');
      assert.equal(git(fixture.dir, 'status', '--porcelain=v1'), '');
      assert.deepEqual(privateEditorDirectories(), editorsBefore, 'private GIT_SEQUENCE_EDITOR files must always be deleted');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('Drop handles HEAD, a visible multi-range, and a root commit with descendants', async () => {
    const headFixture = createLinearFixture('lgvs-drop-head-');
    try {
      const outcome = await drop(headFixture.dir, headFixture.visible, 0);
      assert.equal(outcome.kind, 'success');
      assert.equal(git(headFixture.dir, 'log', '-1', '--format=%s').trim(), 'middle', 'dropping HEAD must leave its parent checked out');
      assert(!fs.existsSync(path.join(headFixture.dir, 'head.txt')));
    } finally {
      cleanup(headFixture.dir);
    }

    const rangeFixture = createLinearFixture('lgvs-drop-range-');
    try {
      const outcome = await drop(rangeFixture.dir, rangeFixture.visible, 0, { mode: 'sticky', anchor: 1 });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.startIndex, 0);
      const subjects = git(rangeFixture.dir, 'log', '--format=%s').trim().split('\n');
      assert(!subjects.includes('head') && !subjects.includes('middle'), 'a visible top-two range must remove every selected ordinary commit');
      assert(subjects.includes('first'));
    } finally {
      cleanup(rangeFixture.dir);
    }

    const rootFixture = initRepo('lgvs-drop-root-with-descendants-');
    try {
      const rootCommit = commit(rootFixture, 'root', { 'root.txt': 'root\n', 'shared.txt': 'root\n' });
      const child = commit(rootFixture, 'child', { 'child.txt': 'child\n' });
      const outcome = await drop(rootFixture, [short(rootFixture, child), short(rootFixture, rootCommit)], 1);
      assert.equal(outcome.kind, 'success');
      assert.equal(git(rootFixture, 'log', '-1', '--format=%s').trim(), 'child');
      assert(!fs.existsSync(path.join(rootFixture, 'root.txt')), 'the root must be dropped through --root while its descendant is retained');
      assert.equal(fs.readFileSync(path.join(rootFixture, 'child.txt'), 'utf8'), 'child\n');
    } finally {
      cleanup(rootFixture);
    }
  });

  await test('Drop rejects sole roots, merge-containing ranges, detached HEADs, unreachable hashes, and mismatched branch views before confirmation', async () => {
    const sole = initRepo('lgvs-drop-sole-root-');
    try {
      const only = commit(sole, 'only', { 'shared.txt': 'only\n' });
      const before = snapshot(sole);
      const outcome = await drop(sole, [short(sole, only)], 0, { mode: 'none' }, { confirm: async () => { throw new Error('sole root must not prompt'); } });
      assert.equal(outcome.kind, 'blocked');
      assert.equal(outcome.reason, 'sole-root');
      assert.match(outcome.message, /sole root/i);
      assert.deepEqual(snapshot(sole), before);
    } finally {
      cleanup(sole);
    }

    const merge = initRepo('lgvs-drop-merge-range-');
    try {
      const base = commit(merge, 'base', { 'shared.txt': 'base\n' });
      const branch = git(merge, 'branch', '--show-current').trim();
      git(merge, 'checkout', '-b', 'side');
      commit(merge, 'side', { 'side.txt': 'side\n' });
      git(merge, 'checkout', branch);
      const main = commit(merge, 'main', { 'main.txt': 'main\n' });
      git(merge, 'merge', '--no-ff', 'side', '-m', 'merge side');
      const mergeCommit = git(merge, 'rev-parse', 'HEAD').trim();
      const before = snapshot(merge);
      const outcome = await drop(merge, [short(merge, mergeCommit), short(merge, main), short(merge, base)], 0, { mode: 'sticky', anchor: 1 }, { confirm: async () => { throw new Error('merge range must not prompt'); } });
      assert.equal(outcome.kind, 'blocked');
      assert.equal(outcome.reason, 'merge-commit');
      assert.deepEqual(snapshot(merge), before);
    } finally {
      cleanup(merge);
    }

    const guarded = createLinearFixture('lgvs-drop-branch-guards-');
    try {
      const branch = git(guarded.dir, 'branch', '--show-current').trim();
      git(guarded.dir, 'checkout', '-b', 'other', guarded.base);
      const other = commit(guarded.dir, 'other', { 'other.txt': 'other\n' });
      git(guarded.dir, 'checkout', branch);
      const beforeBranchMismatch = snapshot(guarded.dir);
      const mismatched = await drop(guarded.dir, guarded.visible, 0, { mode: 'none' }, { viewBranch: 'other', confirm: async () => { throw new Error('mismatched view must not prompt'); } });
      assert.equal(mismatched.kind, 'blocked');
      assert.equal(mismatched.reason, 'branch-mismatch');
      assert.deepEqual(snapshot(guarded.dir), beforeBranchMismatch);

      const unreachable = await drop(guarded.dir, [short(guarded.dir, other)], 0, { mode: 'none' }, { confirm: async () => { throw new Error('unreachable hash must not prompt'); } });
      assert.equal(unreachable.kind, 'blocked');
      assert.equal(unreachable.reason, 'unreachable');

      git(guarded.dir, 'checkout', '--detach');
      const detachedBefore = snapshot(guarded.dir);
      const detached = await drop(guarded.dir, [short(guarded.dir, 'HEAD')], 0, { mode: 'none' }, { confirm: async () => { throw new Error('detached HEAD must not prompt'); } });
      assert.equal(detached.kind, 'blocked');
      assert.equal(detached.reason, 'detached-head');
      assert.deepEqual(snapshot(guarded.dir), detachedBefore);
    } finally {
      cleanup(guarded.dir);
    }
  });

  await test('staged, unstaged, and untracked changes each reject Drop without a modal or mutation', async () => {
    for (const kind of ['staged', 'unstaged', 'untracked']) {
      const fixture = createLinearFixture(`lgvs-drop-dirty-${kind}-`);
      try {
        if (kind === 'staged') { write(fixture.dir, 'staged.txt', 'staged\n'); git(fixture.dir, 'add', 'staged.txt'); }
        if (kind === 'unstaged') write(fixture.dir, 'shared.txt', 'unstaged\n');
        if (kind === 'untracked') write(fixture.dir, 'untracked.txt', 'untracked\n');
        const before = snapshot(fixture.dir);
        const outcome = await drop(fixture.dir, fixture.visible, 1, { mode: 'none' }, { confirm: async () => { throw new Error(`${kind} changes must not prompt`); } });
        assert.equal(outcome.kind, 'blocked', kind);
        assert.equal(outcome.reason, 'dirty-worktree', kind);
        assert.deepEqual(snapshot(fixture.dir), before, kind);
      } finally {
        cleanup(fixture.dir);
      }
    }
  });

  await test('an active real rebase blocks Drop before confirmation and cancellation is fully read-only', async () => {
    const active = initRepo('lgvs-drop-active-rebase-');
    try {
      commit(active, 'base', { 'shared.txt': 'base\n' });
      const branch = git(active, 'branch', '--show-current').trim();
      git(active, 'checkout', '-b', 'side');
      commit(active, 'side', { 'shared.txt': 'side\n' });
      git(active, 'checkout', branch);
      commit(active, 'current', { 'shared.txt': 'current\n' });
      try { git(active, 'rebase', 'side'); } catch (_) {}
      assert.equal(detectGitOperationState(active).kind, 'rebase', 'fixture must create a real in-progress rebase');
      const activeOutcome = await drop(active, [short(active, 'HEAD')], 0, { mode: 'none' }, { confirm: async () => { throw new Error('active operation must not prompt'); } });
      assert.equal(activeOutcome.kind, 'blocked');
      assert.equal(activeOutcome.reason, 'active-operation');
      git(active, 'rebase', '--abort');
    } finally {
      cleanup(active);
    }

    const cancelled = createLinearFixture('lgvs-drop-cancel-');
    try {
      const before = snapshot(cancelled.dir);
      const editorsBefore = privateEditorDirectories();
      const prompts = [];
      const outcome = await drop(cancelled.dir, cancelled.visible, 1, { mode: 'none' }, { confirm: async (title, prompt) => { prompts.push({ title, prompt }); return false; } });
      assert.equal(outcome.kind, 'cancelled');
      assert.deepEqual(prompts, [{ title: DROP_COMMIT_TITLE, prompt: DROP_COMMIT_PROMPT }]);
      assert.deepEqual(snapshot(cancelled.dir), before, 'cancel must not start rebase or write a temporary editor');
      assert.deepEqual(privateEditorDirectories(), editorsBefore);
    } finally {
      cleanup(cancelled.dir);
    }
  });

  await test('post-confirmation HEAD drift is rejected before rebase starts', async () => {
    const fixture = createLinearFixture('lgvs-drop-drift-');
    try {
      const selected = fixture.middle;
      const initialHead = git(fixture.dir, 'rev-parse', 'HEAD').trim();
      const outcome = await drop(fixture.dir, fixture.visible, 1, { mode: 'none' }, {
        confirm: async () => { commit(fixture.dir, 'drift', { 'drift.txt': 'drift\n' }); return true; },
      });
      assert.equal(outcome.kind, 'blocked');
      assert.equal(outcome.reason, 'drift');
      assert.match(outcome.message, /changed while confirmation/i);
      assert.notEqual(git(fixture.dir, 'rev-parse', 'HEAD').trim(), initialHead, 'the test deliberately moves HEAD during the modal');
      assert.equal(git(fixture.dir, 'merge-base', '--is-ancestor', selected, 'HEAD').trim(), '', 'the selected commit remains reachable because no Drop rebase started');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('a real rebase conflict remains active for Status recovery, and git rebase --abort restores the exact snapshot', async () => {
    const fixture = createConflictFixture();
    try {
      const before = snapshot(fixture.dir);
      const outcome = await drop(fixture.dir, fixture.visible, 1);
      assert.equal(outcome.kind, 'rebase-active');
      assert.match(outcome.message, /Status|rebase/i);
      assert.equal(detectGitOperationState(fixture.dir).kind, 'rebase', 'Drop must not abort a conflict it leaves for Status c/a/s recovery');
      assert.match(git(fixture.dir, 'status', '--porcelain=v1'), /UU shared\.txt/);
      git(fixture.dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(fixture.dir), before, 'the existing real Git recovery path must restore the original branch snapshot');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('a rebase failure with no active operation surfaces its Git error and never claims rollback', async () => {
    const fixture = createLinearFixture('lgvs-drop-hook-failure-');
    const privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-drop-editor-audit-'));
    const audit = path.join(privateTmp, 'editor-audit.txt');
    const previousTmpdir = process.env.TMPDIR;
    const previousAudit = process.env.LGVS_DROP_AUDIT;
    try {
      process.env.TMPDIR = privateTmp;
      process.env.LGVS_DROP_AUDIT = audit;
      const hook = path.join(fixture.dir, '.git', 'hooks', 'pre-rebase');
      fs.writeFileSync(hook, '#!/bin/sh\nfor d in "$TMPDIR"/lazygitvs-drop-*; do\n  if [ -d "$d" ]; then stat -c "%a" "$d" > "$LGVS_DROP_AUDIT"; stat -c "%a" "$d/sequence-editor" >> "$LGVS_DROP_AUDIT"; fi\ndone\necho drop hook refusal >&2\nexit 17\n', { mode: 0o755 });
      await assert.rejects(
        () => drop(fixture.dir, fixture.visible, 1),
        /drop hook refusal/i,
        'a failed rebase without an in-progress operation must surface the real failure',
      );
      assert.match(fs.readFileSync(audit, 'utf8'), /^700\n700\n?$/, 'the live temporary editor and directory must both be private 0700');
      assert.deepEqual(fs.readdirSync(privateTmp), ['editor-audit.txt'], 'the temporary editor must be deleted after a non-operation rebase failure');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
      assert(git(fixture.dir, 'log', '--format=%s').split('\n').includes('middle'), 'the module must not pretend it rolled back a hook-blocked rebase');
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmpdir;
      if (previousAudit === undefined) delete process.env.LGVS_DROP_AUDIT; else process.env.LGVS_DROP_AUDIT = previousAudit;
      cleanup(privateTmp);
      cleanup(fixture.dir);
    }
  });

  if (!process.exitCode) console.log('commitDrop tests passed');
})();
