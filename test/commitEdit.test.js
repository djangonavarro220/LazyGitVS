const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitEdit.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const securityPath = path.join(root, 'src', 'webviewSecurity.ts');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Commits Edit must live in a small compiled commitEdit module.');

const {
  EDIT_COMMIT_STATUS,
  EDIT_STOPPED_STATUS,
  commitEditMenuItem,
  editSelectedCommits,
  rewriteEditTodo,
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
    env: { ...process.env, GIT_EDITOR: 'true', LANG: 'C', LC_ALL: 'C', LC_MESSAGES: 'C' },
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

function commit(dir, subject, files = {}, options = {}) {
  for (const [file, content] of Object.entries(files)) write(dir, file, content);
  if (Object.keys(files).length) git(dir, 'add', '-A');
  git(dir, 'commit', ...(options.allowEmpty ? ['--allow-empty'] : []), '-m', subject);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

function short(dir, ref) {
  return git(dir, 'rev-parse', '--short', ref).trim();
}

function snapshot(dir) {
  return {
    branch: git(dir, 'branch', '--show-current').trim(),
    head: git(dir, 'rev-parse', 'HEAD').trim(),
    tree: git(dir, 'rev-parse', 'HEAD^{tree}').trim(),
    status: git(dir, 'status', '--porcelain=v1', '--untracked-files=all'),
    cached: git(dir, 'diff', '--cached', '--binary'),
    working: git(dir, 'diff', '--binary'),
    log: git(dir, 'log', '--format=%H%x09%P%x09%B'),
    refs: git(dir, 'show-ref'),
  };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function privateEditorDirectories(directory = os.tmpdir()) {
  return fs.readdirSync(directory).filter(name => name.startsWith('lazygitvs-edit-')).sort();
}

function edit(dir, visibleHashes, selectedIndex, options = {}) {
  return editSelectedCommits({
    repoPath: dir,
    visibleHashes,
    selectedIndex,
    range: options.range || { mode: 'none' },
    isLocalCommits: options.isLocalCommits !== false,
    onStart: options.onStart,
  });
}

function createLinearFixture(prefix = 'lgvs-edit-linear-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n', 'shared.txt': 'base\n' });
  const first = commit(dir, 'first', { 'first.txt': 'first\n' });
  const middle = commit(dir, 'middle', { 'middle.txt': 'middle\n' });
  const head = commit(dir, 'head', { 'head.txt': 'head\n' });
  return { dir, base, first, middle, head, visible: [short(dir, head), short(dir, middle), short(dir, first), short(dir, base)] };
}

function createActiveOperationFixture(kind) {
  const dir = initRepo(`lgvs-edit-active-${kind}-`);
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

function assertBlocked(outcome, reason, fragment) {
  assert.equal(outcome.kind, 'blocked');
  assert.equal(outcome.reason, reason);
  if (fragment) assert.match(outcome.message, fragment);
}

async function withStoppedHeadFailure(fn) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-edit-git-wrapper-'));
  const marker = path.join(bin, 'rebase-started');
  const wrapper = path.join(bin, 'git');
  const realGit = cp.execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const oldPath = process.env.PATH;
  const oldRealGit = process.env.LGVS_EDIT_REAL_GIT;
  const oldMarker = process.env.LGVS_EDIT_STOPPED_HEAD_MARKER;
  fs.writeFileSync(wrapper, `#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
const args = process.argv.slice(2);
const marker = process.env.LGVS_EDIT_STOPPED_HEAD_MARKER;
if (marker && fs.existsSync(marker) && args[0] === 'rev-parse' && args.includes('--verify')) {
  process.stderr.write('forced stopped-head verification failure\\n');
  process.exit(41);
}
const result = cp.spawnSync(process.env.LGVS_EDIT_REAL_GIT, args, { stdio: 'inherit', env: process.env });
if (marker && args[0] === 'rebase' && args.includes('--interactive') && result.status === 0) fs.writeFileSync(marker, 'started\\n');
process.exit(typeof result.status === 'number' ? result.status : 1);
`, { mode: 0o755 });
  try {
    process.env.PATH = `${bin}${path.delimiter}${oldPath || ''}`;
    process.env.LGVS_EDIT_REAL_GIT = realGit;
    process.env.LGVS_EDIT_STOPPED_HEAD_MARKER = marker;
    return await fn();
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldRealGit === undefined) delete process.env.LGVS_EDIT_REAL_GIT; else process.env.LGVS_EDIT_REAL_GIT = oldRealGit;
    if (oldMarker === undefined) delete process.env.LGVS_EDIT_STOPPED_HEAD_MARKER; else process.env.LGVS_EDIT_STOPPED_HEAD_MARKER = oldMarker;
    cleanup(bin);
  }
}

