const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitReword.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const securityPath = path.join(root, 'src', 'webviewSecurity.ts');
const rebaseTodoPath = path.join(root, 'out', 'commitRebaseTodo.js');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Commits Reword must live in a small compiled commitReword module.');

const {
  REWORD_COMMIT_TITLE,
  REWORDING_STATUS,
  commitRewordMenuItem,
  rewordAmendArgs,
  rewordSelectedCommit,
} = require(modulePath);
const { INTERACTIVE_REBASE_ARGS } = require(rebaseTodoPath);
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
  const args = ['commit', ...(options.allowEmpty ? ['--allow-empty'] : []), '-m', subject];
  if (options.body !== undefined) args.push('-m', options.body);
  git(dir, ...args);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

function short(dir, ref) {
  return git(dir, 'rev-parse', '--short', ref).trim();
}

function commitPayload(dir, ref = 'HEAD') {
  const raw = git(dir, 'cat-file', '-p', ref);
  const separator = raw.indexOf('\n\n');
  assert(separator >= 0, 'commit object must contain a header/message separator');
  return raw.slice(separator + 2);
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
  return fs.readdirSync(directory).filter(name => name.startsWith('lazygitvs-reword-')).sort();
}

function reword(dir, visibleHashes, selectedIndex, options = {}) {
  return rewordSelectedCommit({
    repoPath: dir,
    visibleHashes,
    selectedIndex,
    range: options.range || { mode: 'none' },
    isLocalCommits: options.isLocalCommits !== false,
    prompt: options.prompt || (async (_, initialSummary) => options.summary === undefined ? `${initialSummary} reworded` : options.summary),
    onStart: options.onStart,
  });
}

function createLinearFixture(prefix = 'lgvs-reword-linear-', options = {}) {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n', 'shared.txt': 'base\n' });
  const middle = commit(dir, options.middleSubject || 'middle original', { 'middle.txt': 'middle\n' }, { body: options.middleBody });
  const head = commit(dir, options.headSubject || 'head original', { 'head.txt': 'head\n' }, { body: options.headBody });
  return {
    dir,
    base,
    middle,
    head,
    visible: [short(dir, head), short(dir, middle), short(dir, base)],
  };
}

function createActiveOperationFixture(kind) {
  const dir = initRepo(`lgvs-reword-active-${kind}-`);
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

async function withGitArgAudit(fn) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-reword-git-wrapper-'));
  const audit = path.join(bin, 'argv.jsonl');
  const wrapper = path.join(bin, 'git');
  const realGit = cp.execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const oldPath = process.env.PATH;
  const oldRealGit = process.env.LGVS_REWORD_REAL_GIT;
  const oldAudit = process.env.LGVS_REWORD_ARGV_AUDIT;
  fs.writeFileSync(wrapper, `#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
fs.appendFileSync(process.env.LGVS_REWORD_ARGV_AUDIT, JSON.stringify(process.argv.slice(2)) + '\\n');
const result = cp.spawnSync(process.env.LGVS_REWORD_REAL_GIT, process.argv.slice(2), { stdio: 'inherit', env: process.env });
process.exit(typeof result.status === 'number' ? result.status : 1);
`, { mode: 0o755 });
  try {
    process.env.PATH = `${bin}${path.delimiter}${oldPath || ''}`;
    process.env.LGVS_REWORD_REAL_GIT = realGit;
    process.env.LGVS_REWORD_ARGV_AUDIT = audit;
    const result = await fn(audit);
    return { result, argv: fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [] };
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldRealGit === undefined) delete process.env.LGVS_REWORD_REAL_GIT; else process.env.LGVS_REWORD_REAL_GIT = oldRealGit;
    if (oldAudit === undefined) delete process.env.LGVS_REWORD_ARGV_AUDIT; else process.env.LGVS_REWORD_ARGV_AUDIT = oldAudit;
    cleanup(bin);
  }
}

function assertBlocked(outcome, reason, fragment) {
  assert.equal(outcome.kind, 'blocked');
  assert.equal(outcome.reason, reason);
  if (fragment) assert.match(outcome.message, fragment);
}

