const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitCreateFixup.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Create fixup commit must live in a small compiled commitCreateFixup module.');
const {
  CREATE_FIXUP_COMMIT_TITLE,
  CREATING_FIXUP_COMMIT_STATUS,
  CREATE_FIXUP_COMMIT_MENU_ITEMS,
  createFixupCommit,
  fixupCommitArgs,
  amendCommitArgs,
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

function commit(dir, subject, files, body) {
  for (const [file, content] of Object.entries(files)) write(dir, file, content);
  if (Object.keys(files).length) git(dir, 'add', '-A');
  const args = ['commit', '-m', subject];
  if (body !== undefined) args.push('-m', body);
  git(dir, ...args);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

function short(dir, ref) {
  return git(dir, 'rev-parse', '--short', ref).trim();
}

function commitPayload(dir, ref = 'HEAD') {
  const raw = git(dir, 'cat-file', '-p', ref);
  return raw.slice(raw.indexOf('\n\n') + 2);
}

function snapshot(dir) {
  return {
    branch: git(dir, 'branch', '--show-current').trim(),
    head: git(dir, 'rev-parse', 'HEAD').trim(),
    tree: git(dir, 'rev-parse', 'HEAD^{tree}').trim(),
    status: git(dir, 'status', '--porcelain=v1', '--untracked-files=all'),
    cached: git(dir, 'diff', '--cached', '--binary'),
    working: git(dir, 'diff', '--binary'),
    untracked: git(dir, 'ls-files', '--others', '--exclude-standard', '-z'),
  };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function input(dir, visibleHashes, selectedIndex, options = {}) {
  return createFixupCommit({
    repoPath: dir,
    visibleHashes,
    selectedIndex,
    range: options.range || { mode: 'none' },
    isLocalCommits: options.isLocalCommits !== false,
    chooseAction: options.chooseAction || (async () => options.action || 'f'),
    prompt: options.prompt || (async (_title, value) => value),
    confirm: options.confirm || (async () => true),
    onStart: options.onStart,
  });
}

function fixture(prefix = 'lgvs-create-fixup-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n' });
  const target = commit(dir, 'target subject', { 'target.txt': 'target\n' }, 'target body\n');
  const head = commit(dir, 'head', { 'head.txt': 'head\n' });
  return { dir, base, target, head, visible: [short(dir, head), short(dir, target), short(dir, base)] };
}

(async () => {
  await test('freezes the exact native menu title, order, labels, and argv forms', () => {
    assert.equal(CREATE_FIXUP_COMMIT_TITLE, 'Create fixup commit');
    assert.deepEqual(CREATE_FIXUP_COMMIT_MENU_ITEMS, [
      { key: 'f', label: 'fixup! commit' },
      { key: 'a', label: 'amend! commit with changes' },
      { key: 'r', label: 'amend! commit without changes (pure reword)' },
    ]);
    assert.deepEqual(fixupCommitArgs('0123456789abcdef'), ['commit', '--fixup=0123456789abcdef']);
    assert.deepEqual(amendCommitArgs('target subject', 'new summary', 'new body', true), ['commit', '-m', 'amend! target subject', '-m', 'new summary\n\nnew body']);
    assert.deepEqual(amendCommitArgs('target subject', 'new summary', '', false), ['commit', '-m', 'amend! target subject', '-m', 'new summary', '--only', '--allow-empty']);
  });

  await test('configured F delegates only top-level Commits to the exact Create fixup commit menu', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');
    assert(extension.includes("from './commitCreateFixupUi'"), 'extension.ts must delegate configured F through the native commitCreateFixup UI adapter.');
    assert(config.includes("createFixupCommit: 'F'"), 'the configured default must remain lazygit createFixupCommit = F.');
    assert(extension.includes("key: key(k.createFixupCommit) || 'F', label: '$(tools) Create fixup commit'"), 'the top-level F item must retain a native command label.');
    assert(extension.includes('nativeCreateFixupCommitMenuItem('), 'the top-level F item must open the bounded native menu.');
    assert(!extension.includes("args: ['commit', '--fixup', c.hash]"), 'F must not remain a direct simplistic Git args item.');
    assert(extension.includes('panel===\'commits\'&&!${this.commitFilesFor ? \'true\' : \'false\'}'), 'the keyboard route must stay out of commit-files.');
    assert(readme.includes('partial Commits Create fixup commit parity'), 'README must document the Create fixup commit parity slice.');
    assert(keybindingAudit.includes('configured `keybinding.commits.createFixupCommit`') && keybindingAudit.includes('Create fixup commit'), 'the keybinding audit must document configured F.');
    assert(parity.includes('Bounded partial Create fixup commit slice'), 'the gap report must document this bounded story.');
  });

  await test('f creates one fixup child with the exact full-hash target and exactly the staged tree, retaining unstaged/untracked work', async () => {
    const f = fixture();
    try {
      write(f.dir, 'staged.txt', 'staged\n');
      write(f.dir, 'head.txt', 'head changed\n');
      write(f.dir, 'untracked.txt', 'untracked\n');
      git(f.dir, 'add', 'staged.txt');
      const before = snapshot(f.dir);
      const stagedTree = git(f.dir, 'write-tree').trim();
      const args = [];
      const outcome = await input(f.dir, f.visible, 1, {
        action: 'f',
        onStart: () => args.push(CREATING_FIXUP_COMMIT_STATUS),
      });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.selectionIndex, 2, 'selection returns the upstream index + 1 after the new child is inserted.');
      assert.deepEqual(args, [CREATING_FIXUP_COMMIT_STATUS]);
      const newHead = git(f.dir, 'rev-parse', 'HEAD').trim();
      assert.equal(git(f.dir, 'rev-parse', `${newHead}^`).trim(), before.head);
      assert.equal(git(f.dir, 'rev-parse', 'HEAD^{tree}').trim(), stagedTree);
      assert.equal(commitPayload(f.dir), `fixup! target subject\n`);
      assert.equal(git(f.dir, 'show', '-s', '--format=%B', 'HEAD').trim(), 'fixup! target subject');
      const after = snapshot(f.dir);
      assert.equal(after.working, before.working, 'the unstaged files must remain untouched.');
      assert.equal(after.untracked, before.untracked, 'the untracked files must remain untouched.');
      assert.equal(after.cached, '', 'the index is consumed exactly by the commit.');
    } finally {
      cleanup(f.dir);
    }
  });

  await test('a prompts for summary and description with exact titles and creates the amend message while using staged changes', async () => {
    const f = fixture('lgvs-create-amend-');
    try {
      write(f.dir, 'amend.txt', 'amend\n');
      git(f.dir, 'add', 'amend.txt');
      const prompts = [];
      const outcome = await input(f.dir, f.visible, 1, {
        action: 'a',
        prompt: async (title, value) => {
          prompts.push([title, value]);
          return title === 'Create "amend!" commit' ? 'new summary' : 'new body';
        },
      });
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(prompts, [
        ['Create "amend!" commit', 'target subject'],
        ['Commit description', '\ntarget body'],
      ]);
      assert.equal(commitPayload(f.dir), 'amend! target subject\n\nnew summary\n\nnew body\n');
      assert.equal(git(f.dir, 'show', '--format=', '--name-only', 'HEAD').trim(), 'amend.txt');
      assert.equal(git(f.dir, 'rev-parse', 'HEAD^').trim(), f.head);
    } finally {
      cleanup(f.dir);
    }
  });

  await test('r prompts identically but uses --only --allow-empty and never stages or changes files', async () => {
    const f = fixture('lgvs-create-reword-');
    try {
      write(f.dir, 'staged.txt', 'staged\n');
      write(f.dir, 'head.txt', 'head changed\n');
      write(f.dir, 'untracked.txt', 'untracked\n');
      git(f.dir, 'add', 'staged.txt');
      const before = snapshot(f.dir);
      const outcome = await input(f.dir, f.visible, 1, {
        action: 'r',
        prompt: async (title) => title === 'Create "amend!" commit' ? 'rewritten summary' : 'rewritten body',
      });
      assert.equal(outcome.kind, 'success');
      assert.equal(commitPayload(f.dir), 'amend! target subject\n\nrewritten summary\n\nrewritten body\n');
      assert.equal(git(f.dir, 'rev-parse', 'HEAD^{tree}').trim(), before.tree);
      const after = snapshot(f.dir);
      assert.equal(after.status, before.status);
      assert.equal(after.cached, before.cached);
      assert.equal(after.working, before.working);
      assert.equal(after.untracked, before.untracked);
      assert.equal(git(f.dir, 'rev-parse', 'HEAD^').trim(), before.head);
    } finally {
      cleanup(f.dir);
    }
  });

  await test('f/a with only unstaged or untracked changes confirm exact stage-all prompt, then retry without losing the new staged tree', async () => {
    const f = fixture('lgvs-create-stage-all-');
    try {
      write(f.dir, 'head.txt', 'head changed\n');
      write(f.dir, 'untracked.txt', 'untracked\n');
      const confirmations = [];
      const outcome = await input(f.dir, f.visible, 1, {
        action: 'f',
        confirm: async (title, prompt) => { confirmations.push([title, prompt]); return true; },
      });
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(confirmations, [['No files staged', 'You have not staged any files. Commit all files?']]);
      assert.equal(git(f.dir, 'show', '--format=', '--name-only', 'HEAD').trim().split('\n').sort().join('\n'), 'head.txt\nuntracked.txt');
    } finally {
      cleanup(f.dir);
    }
  });

  await test('cancelling amend input after accepting stage-all leaves the worktree and index untouched', async () => {
    const f = fixture('lgvs-create-stage-all-input-cancel-');
    try {
      write(f.dir, 'head.txt', 'changed but not staged\n');
      write(f.dir, 'untracked.txt', 'also untouched\n');
      const before = snapshot(f.dir);
      const outcome = await input(f.dir, f.visible, 1, {
        action: 'a',
        confirm: async () => true,
        prompt: async () => undefined,
      });
      assert.equal(outcome.kind, 'cancelled');
      assert.deepEqual(snapshot(f.dir), before);
    } finally {
      cleanup(f.dir);
    }
  });

  await test('r remains available on an entirely clean worktree and isolates the captured repository', async () => {
    const source = fixture('lgvs-create-isolated-source-');
    const other = fixture('lgvs-create-isolated-other-');
    try {
      const beforeOther = snapshot(other.dir);
      const prompts = [];
      const outcome = await input(source.dir, source.visible, 1, {
        action: 'r',
        prompt: async (title, value) => { prompts.push([title, value]); return title === 'Create "amend!" commit' ? 'clean reword' : ''; },
      });
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(prompts, [['Create "amend!" commit', 'target subject'], ['Commit description', '\ntarget body']]);
      assert.equal(commitPayload(source.dir), 'amend! target subject\n\nclean reword\n');
      assert.deepEqual(snapshot(other.dir), beforeOther);
    } finally {
      cleanup(source.dir);
      cleanup(other.dir);
    }
  });

  await test('no files expose No files staged as the f/a disabled reason while r stays enabled and a cancellation is read-only', async () => {
    const f = fixture('lgvs-create-cancel-');
    try {
      const seen = [];
      const before = snapshot(f.dir);
      const outcome = await input(f.dir, f.visible, 1, {
        chooseAction: async items => {
          seen.push(items);
          return undefined;
        },
      });
      assert.equal(outcome.kind, 'cancelled');
      assert.equal(seen.length, 1);
      assert.deepEqual(seen[0].map(item => ({ key: item.key, label: item.label, description: item.description, disabled: item.disabled })), [
        { key: 'f', label: 'fixup! commit', description: 'No files staged', disabled: true },
        { key: 'a', label: 'amend! commit with changes', description: 'No files staged', disabled: true },
        { key: 'r', label: 'amend! commit without changes (pure reword)', description: undefined, disabled: undefined },
      ]);
      assert.deepEqual(snapshot(f.dir), before);
    } finally {
      cleanup(f.dir);
    }
  });

  await test('fails closed for range, branch, conflicts, active operation, gpg signing, and menu/input drift without mutation', async () => {
    const f = fixture('lgvs-create-guards-');
    try {
      assert.equal((await input(f.dir, f.visible, 1, { range: { mode: 'sticky' } })).reason, 'multiple-commits');
      assert.equal((await input(f.dir, f.visible, 1, { isLocalCommits: false })).reason, 'branch-view');
      git(f.dir, 'config', 'commit.gpgSign', 'true');
      assert.equal((await input(f.dir, f.visible, 1)).reason, 'gpg-signing');
      git(f.dir, 'config', '--unset', 'commit.gpgSign');
      const branch = git(f.dir, 'branch', '--show-current').trim();
      git(f.dir, 'checkout', '-b', 'create-fixup-conflict-side');
      write(f.dir, 'head.txt', 'side\n');
      git(f.dir, 'add', 'head.txt');
      git(f.dir, 'commit', '-m', 'side conflict');
      git(f.dir, 'checkout', branch);
      write(f.dir, 'head.txt', 'current\n');
      git(f.dir, 'add', 'head.txt');
      git(f.dir, 'commit', '-m', 'current conflict');
      try { git(f.dir, 'merge', 'create-fixup-conflict-side'); } catch (_) {}
      assert.equal((await input(f.dir, f.visible, 1)).reason, 'conflicts');
      git(f.dir, 'merge', '--abort');
      const before = snapshot(f.dir);
      const drift = await input(f.dir, f.visible, 1, {
        action: 'f',
        chooseAction: async () => { write(f.dir, 'head.txt', 'drifted\n'); return 'f'; },
      });
      assert.equal(drift.reason, 'drift');
      const afterDrift = snapshot(f.dir);
      assert.equal(afterDrift.head, before.head);
      assert.equal(afterDrift.tree, before.tree);
      assert.notEqual(afterDrift.working, before.working);
    } finally {
      cleanup(f.dir);
    }
  });

  await test('stage-all commit failures clear transient status but preserve Git’s exact post-stage failure state', async () => {
    const f = fixture('lgvs-create-failure-');
    try {
      write(f.dir, 'failed.txt', 'failed\n');
      fs.writeFileSync(path.join(f.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho create fixup refusal >&2\nexit 19\n', { mode: 0o755 });
      const statuses = [];
      await assert.rejects(() => input(f.dir, f.visible, 1, {
        action: 'f',
        onStart: () => statuses.push(CREATING_FIXUP_COMMIT_STATUS),
      }), /create fixup refusal/i);
      assert.deepEqual(statuses, [CREATING_FIXUP_COMMIT_STATUS]);
      assert.match(git(f.dir, 'status', '--porcelain=v1'), /A  failed\.txt/);
      assert.equal(git(f.dir, 'rev-parse', 'HEAD').trim(), f.head);
    } finally {
      cleanup(f.dir);
    }
  });

  if (!process.exitCode) console.log('commitCreateFixup tests passed');
})();