(async () => {
  await test('configured universal e is isolated to top-level Local Commits and documents bounded Edit parity', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const security = fs.readFileSync(securityPath, 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitEdit.ts'), 'utf8');
    const shared = fs.readFileSync(path.join(root, 'src', 'commitRebaseTodo.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitEdit'"), 'extension.ts must delegate bounded Edit behavior to commitEdit.ts');
    assert(config.includes("edit: 'e'"), 'the default must remain lazygit keybinding.universal.edit = e');
    assert(extension.includes("commitEditMenuItem({ ...this.commitHistoryActionInput(), key: key(u.edit) || 'e'"), 'the Commits catalog must use configured universal.edit');
    assert(extension.includes("panel==='commits'&&!${this.commitFilesFor ? 'true' : 'false'}&&hit(e,u.remove") && extension.includes('c.amendToCommit,u.edit,c.createFixupCommit'), 'only the top-level Commits webview route may promote configured e into commitAction');
    assert(extension.includes('editAction') && extension.includes('this.commitFilesFor) return;'), 'Commit-files must never execute the top-level Edit action');
    assert(extension.includes("if(hit(e,u.edit)){e.preventDefault();vscode.postMessage({type:'editFile'});return;}"), 'Files must retain their existing configured e edit path');
    assert(security.includes("'commitAction'"), 'existing strict commitAction validation must remain available');
    assert(!security.includes("'editCommit'"), 'Edit must not add a webview message type');
    assert(extension.trimEnd().split(/\r?\n/).length < 1800, 'extension.ts must remain below the 1800-line controller ceiling');

    assert.equal(EDIT_COMMIT_STATUS, 'Rebasing');
    assert.equal(EDIT_STOPPED_STATUS, 'Rebase stopped for commit editing; amend changes, then continue or abort from Status.');
    assert(model.includes("action: 'edit'") && model.includes('keepEmpty: false'), 'Edit must use typed edit without --keep-empty');
    assert(model.includes("temporaryDirectoryPrefix: 'lazygitvs-edit-'"), 'Edit must use a dedicated private editor namespace');
    assert(model.includes('isLocalCommits') && model.includes('noncontiguous'), 'the bounded model must refuse branch views and noncontiguous visible selections');
    assert(!model.includes('confirm') && !model.includes('createTerminal'), 'Edit must start without a confirmation or terminal');
    assert(shared.includes("cp.execFile('git'"), 'the shared runner must use execFile argv rather than a shell');
    assert(shared.includes('GIT_SEQUENCE_EDITOR') && shared.includes('LGVS_REBASE_TODO_HASHES'), 'the private sequence editor must receive selected hashes through environment data');
    assert(readme.includes('partial Commits Edit parity'), 'README must call Edit a bounded partial parity slice');
    assert(keybindingAudit.includes('configured `universal.edit`') && keybindingAudit.includes('partial Edit parity'), 'keybinding audit must document configured e and its bounds');
    assert(parity.includes('Bounded partial Edit slice') && parity.includes('Edit/start interactive rebase `e`'), 'gap report must replace the old e gap honestly');
  });

  await test('the edit todo transformer maps captured full hashes to exactly one generated pick and preserves every other directive', () => {
    const full = 'bbbbbbb0123456789012345678901234567890123';
    const todo = [
      'pick aaaaaaa base\n',
      `pick ${full.slice(0, 7)} selected suffix\n`,
      'label keep-this\n',
      'exec echo untouched\n',
      'merge -C ccccccc branch # merge untouched\n',
      '# Rebase comments remain untouched\n',
    ].join('');
    assert.equal(rewriteEditTodo(todo, [full]), todo.replace(`pick ${full.slice(0, 7)} selected suffix`, `edit ${full.slice(0, 7)} selected suffix`));
    assert.equal(rewriteEditTodo(todo.replace(full.slice(0, 7), full), [full.slice(0, 7)]), todo.replace(`pick ${full.slice(0, 7)} selected suffix`, `edit ${full} selected suffix`), 'existing abbreviated callers must also match a full generated todo hash');
    assert.throws(() => rewriteEditTodo(todo, ['ddddddd0123456789012345678901234567890123']), /exactly one|missing/i);
    assert.throws(() => rewriteEditTodo(`${todo}pick ${full.slice(0, 7)} duplicate\n`, [full]), /exactly one|duplicate/i);
    assert.throws(() => rewriteEditTodo(todo, [full, full]), /duplicate/i);
  });

  await test('Edit stops a selected middle commit at its original full hash, keeps the real rebase active, and lets normal continue finish', async () => {
    const fixture = createLinearFixture('lgvs-edit-middle-');
    const editorsBefore = privateEditorDirectories();
    try {
      const starts = [];
      const outcome = await edit(fixture.dir, fixture.visible, 1, { onStart: () => starts.push('start') });
      assert.equal(outcome.kind, 'stopped');
      assert.equal(outcome.startIndex, 1);
      assert.deepEqual(outcome.hashes, [fixture.middle]);
      assert.equal(outcome.message, EDIT_STOPPED_STATUS);
      assert.deepEqual(starts, ['start'], 'Rebasing begins once immediately before spawning Git');
      assert.equal(detectGitOperationState(fixture.dir).kind, 'rebase', 'the intentional edit stop must remain visible to Status recovery');
      assert.equal(git(fixture.dir, 'rev-parse', 'HEAD').trim(), fixture.middle, 'stopped HEAD must equal the selected original full hash');
      assert.equal(git(fixture.dir, 'status', '--porcelain=v1', '--untracked-files=all'), '');
      assert.deepEqual(privateEditorDirectories(), editorsBefore, 'the private editor must be deleted even while the real rebase stays active');
      git(fixture.dir, 'rebase', '--continue');
      assert.equal(detectGitOperationState(fixture.dir), undefined, 'normal Status continue must finish the rebase without LGVS auto-continuing it');
      assert.equal(git(fixture.dir, 'rev-parse', 'HEAD').trim(), fixture.head);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('Edit stops every selected range commit naturally after Status continue, and abort restores the exact snapshot', async () => {
    const fixture = createLinearFixture('lgvs-edit-range-');
    try {
      const before = snapshot(fixture.dir);
      const outcome = await edit(fixture.dir, fixture.visible, 0, { range: { mode: 'sticky', anchor: 1 } });
      assert.equal(outcome.kind, 'stopped');
      assert.deepEqual(outcome.hashes, [fixture.head, fixture.middle]);
      assert.equal(git(fixture.dir, 'rev-parse', 'HEAD').trim(), fixture.middle, 'the oldest selected commit must be the first edit stop');
      assert.equal(detectGitOperationState(fixture.dir).kind, 'rebase');
      git(fixture.dir, 'rebase', '--continue');
      assert.equal(detectGitOperationState(fixture.dir).kind, 'rebase', 'the next selected edit row must stop naturally after continue');
      assert.equal(git(fixture.dir, 'rev-parse', 'HEAD').trim(), fixture.head, 'the next stop must be the next selected original full hash');
      git(fixture.dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(fixture.dir), before, 'real abort must restore branch, refs, worktree, and original history exactly');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('Edit supports HEAD, root, and intentional empty selected commits without auto-amending or auto-continuing', async () => {
    const headFixture = createLinearFixture('lgvs-edit-head-');
    try {
      const before = snapshot(headFixture.dir);
      const outcome = await edit(headFixture.dir, headFixture.visible, 0);
      assert.equal(outcome.kind, 'stopped');
      assert.equal(git(headFixture.dir, 'rev-parse', 'HEAD').trim(), headFixture.head);
      assert.equal(detectGitOperationState(headFixture.dir).kind, 'rebase');
      git(headFixture.dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(headFixture.dir), before);
    } finally {
      cleanup(headFixture.dir);
    }

    const rootFixture = initRepo('lgvs-edit-root-');
    try {
      const rootCommit = commit(rootFixture, 'root', { 'root.txt': 'root\n' });
      const child = commit(rootFixture, 'child', { 'child.txt': 'child\n' });
      const before = snapshot(rootFixture);
      const outcome = await edit(rootFixture, [short(rootFixture, child), short(rootFixture, rootCommit)], 1);
      assert.equal(outcome.kind, 'stopped');
      assert.equal(git(rootFixture, 'rev-parse', 'HEAD').trim(), rootCommit, 'root must stop through --root at its original full hash');
      assert.equal(detectGitOperationState(rootFixture).kind, 'rebase');
      git(rootFixture, 'rebase', '--abort');
      assert.deepEqual(snapshot(rootFixture), before);
    } finally {
      cleanup(rootFixture);
    }

    const emptyFixture = initRepo('lgvs-edit-empty-');
    try {
      const base = commit(emptyFixture, 'base', { 'base.txt': 'base\n' });
      const empty = commit(emptyFixture, 'intentional empty', {}, { allowEmpty: true });
      const head = commit(emptyFixture, 'head', { 'head.txt': 'head\n' });
      const before = snapshot(emptyFixture);
      const outcome = await edit(emptyFixture, [short(emptyFixture, head), short(emptyFixture, empty), short(emptyFixture, base)], 1);
      assert.equal(outcome.kind, 'stopped');
      assert.equal(git(emptyFixture, 'rev-parse', 'HEAD').trim(), empty, 'an intentional empty commit must remain an edit stop without --keep-empty');
      assert.equal(detectGitOperationState(emptyFixture).kind, 'rebase');
      git(emptyFixture, 'rebase', '--abort');
      assert.deepEqual(snapshot(emptyFixture), before);
    } finally {
      cleanup(emptyFixture);
    }
  });

  await test('Edit keeps Status recovery when post-spawn verification fails with an operation still active', async () => {
    const fixture = createLinearFixture('lgvs-edit-post-spawn-operation-');
    try {
      const before = snapshot(fixture.dir);
      const outcome = await withStoppedHeadFailure(() => edit(fixture.dir, fixture.visible, 1));
      assert.equal(outcome.kind, 'rebase-active');
      assert.match(outcome.message, /Status|rebase/i);
      assert.equal(detectGitOperationState(fixture.dir).kind, 'rebase', 'the failed verifier must not abort a real rebase');
      git(fixture.dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(fixture.dir), before);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('Edit rejects dirty trees, active operations, detached or branch views, unreachable/noncontiguous/duplicate selections, and merges before Rebasing', async () => {
    for (const kind of ['staged', 'unstaged', 'untracked']) {
      const fixture = createLinearFixture(`lgvs-edit-dirty-${kind}-`);
      try {
        if (kind === 'staged') { write(fixture.dir, 'staged.txt', 'staged\n'); git(fixture.dir, 'add', 'staged.txt'); }
        if (kind === 'unstaged') write(fixture.dir, 'shared.txt', 'unstaged\n');
        if (kind === 'untracked') write(fixture.dir, 'untracked.txt', 'untracked\n');
        const before = snapshot(fixture.dir);
        let starts = 0;
        assertBlocked(await edit(fixture.dir, fixture.visible, 1, { onStart: () => { starts += 1; } }), 'dirty-worktree');
        assert.equal(starts, 0);
        assert.deepEqual(snapshot(fixture.dir), before);
      } finally {
        cleanup(fixture.dir);
      }
    }

    for (const kind of ['merge', 'rebase', 'cherry-pick', 'revert']) {
      const fixture = createActiveOperationFixture(kind);
      try {
        assert.equal(detectGitOperationState(fixture.dir).kind, kind, `${kind} fixture must create a real active operation`);
        const before = snapshot(fixture.dir);
        let starts = 0;
        assertBlocked(await edit(fixture.dir, [short(fixture.dir, 'HEAD')], 0, { onStart: () => { starts += 1; } }), 'active-operation');
        assert.equal(starts, 0);
        assert.deepEqual(snapshot(fixture.dir), before);
      } finally {
        fixture.abort();
        cleanup(fixture.dir);
      }
    }

    const fixture = createLinearFixture('lgvs-edit-context-');
    try {
      const before = snapshot(fixture.dir);
      let starts = 0;
      assertBlocked(await edit(fixture.dir, fixture.visible, 1, { isLocalCommits: false, onStart: () => { starts += 1; } }), 'branch-view');
      assert.equal(starts, 0);
      assert.deepEqual(snapshot(fixture.dir), before);

      assertBlocked(await edit(fixture.dir, [fixture.visible[0], fixture.visible[3]], 0, { range: { mode: 'sticky', anchor: 1 } }), 'noncontiguous');
      assert.equal(detectGitOperationState(fixture.dir), undefined);

      assertBlocked(await edit(fixture.dir, [fixture.visible[0], fixture.visible[0]], 0, { range: { mode: 'sticky', anchor: 1 } }), 'invalid-selection');

      const branch = git(fixture.dir, 'branch', '--show-current').trim();
      git(fixture.dir, 'checkout', '-b', 'other', fixture.base);
      const other = commit(fixture.dir, 'other', { 'other.txt': 'other\n' });
      git(fixture.dir, 'checkout', branch);
      assertBlocked(await edit(fixture.dir, [short(fixture.dir, other)], 0), 'unreachable');
      let missingStarts = 0;
      assertBlocked(await edit(fixture.dir, ['a'.repeat(40)], 0, { onStart: () => { missingStarts += 1; } }), 'unreachable');
      assert.equal(missingStarts, 0, 'an unresolved visible hash must be rejected before Rebasing');

      git(fixture.dir, 'checkout', '--detach');
      const detachedBefore = snapshot(fixture.dir);
      assertBlocked(await edit(fixture.dir, [short(fixture.dir, 'HEAD')], 0), 'detached-head');
      assert.deepEqual(snapshot(fixture.dir), detachedBefore);
    } finally {
      cleanup(fixture.dir);
    }

    const merge = initRepo('lgvs-edit-merge-');
    try {
      const base = commit(merge, 'base', { 'base.txt': 'base\n' });
      const branch = git(merge, 'branch', '--show-current').trim();
      git(merge, 'checkout', '-b', 'side');
      commit(merge, 'side', { 'side.txt': 'side\n' });
      git(merge, 'checkout', branch);
      commit(merge, 'main', { 'main.txt': 'main\n' });
      git(merge, 'merge', '--no-ff', 'side', '-m', 'merge side');
      const mergeCommit = git(merge, 'rev-parse', 'HEAD').trim();
      let starts = 0;
      assertBlocked(await edit(merge, [short(merge, mergeCommit), short(merge, base)], 0, { onStart: () => { starts += 1; } }), 'merge-commit');
      assert.equal(starts, 0);
      assert.equal(git(merge, 'rev-parse', 'HEAD').trim(), mergeCommit);
    } finally {
      cleanup(merge);
    }
  });

  await test('a non-operation rebase-start failure surfaces its exact error, clears transient Rebasing in the menu, and cleans its private 0700 editor', async () => {
    const fixture = createLinearFixture('lgvs-edit-hook-failure-');
    const privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-edit-editor-audit-'));
    const audit = path.join(privateTmp, 'editor-audit.txt');
    const previousTmpdir = process.env.TMPDIR;
    const previousAudit = process.env.LGVS_EDIT_AUDIT;
    try {
      process.env.TMPDIR = privateTmp;
      process.env.LGVS_EDIT_AUDIT = audit;
      const hook = path.join(fixture.dir, '.git', 'hooks', 'pre-rebase');
      fs.writeFileSync(hook, '#!/bin/sh\nfor d in "$TMPDIR"/lazygitvs-edit-*; do\n  if [ -d "$d" ]; then stat -c "%a" "$d" > "$LGVS_EDIT_AUDIT"; stat -c "%a" "$d/sequence-editor" >> "$LGVS_EDIT_AUDIT"; fi\ndone\necho edit hook refusal >&2\nexit 17\n', { mode: 0o755 });
      const states = [];
      const item = commitEditMenuItem({
        key: 'e',
        repoPath: fixture.dir,
        visibleHashes: fixture.visible,
        selectedIndex: 1,
        range: { mode: 'none' },
        isLocalCommits: true,
        onStatus: status => states.push(status),
      });
      await assert.rejects(() => item.run(), /edit hook refusal/i);
      assert.deepEqual(states, [EDIT_COMMIT_STATUS, ''], 'only a non-operation spawn failure clears transient Rebasing');
      assert.match(fs.readFileSync(audit, 'utf8'), /^700\n700\n?$/, 'the live sequence editor directory and executable must both be private 0700');
      assert.deepEqual(fs.readdirSync(privateTmp), ['editor-audit.txt'], 'private editor files must be removed after the spawn failure');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmpdir;
      if (previousAudit === undefined) delete process.env.LGVS_EDIT_AUDIT; else process.env.LGVS_EDIT_AUDIT = previousAudit;
      cleanup(privateTmp);
      cleanup(fixture.dir);
    }
  });

  await test('the menu preserves a durable stopped status and two-repository isolation while leaving user recovery entirely to Status', async () => {
    const first = createLinearFixture('lgvs-edit-first-repo-');
    const second = createLinearFixture('lgvs-edit-second-repo-');
    try {
      const secondBefore = snapshot(second.dir);
      const states = [];
      const messages = [];
      const item = commitEditMenuItem({
        key: 'e',
        repoPath: first.dir,
        visibleHashes: first.visible,
        selectedIndex: 1,
        range: { mode: 'none' },
        isLocalCommits: true,
        onStatus: status => states.push(status),
        onMessage: message => messages.push(message),
      });
      await item.run();
      assert.deepEqual(states, [EDIT_COMMIT_STATUS, EDIT_STOPPED_STATUS]);
      assert.deepEqual(messages, [], 'normal edit stops report durably in Status without a second modal');
      assert.equal(detectGitOperationState(first.dir).kind, 'rebase');
      assert.deepEqual(snapshot(second.dir), secondBefore, 'the second repository must remain byte-for-byte unchanged');
      git(first.dir, 'rebase', '--abort');
    } finally {
      cleanup(first.dir);
      cleanup(second.dir);
    }
  });

  if (!process.exitCode) console.log('commitEdit tests passed');
})();