(async () => {
  await test('configured r is isolated to top-level Local Commits, uses the existing commitAction message, and removes HEAD-only confirmation wording', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const security = fs.readFileSync(securityPath, 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitReword.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitReword'"), 'extension.ts must delegate selected-commit Reword behavior to the bounded module');
    assert(config.includes("renameCommit: 'r'"), 'the default must remain lazygit keybinding.commits.renameCommit = r');
    assert(extension.includes("this.commitRewordItem(key(k.renameCommit) || 'r')"), 'the catalog must use configured renameCommit rather than a HEAD-only command');
    assert(extension.includes("!${this.commitFilesFor ? 'true' : 'false'}&&hit(e,u.remove,c.squashDown") && extension.includes('c.renameCommit,c.amendToCommit'), 'only the top-level Commits keyboard route may promote configured r into existing commitAction');
    assert(!extension.includes("${this.commitFilesFor ? 'true' : 'false'}&&hit(e,u.remove,c.renameCommit"), 'Commit-files must not promote top-level Reword');
    assert(!extension.includes('Reword HEAD commit'), 'misleading HEAD-only catalog/title/confirmation wording must be gone');
    assert(!extension.includes("dangerousGitMenuItem({ key: key(k.renameCommit)"), 'Reword r must not add a destructive confirmation wrapper');
    assert(extension.includes('prompt: async (title, initialSummary) => vscode.window.showInputBox({ title, value: initialSummary'), 'the existing commitAction route must open one native summary InputBox');
    assert(extension.includes('isLocalCommits: !this.commitListForBranch'), 'branch-scoped Commits views must be rejected rather than treated as Local Commits');
    assert(security.includes("'commitAction'"), 'existing strict commitAction validation must remain available');
    assert(!security.includes("'rewordCommit'"), 'Reword must not add a second webview message type');
    assert(extension.trimEnd().split(/\r?\n/).length < 1800, 'extension.ts must stay below the 1800-line controller ceiling');

    assert.equal(REWORD_COMMIT_TITLE, 'Reword commit');
    assert.equal(REWORDING_STATUS, 'Rewording');
    assert(model.includes("['show', '-s', '--format=%B'"), 'full captured %B must be read before the native summary prompt');
    assert(model.includes("action: 'edit'") && model.includes('keepEmpty: false'), 'non-HEAD Reword must use typed edit rebase without --keep-empty');
    assert(model.includes("temporaryDirectoryPrefix: 'lazygitvs-reword-'"), 'non-HEAD Reword must use a dedicated private editor namespace');
    assert(!model.includes('CommitFile') && !model.includes("'--', filePath"), 'Reword has no path-scoped semantics');
    assert(readme.includes('partial Commits Reword parity'), 'README must call this bounded selected-commit behavior partial parity');
    assert(keybindingAudit.includes('configured `keybinding.commits.renameCommit`') && keybindingAudit.includes('partial Reword parity'), 'the keybinding audit must document configured r and its bounds');
    assert(parity.includes('Bounded partial Reword slice') && parity.includes('Reword/amend selected non-HEAD'), 'the gap report must replace the old HEAD-only gap honestly');
  });

  await test('HEAD Reword uses the exact native title/initial summary/status and direct amend argv while preserving the captured body', async () => {
    const fixture = createLinearFixture('lgvs-reword-head-', {
      headSubject: 'head original',
      headBody: 'Body line 1\nBody λ',
    });
    try {
      const states = [];
      const prompts = [];
      const audited = await withGitArgAudit(async () => {
        const item = commitRewordMenuItem({
          key: 'r',
          repoPath: fixture.dir,
          visibleHashes: fixture.visible,
          selectedIndex: 0,
          range: { mode: 'none' },
          isLocalCommits: true,
          prompt: async (title, initialSummary) => {
            prompts.push({ title, initialSummary });
            return 'head renamed';
          },
          onStatus: status => states.push(status),
        });
        await item.run();
      });
      assert.deepEqual(prompts, [{ title: 'Reword commit', initialSummary: 'head original' }]);
      assert.deepEqual(states, ['Rewording', ''], 'status starts only after post-input revalidation and clears after success');
      assert.equal(git(fixture.dir, 'log', '-1', '--format=%s').trim(), 'head renamed');
      assert.equal(commitPayload(fixture.dir), 'head renamed\n\nBody line 1\nBody λ\n', 'the unedited remaining body must survive byte-semantically apart from Git message framing');
      const amendCommands = audited.argv.filter(args => args[0] === 'commit' && args.includes('--amend'));
      assert.deepEqual(amendCommands, [[
        'commit', '--allow-empty', '--amend', '--only', '-m', 'head renamed', '-m', '\nBody line 1\nBody λ\n',
      ]], 'HEAD must use direct exact amend argv and never open an interactive rebase');
      assert.deepEqual(rewordAmendArgs('head renamed', '\nBody line 1\nBody λ\n'), amendCommands[0]);
      assert.equal(detectGitOperationState(fixture.dir), undefined);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('Reword replays a selected middle commit and an ordinary root through the bounded edit rebase', async () => {
    const middle = createLinearFixture('lgvs-reword-middle-', { middleBody: 'middle body\nsecond body line' });
    try {
      const beforeHead = middle.head;
      const outcome = await reword(middle.dir, middle.visible, 1, { summary: 'middle renamed' });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.startIndex, 1, 'the controller may retain the former visible index after rewritten hashes change');
      assert.notEqual(git(middle.dir, 'rev-parse', 'HEAD').trim(), beforeHead, 'descendants must be replayed rather than only changing HEAD metadata');
      assert.equal(git(middle.dir, 'log', '-1', '--format=%s').trim(), 'head original');
      const rewrittenMiddle = git(middle.dir, 'log', '--format=%H%x09%s').split('\n').map(line => line.split('\t')).find(([, subject]) => subject === 'middle renamed')[0];
      assert.equal(commitPayload(middle.dir, rewrittenMiddle), 'middle renamed\n\nmiddle body\nsecond body line\n');
      assert.equal(fs.readFileSync(path.join(middle.dir, 'middle.txt'), 'utf8'), 'middle\n');
      assert.equal(git(middle.dir, 'status', '--porcelain=v1', '--untracked-files=all'), '');
    } finally {
      cleanup(middle.dir);
    }

    const rootFixture = initRepo('lgvs-reword-root-');
    try {
      const rootCommit = commit(rootFixture, 'root original', { 'root.txt': 'root\n' }, { body: 'root body' });
      commit(rootFixture, 'child', { 'child.txt': 'child\n' });
      const outcome = await reword(rootFixture, [short(rootFixture, 'HEAD'), short(rootFixture, rootCommit)], 1, { summary: 'root renamed' });
      assert.equal(outcome.kind, 'success');
      assert.equal(git(rootFixture, 'log', '-1', '--format=%s').trim(), 'child');
      const rewrittenRoot = git(rootFixture, 'log', '--format=%H%x09%s').split('\n').map(line => line.split('\t')).find(([, subject]) => subject === 'root renamed')[0];
      assert.equal(commitPayload(rootFixture, rewrittenRoot), 'root renamed\n\nroot body\n');
      assert.equal(fs.readFileSync(path.join(rootFixture, 'root.txt'), 'utf8'), 'root\n');
      assert.equal(fs.readFileSync(path.join(rootFixture, 'child.txt'), 'utf8'), 'child\n');
      assert.equal(detectGitOperationState(rootFixture), undefined);
    } finally {
      cleanup(rootFixture);
    }
  });

  await test('an intentional empty selected commit survives Reword because amend permits an empty tree', async () => {
    const dir = initRepo('lgvs-reword-empty-');
    try {
      const base = commit(dir, 'base', { 'base.txt': 'base\n' });
      const empty = commit(dir, 'empty original', {}, { allowEmpty: true, body: 'empty body' });
      const head = commit(dir, 'head', { 'head.txt': 'head\n' });
      const outcome = await reword(dir, [short(dir, head), short(dir, empty), short(dir, base)], 1, { summary: 'empty renamed' });
      assert.equal(outcome.kind, 'success');
      assert.equal(git(dir, 'rev-list', '--count', 'HEAD').trim(), '3', 'the selected empty commit must not silently disappear');
      const rewritten = git(dir, 'log', '--format=%H%x09%s').split('\n').map(line => line.split('\t')).find(([, subject]) => subject === 'empty renamed')[0];
      assert.equal(commitPayload(dir, rewritten), 'empty renamed\n\nempty body\n');
      assert.equal(git(dir, 'diff-tree', '--no-commit-id', '--name-only', '-r', rewritten), '');
    } finally {
      cleanup(dir);
    }
  });

  await test('cancellation, a visual range, and post-input repository drift are read-only before Rewording starts', async () => {
    const cancelled = createLinearFixture('lgvs-reword-cancel-');
    try {
      const before = snapshot(cancelled.dir);
      let starts = 0;
      const outcome = await reword(cancelled.dir, cancelled.visible, 1, {
        prompt: async () => undefined,
        onStart: () => { starts += 1; },
      });
      assert.equal(outcome.kind, 'cancelled');
      assert.equal(starts, 0);
      assert.deepEqual(snapshot(cancelled.dir), before);
    } finally {
      cleanup(cancelled.dir);
    }

    const range = createLinearFixture('lgvs-reword-range-');
    try {
      const before = snapshot(range.dir);
      const outcome = await reword(range.dir, range.visible, 1, {
        range: { mode: 'sticky', anchor: 0 },
        prompt: async () => { throw new Error('visual ranges must be rejected before prompt'); },
      });
      assertBlocked(outcome, 'multiple-commits', /one selected commit|range/i);
      assert.deepEqual(snapshot(range.dir), before);
    } finally {
      cleanup(range.dir);
    }

    const drift = createLinearFixture('lgvs-reword-drift-');
    try {
      const beforeHead = git(drift.dir, 'rev-parse', 'HEAD').trim();
      let starts = 0;
      const outcome = await reword(drift.dir, drift.visible, 1, {
        prompt: async () => { commit(drift.dir, 'post-input drift', { 'drift.txt': 'drift\n' }); return 'middle renamed'; },
        onStart: () => { starts += 1; },
      });
      assertBlocked(outcome, 'drift', /changed while .*input|changed while prompt/i);
      assert.equal(starts, 0, 'drift must be rejected before the Rewording status/mutation boundary');
      assert.notEqual(git(drift.dir, 'rev-parse', 'HEAD').trim(), beforeHead);
      assert.equal(detectGitOperationState(drift.dir), undefined);
    } finally {
      cleanup(drift.dir);
    }

    const messageDrift = createLinearFixture('lgvs-reword-message-drift-');
    try {
      let starts = 0;
      const outcome = await reword(messageDrift.dir, messageDrift.visible, 1, {
        prompt: async () => {
          const tree = git(messageDrift.dir, 'rev-parse', `${messageDrift.middle}^{tree}`).trim();
          const parent = git(messageDrift.dir, 'rev-parse', `${messageDrift.middle}^`).trim();
          const replacement = git(messageDrift.dir, 'commit-tree', tree, '-p', parent, '-m', 'externally replaced message').trim();
          git(messageDrift.dir, 'replace', messageDrift.middle, replacement);
          return 'middle renamed';
        },
        onStart: () => { starts += 1; },
      });
      assertBlocked(outcome, 'drift', /changed while .*input|changed while prompt/i);
      assert.equal(starts, 0, 'a changed %B for the same resolved hash must fail before Rewording starts');
      assert.equal(git(messageDrift.dir, 'show', '-s', '--format=%s', messageDrift.middle).trim(), 'externally replaced message');
      assert.equal(detectGitOperationState(messageDrift.dir), undefined);
    } finally {
      cleanup(messageDrift.dir);
    }
  });

  await test('dirty trees, active operations, detached HEAD, branch views, unreachable commits, merges, and GPG signing all fail closed before prompt', async () => {
    for (const dirtyKind of ['staged', 'unstaged', 'untracked']) {
      const fixture = createLinearFixture(`lgvs-reword-dirty-${dirtyKind}-`);
      try {
        if (dirtyKind === 'staged') { write(fixture.dir, 'staged.txt', 'staged\n'); git(fixture.dir, 'add', 'staged.txt'); }
        if (dirtyKind === 'unstaged') write(fixture.dir, 'shared.txt', 'dirty\n');
        if (dirtyKind === 'untracked') write(fixture.dir, 'untracked.txt', 'untracked\n');
        const before = snapshot(fixture.dir);
        const outcome = await reword(fixture.dir, fixture.visible, 1, { prompt: async () => { throw new Error(`${dirtyKind} must not prompt`); } });
        assertBlocked(outcome, 'dirty-worktree');
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
        const outcome = await reword(fixture.dir, [short(fixture.dir, 'HEAD')], 0, { prompt: async () => { throw new Error(`${kind} must not prompt`); } });
        assertBlocked(outcome, 'active-operation');
        assert.deepEqual(snapshot(fixture.dir), before);
      } finally {
        fixture.abort();
        cleanup(fixture.dir);
      }
    }

    const guarded = createLinearFixture('lgvs-reword-context-guards-');
    try {
      const localBefore = snapshot(guarded.dir);
      assertBlocked(await reword(guarded.dir, guarded.visible, 1, { isLocalCommits: false, prompt: async () => { throw new Error('branch view must not prompt'); } }), 'branch-view');
      assert.deepEqual(snapshot(guarded.dir), localBefore);

      const branch = git(guarded.dir, 'branch', '--show-current').trim();
      git(guarded.dir, 'checkout', '-b', 'other', guarded.base);
      const other = commit(guarded.dir, 'other', { 'other.txt': 'other\n' });
      git(guarded.dir, 'checkout', branch);
      assertBlocked(await reword(guarded.dir, [short(guarded.dir, other)], 0, { prompt: async () => { throw new Error('unreachable must not prompt'); } }), 'unreachable');

      git(guarded.dir, 'checkout', '--detach');
      const detachedBefore = snapshot(guarded.dir);
      assertBlocked(await reword(guarded.dir, [short(guarded.dir, 'HEAD')], 0, { prompt: async () => { throw new Error('detached must not prompt'); } }), 'detached-head');
      assert.deepEqual(snapshot(guarded.dir), detachedBefore);
    } finally {
      cleanup(guarded.dir);
    }

    const merge = initRepo('lgvs-reword-merge-');
    try {
      const base = commit(merge, 'base', { 'base.txt': 'base\n' });
      const branch = git(merge, 'branch', '--show-current').trim();
      git(merge, 'checkout', '-b', 'side');
      commit(merge, 'side', { 'side.txt': 'side\n' });
      git(merge, 'checkout', branch);
      commit(merge, 'main', { 'main.txt': 'main\n' });
      git(merge, 'merge', '--no-ff', 'side', '-m', 'merge side');
      const mergeCommit = git(merge, 'rev-parse', 'HEAD').trim();
      assertBlocked(await reword(merge, [short(merge, mergeCommit), short(merge, base)], 0, { prompt: async () => { throw new Error('merge must not prompt'); } }), 'merge-commit');
    } finally {
      cleanup(merge);
    }

    const gpg = createLinearFixture('lgvs-reword-gpg-');
    try {
      git(gpg.dir, 'config', 'commit.gpgSign', 'true');
      assertBlocked(await reword(gpg.dir, gpg.visible, 1, { prompt: async () => { throw new Error('GPG must not prompt'); } }), 'gpg-signing');
    } finally {
      cleanup(gpg.dir);
    }
  });

  await test('a real replay conflict stays active for Status recovery and git rebase --abort restores the complete snapshot', async () => {
    const dir = initRepo('lgvs-reword-conflict-');
    try {
      const base = commit(dir, 'base', { 'shared.txt': 'base\n' });
      const branch = git(dir, 'branch', '--show-current').trim();
      git(dir, 'checkout', '-b', 'conflict-side');
      commit(dir, 'side', { 'shared.txt': 'side\n' });
      git(dir, 'checkout', branch);
      const target = commit(dir, 'target', { 'shared.txt': 'target\n' });
      const selected = commit(dir, 'selected original', { 'selected.txt': 'selected\n' }, { body: 'selected body' });
      const dependent = commit(dir, 'dependent', { 'dependent.txt': 'dependent\n' });
      git(dir, 'config', 'rebase.instructionFormat', '%s%nexec git merge conflict-side');
      const before = snapshot(dir);
      const outcome = await reword(dir, [short(dir, dependent), short(dir, selected), short(dir, target), short(dir, base)], 1, { summary: 'selected renamed' });
      assert.equal(outcome.kind, 'rebase-active');
      assert.match(outcome.message, /Status|rebas|merg/i);
      assert(detectGitOperationState(dir), 'the conflict must remain visible to Status recovery');
      assert(fs.existsSync(path.join(dir, '.git', 'rebase-merge')), 'the generated exec must retain the underlying interactive rebase');
      assert.match(git(dir, 'status', '--porcelain=v1'), /UU shared\.txt/);
      git(dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(dir), before, 'real Git abort must restore branch, tree, refs, status, and original history exactly');
    } finally {
      cleanup(dir);
    }
  });

  await test('a non-operation rebase-start failure cleans the private 0700 editor, while a HEAD amend failure clears Rewording and surfaces its exact error', async () => {
    const nonHead = createLinearFixture('lgvs-reword-editor-failure-');
    const privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-reword-editor-audit-'));
    const audit = path.join(privateTmp, 'editor-audit.txt');
    const previousTmpdir = process.env.TMPDIR;
    const previousAudit = process.env.LGVS_REWORD_AUDIT;
    try {
      process.env.TMPDIR = privateTmp;
      process.env.LGVS_REWORD_AUDIT = audit;
      const hook = path.join(nonHead.dir, '.git', 'hooks', 'pre-rebase');
      fs.writeFileSync(hook, '#!/bin/sh\nfor d in "$TMPDIR"/lazygitvs-reword-*; do\n  if [ -d "$d" ]; then stat -c "%a" "$d" > "$LGVS_REWORD_AUDIT"; stat -c "%a" "$d/sequence-editor" >> "$LGVS_REWORD_AUDIT"; fi\ndone\necho reword pre-rebase refusal >&2\nexit 17\n', { mode: 0o755 });
      await assert.rejects(() => reword(nonHead.dir, nonHead.visible, 1, { summary: 'middle renamed' }), /reword pre-rebase refusal/i);
      assert.match(fs.readFileSync(audit, 'utf8'), /^700\n700\n?$/, 'the live private directory and sequence-editor executable must both be 0700');
      assert.deepEqual(fs.readdirSync(privateTmp), ['editor-audit.txt'], 'the private sequence editor must be deleted after a no-operation failure');
      assert.equal(detectGitOperationState(nonHead.dir), undefined);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmpdir;
      if (previousAudit === undefined) delete process.env.LGVS_REWORD_AUDIT; else process.env.LGVS_REWORD_AUDIT = previousAudit;
      cleanup(privateTmp);
      cleanup(nonHead.dir);
    }

    const head = createLinearFixture('lgvs-reword-amend-failure-');
    try {
      const before = snapshot(head.dir);
      const hook = path.join(head.dir, '.git', 'hooks', 'pre-commit');
      fs.writeFileSync(hook, '#!/bin/sh\necho reword amend refusal >&2\nexit 19\n', { mode: 0o755 });
      const states = [];
      const item = commitRewordMenuItem({
        key: 'r',
        repoPath: head.dir,
        visibleHashes: head.visible,
        selectedIndex: 0,
        range: { mode: 'none' },
        isLocalCommits: true,
        prompt: async () => 'head renamed',
        onStatus: status => states.push(status),
      });
      await assert.rejects(() => item.run(), /reword amend refusal/i);
      assert.deepEqual(states, ['Rewording', ''], 'a direct amend failure with no operation must clear transient Rewording');
      assert.equal(detectGitOperationState(head.dir), undefined);
      assert.deepEqual(snapshot(head.dir), before);
    } finally {
      cleanup(head.dir);
    }
  });

  await test('captured repository input isolates two repositories and the shared Drop/Squash/Fixup runner contract remains unchanged', async () => {
    const first = createLinearFixture('lgvs-reword-first-repo-');
    const second = createLinearFixture('lgvs-reword-second-repo-');
    try {
      const secondBefore = snapshot(second.dir);
      const outcome = await reword(first.dir, first.visible, 1, { summary: 'first middle renamed' });
      assert.equal(outcome.kind, 'success');
      assert(git(first.dir, 'log', '--format=%s').split('\n').includes('first middle renamed'));
      assert.deepEqual(snapshot(second.dir), secondBefore, 'only the explicitly captured repository may be rewritten');
      assert.deepEqual(INTERACTIVE_REBASE_ARGS, ['rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges'], 'Reword must use keepEmpty:false locally and must not regress shared Drop/Squash/Fixup argv');
    } finally {
      cleanup(first.dir);
      cleanup(second.dir);
    }
  });

  if (!process.exitCode) console.log('commitReword tests passed');
})();
