const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitAutosquash.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Apply fixup commits must live in a small compiled commitAutosquash module.');

const {
  APPLY_FIXUP_COMMITS_MENU_ITEMS,
  APPLY_FIXUP_COMMITS_TITLE,
  AUTOSQUASH_REBASE_ARGS,
  SQUASHING_STATUS,
  applyFixupCommitsAboveSelected,
  chooseApplyFixupCommitsAction,
  commitAutosquashMenuItem,
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
  const args = ['commit', ...(options.allowEmpty ? ['--allow-empty'] : []), '-m', subject];
  if (options.body !== undefined) args.push('-m', options.body);
  git(dir, ...args);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

function short(dir, ref) {
  return git(dir, 'rev-parse', '--short', ref).trim();
}

function firstParent(dir) {
  const raw = git(dir, 'rev-list', '--first-parent', 'HEAD').trim();
  return raw ? raw.split('\n') : [];
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
    firstParent: firstParent(dir),
    refs: git(dir, 'show-ref'),
  };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function autosquash(dir, visibleHashes, selectedIndex, options = {}) {
  return applyFixupCommitsAboveSelected({
    repoPath: dir,
    visibleHashes,
    selectedIndex,
    range: options.range || { mode: 'none' },
    isLocalCommits: options.isLocalCommits !== false,
    chooseAction: options.chooseAction || (async () => options.action === undefined ? 'a' : options.action),
    onStart: options.onStart,
  });
}

function createAutosquashFixture(prefix = 'lgvs-autosquash-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n' });
  const target = commit(dir, 'target subject', { 'target.txt': 'target\n' }, { body: 'target body' });
  const ordinary = commit(dir, 'ordinary descendant', { 'ordinary.txt': 'ordinary\n' });
  const fixup = commit(dir, 'fixup! target subject', { 'fixup.txt': 'fixup\n' });
  const unrelated = commit(dir, 'fixup! absent subject', { 'unrelated.txt': 'unrelated\n' });
  const squash = commit(dir, 'squash! target subject', { 'squash.txt': 'squash\n' }, { body: 'squash body' });
  const head = commit(dir, 'head descendant', { 'head.txt': 'head\n' });
  return {
    dir,
    base,
    target,
    ordinary,
    fixup,
    unrelated,
    squash,
    head,
    visible: [short(dir, head), short(dir, squash), short(dir, unrelated), short(dir, fixup), short(dir, ordinary), short(dir, target), short(dir, base)],
  };
}

function createActiveOperationFixture(kind) {
  const dir = initRepo(`lgvs-autosquash-active-${kind}-`);
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
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-autosquash-git-wrapper-'));
  const audit = path.join(bin, 'argv.jsonl');
  const wrapper = path.join(bin, 'git');
  const realGit = cp.execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const previousPath = process.env.PATH;
  const previousRealGit = process.env.LGVS_AUTOSQUASH_REAL_GIT;
  const previousAudit = process.env.LGVS_AUTOSQUASH_ARGV_AUDIT;
  fs.writeFileSync(wrapper, `#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
fs.appendFileSync(process.env.LGVS_AUTOSQUASH_ARGV_AUDIT, JSON.stringify({
  args: process.argv.slice(2),
  sequenceEditor: process.env.GIT_SEQUENCE_EDITOR,
  editor: process.env.GIT_EDITOR,
  lang: process.env.LANG,
  lcAll: process.env.LC_ALL,
  lcMessages: process.env.LC_MESSAGES,
}) + '\\n');
const result = cp.spawnSync(process.env.LGVS_AUTOSQUASH_REAL_GIT, process.argv.slice(2), { stdio: 'inherit', env: process.env });
process.exit(typeof result.status === 'number' ? result.status : 1);
`, { mode: 0o755 });
  try {
    process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
    process.env.LGVS_AUTOSQUASH_REAL_GIT = realGit;
    process.env.LGVS_AUTOSQUASH_ARGV_AUDIT = audit;
    const result = await fn();
    const calls = fs.existsSync(audit)
      ? fs.readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : [];
    return { result, calls };
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousRealGit === undefined) delete process.env.LGVS_AUTOSQUASH_REAL_GIT; else process.env.LGVS_AUTOSQUASH_REAL_GIT = previousRealGit;
    if (previousAudit === undefined) delete process.env.LGVS_AUTOSQUASH_ARGV_AUDIT; else process.env.LGVS_AUTOSQUASH_ARGV_AUDIT = previousAudit;
    cleanup(bin);
  }
}

function assertBlocked(outcome, reason, fragment) {
  assert.equal(outcome.kind, 'blocked');
  assert.equal(outcome.reason, reason);
  if (fragment) assert.match(outcome.message, fragment);
}

(async () => {
  await test('configured S opens only the exact native Apply fixup commits a menu from top-level Commits', async () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitAutosquash.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitAutosquash'"), 'extension.ts must delegate Apply fixup commits to the bounded module');
    assert(config.includes("squashAboveCommits: 'S'"), 'the default must remain lazygit keybinding.commits.squashAboveCommits = S');
    assert(extension.includes("key: key(k.squashAboveCommits) || 'S'"), 'Commits must read configured squashAboveCommits instead of inventing a new setting');
    assert(extension.includes('c.squashAboveCommits'), 'the existing top-level commitAction allowlist must explicitly own configured S');
    assert(extension.includes('autosquashAction') && extension.includes('this.commitFilesController.commit) return;'), 'Commit-files must never run configured S');
    assert(!extension.includes("panel==='hunks'&&hit(e,u.select,u.togglePanel,u.remove,c.squashAboveCommits"), 'Hunks must retain their own actions and never route S to autosquash');
    assert(model.includes("APPLY_FIXUP_COMMITS_TITLE = 'Apply fixup commits'"), 'the native menu title must match upstream English exactly');
    assert(model.includes("SQUASHING_STATUS = 'Squashing'"), 'the transient mutation status must match upstream English exactly');
    assert(model.includes("GIT_SEQUENCE_EDITOR: 'true'") && model.includes("GIT_EDITOR: 'true'"), 'autosquash must use Git skipped editors rather than a terminal or private todo transformer');
    assert(model.includes("LANG: 'C'") && model.includes("LC_ALL: 'C'") && model.includes("LC_MESSAGES: 'C'"), 'autosquash must force a stable C locale');
    assert(model.includes("cp.execFile('git'"), 'autosquash must execute Git through execFile argv, never a shell');
    assert(!model.includes('runSelectedCommitRebase') && !model.includes('rewriteSelectedPickTodo'), 'autosquash must not reuse selected-todo rebase semantics');
    assert(!model.includes('confirm:'), 'menu selection is the sole consent boundary; no second destructive confirmation is allowed');
    assert(!model.includes("key: 'b'"), 'the unsupported current-branch b option must be omitted rather than shown disabled');
    assert.equal(extension.trimEnd().split(/\r?\n/).length < 1800, true, 'extension.ts must stay below the 1800-line controller ceiling');

    assert.equal(APPLY_FIXUP_COMMITS_TITLE, 'Apply fixup commits');
    assert.equal(SQUASHING_STATUS, 'Squashing');
    assert.deepEqual(APPLY_FIXUP_COMMITS_MENU_ITEMS, [{
      key: 'a',
      label: 'Above the selected commit',
      tooltip: "Squash all 'fixup!' commits above the selected commit (autosquash).",
    }]);
    assert.deepEqual(AUTOSQUASH_REBASE_ARGS, ['rebase', '--interactive', '--rebase-merges', '--autostash', '--autosquash']);

    let opened;
    const choice = await chooseApplyFixupCommitsAction(async (title, items) => {
      opened = { title, items: items.map(item => ({ key: item.key, label: item.label, description: item.description })) };
      await items[0].run();
      return true;
    });
    assert.equal(choice, 'a');
    assert.deepEqual(opened, {
      title: 'Apply fixup commits',
      items: [{ key: 'a', label: 'Above the selected commit', description: "Squash all 'fixup!' commits above the selected commit (autosquash)." }],
    }, 'the native picker must expose only upstream-supported a');

    assert(readme.includes('partial Commits Apply fixup commits parity'), 'README must describe the S/a slice as partial parity');
    assert(keybindingAudit.includes('configured `keybinding.commits.squashAboveCommits`') && keybindingAudit.includes('partial Apply fixup commits parity'), 'the keybinding audit must document configured S and its bounds');
    assert(parity.includes('Bounded partial Apply fixup commits slice') && parity.includes('Autosquash/apply fixups `S`'), 'the gap report must replace the old complete S gap honestly');
  });

  await test('autosquash applies real fixup! and squash! commits, leaves unrelated fixups, and returns real first-parent selection recovery', async () => {
    const fixture = createAutosquashFixture('lgvs-autosquash-success-');
    try {
      const states = [];
      const outcomes = [];
      let menuChoices = 0;
      const item = commitAutosquashMenuItem({
        repoPath: fixture.dir,
        visibleHashes: fixture.visible,
        selectedIndex: 5,
        range: { mode: 'none' },
        isLocalCommits: true,
        key: 'S',
        chooseAction: async () => { menuChoices += 1; return 'a'; },
        onStatus: status => states.push(status),
        onSuccess: outcome => outcomes.push(outcome),
      });
      await item.run();

      assert.equal(menuChoices, 1, 'the one allowed menu choice must be requested once after preflight');
      assert.deepEqual(states, ['Squashing', ''], 'Squashing begins only after revalidation and clears after success');
      assert.equal(outcomes.length, 1);
      const outcome = outcomes[0];
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.selectionOffset, 2, 'only real applicable fixup!/squash! rows above the selection move the target upward');
      assert.equal(outcome.selectedIndex, 3, 'selected target moves upward by the real number of removed applicable commits');
      assert.notEqual(outcome.selectedAfterHash, fixture.target, 'success must return the new selected hash rather than retaining the stale old target hash');
      assert.deepEqual(outcome.beforeFirstParent, firstParentFromFixture(fixture), 'the outcome must retain the real before first-parent history captured before mutation');
      assert.deepEqual(outcome.afterFirstParent, firstParent(fixture.dir), 'the outcome must report the actual post-rebase first-parent history');
      assert.equal(outcome.afterFirstParent[outcome.selectedIndex], outcome.selectedAfterHash, 'the returned selection must name the actual refreshed row');
      assert.deepEqual(git(fixture.dir, 'log', '--format=%s', '--first-parent').trim().split('\n'), [
        'head descendant',
        'fixup! absent subject',
        'ordinary descendant',
        'target subject',
        'base',
      ]);
      assert.equal(git(fixture.dir, 'show', '-s', '--format=%B', outcome.selectedAfterHash), 'target subject\n\ntarget body\n\nsquash body\n\n', 'native skipped-editor autosquash preserves Git\'s combined squash message behavior');
      for (const file of ['target.txt', 'ordinary.txt', 'fixup.txt', 'unrelated.txt', 'squash.txt', 'head.txt']) {
        assert(fs.existsSync(path.join(fixture.dir, file)), `${file} must survive the real autosquash tree rewrite`);
      }
      assert.equal(git(fixture.dir, 'status', '--porcelain=v1', '--untracked-files=all'), '');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('the exact native execFile argv uses selected^ or --root with skipped C-locale editors', async () => {
    const normal = createAutosquashFixture('lgvs-autosquash-argv-');
    try {
      const audited = await withGitArgAudit(() => autosquash(normal.dir, normal.visible, 5));
      assert.equal(audited.result.kind, 'success');
      const rebaseCalls = audited.calls.filter(call => call.args[0] === 'rebase');
      assert.deepEqual(rebaseCalls.map(call => call.args), [[
        'rebase', '--interactive', '--rebase-merges', '--autostash', '--autosquash', `${normal.target}^`,
      ]], 'non-root selected commit must use exact upstream selected^ argv in one execFile call');
      assert.deepEqual(rebaseCalls.map(call => ({ sequenceEditor: call.sequenceEditor, editor: call.editor, lang: call.lang, lcAll: call.lcAll, lcMessages: call.lcMessages })), [{
        sequenceEditor: 'true', editor: 'true', lang: 'C', lcAll: 'C', lcMessages: 'C',
      }]);
    } finally {
      cleanup(normal.dir);
    }

    const rootFixture = initRepo('lgvs-autosquash-root-');
    try {
      const rootCommit = commit(rootFixture, 'root target', { 'root.txt': 'root\n' });
      const fixup = commit(rootFixture, 'fixup! root target', { 'fixup.txt': 'fixup\n' });
      const child = commit(rootFixture, 'child', { 'child.txt': 'child\n' });
      const visible = [short(rootFixture, child), short(rootFixture, fixup), short(rootFixture, rootCommit)];
      const audited = await withGitArgAudit(() => autosquash(rootFixture, visible, 2));
      assert.equal(audited.result.kind, 'success');
      assert.equal(audited.result.selectionOffset, 1);
      assert.equal(audited.result.selectedIndex, 1);
      assert.deepEqual(audited.calls.filter(call => call.args[0] === 'rebase').map(call => call.args), [[
        'rebase', '--interactive', '--rebase-merges', '--autostash', '--autosquash', '--root',
      ]], 'a selected root must use --root exactly');
      assert.equal(git(rootFixture, 'log', '--format=%s', '--first-parent').trim(), 'child\nroot target');
      assert(fs.existsSync(path.join(rootFixture, 'fixup.txt')));
    } finally {
      cleanup(rootFixture);
    }
  });

  await test('a no-applicable-fixup run is a safe Git no-op with zero selection offset and no rewritten history', async () => {
    const dir = initRepo('lgvs-autosquash-noop-');
    try {
      const base = commit(dir, 'base', { 'base.txt': 'base\n' });
      const selected = commit(dir, 'selected', { 'selected.txt': 'selected\n' });
      const unrelated = commit(dir, 'fixup! absent target', { 'unrelated.txt': 'unrelated\n' });
      const head = commit(dir, 'head', { 'head.txt': 'head\n' });
      const visible = [short(dir, head), short(dir, unrelated), short(dir, selected), short(dir, base)];
      const before = snapshot(dir);
      const outcome = await autosquash(dir, visible, 2);
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.selectionOffset, 0);
      assert.equal(outcome.selectedIndex, 2);
      assert.equal(outcome.selectedAfterHash, selected, 'a real no-op may retain its still-current selected hash');
      assert.deepEqual(snapshot(dir), before, 'Git must not rewrite any history when no applicable fixup!/squash! target exists');
      assert.deepEqual(outcome.beforeFirstParent, outcome.afterFirstParent);
    } finally {
      cleanup(dir);
    }
  });

  await test('range, non-Local Commits, dirty state, GPG signing, detached HEAD, unreachable, and merge selection all fail before the menu', async () => {
    const range = createAutosquashFixture('lgvs-autosquash-range-');
    try {
      const before = snapshot(range.dir);
      const outcome = await autosquash(range.dir, range.visible, 5, {
        range: { mode: 'sticky', anchor: 4 },
        chooseAction: async () => { throw new Error('a visual range must not open Apply fixup commits'); },
      });
      assertBlocked(outcome, 'multiple-commits', /one selected commit|range/i);
      assert.deepEqual(snapshot(range.dir), before);
    } finally {
      cleanup(range.dir);
    }

    const guarded = createAutosquashFixture('lgvs-autosquash-guards-');
    try {
      const before = snapshot(guarded.dir);
      assertBlocked(await autosquash(guarded.dir, guarded.visible, 5, {
        isLocalCommits: false,
        chooseAction: async () => { throw new Error('branch-scoped Commits must not open the menu'); },
      }), 'branch-view');
      for (const kind of ['staged', 'unstaged', 'untracked']) {
        if (kind === 'staged') { write(guarded.dir, 'staged.txt', 'staged\n'); git(guarded.dir, 'add', 'staged.txt'); }
        if (kind === 'unstaged') write(guarded.dir, 'base.txt', 'modified\n');
        if (kind === 'untracked') write(guarded.dir, 'untracked.txt', 'untracked\n');
        assertBlocked(await autosquash(guarded.dir, guarded.visible, 5, {
          chooseAction: async () => { throw new Error(`${kind} tree must not open the menu`); },
        }), 'dirty-worktree');
        git(guarded.dir, 'reset', '--hard', 'HEAD');
        fs.rmSync(path.join(guarded.dir, 'untracked.txt'), { force: true });
      }
      git(guarded.dir, 'config', 'commit.gpgSign', 'true');
      assertBlocked(await autosquash(guarded.dir, guarded.visible, 5, {
        chooseAction: async () => { throw new Error('GPG signing must fail closed before the menu'); },
      }), 'gpg-signing');
      git(guarded.dir, 'config', '--unset', 'commit.gpgSign');

      const branch = git(guarded.dir, 'branch', '--show-current').trim();
      git(guarded.dir, 'checkout', '-b', 'other', guarded.base);
      const unreachable = commit(guarded.dir, 'unreachable', { 'unreachable.txt': 'unreachable\n' });
      git(guarded.dir, 'checkout', branch);
      assertBlocked(await autosquash(guarded.dir, [short(guarded.dir, unreachable)], 0, {
        chooseAction: async () => { throw new Error('unreachable selection must not open the menu'); },
      }), 'unreachable');
      git(guarded.dir, 'checkout', '--detach');
      assertBlocked(await autosquash(guarded.dir, [short(guarded.dir, 'HEAD')], 0, {
        chooseAction: async () => { throw new Error('detached HEAD must not open the menu'); },
      }), 'detached-head');
      assert.notDeepEqual(snapshot(guarded.dir), before, 'the fixture itself intentionally changed branch topology only; guarded calls remain read-only');
    } finally {
      cleanup(guarded.dir);
    }

    const merge = initRepo('lgvs-autosquash-merge-selection-');
    try {
      const base = commit(merge, 'base', { 'base.txt': 'base\n' });
      const branch = git(merge, 'branch', '--show-current').trim();
      git(merge, 'checkout', '-b', 'side');
      commit(merge, 'side', { 'side.txt': 'side\n' });
      git(merge, 'checkout', branch);
      commit(merge, 'main', { 'main.txt': 'main\n' });
      git(merge, 'merge', '--no-ff', 'side', '-m', 'merge side');
      const mergeCommit = git(merge, 'rev-parse', 'HEAD').trim();
      const before = snapshot(merge);
      const outcome = await autosquash(merge, [short(merge, mergeCommit), short(merge, base)], 0, {
        chooseAction: async () => { throw new Error('merge selection must not open the menu'); },
      });
      assertBlocked(outcome, 'merge-commit');
      assert.deepEqual(snapshot(merge), before);
      const visible = git(merge, 'log', '--format=%h').trim().split('\n');
      assertBlocked(await autosquash(merge, visible, visible.length - 1, {
        chooseAction: async () => { throw new Error('nonlinear history must not open the menu'); },
      }), 'unsupported-history', /linear first-parent/i);
    } finally {
      cleanup(merge);
    }
  });

  await test('all real active Git operations block before the menu and leave their operation untouched', async () => {
    for (const kind of ['merge', 'rebase', 'cherry-pick', 'revert']) {
      const fixture = createActiveOperationFixture(kind);
      try {
        assert.equal(detectGitOperationState(fixture.dir).kind, kind, `${kind} fixture must produce a real active operation`);
        const before = snapshot(fixture.dir);
        const outcome = await autosquash(fixture.dir, [short(fixture.dir, 'HEAD')], 0, {
          chooseAction: async () => { throw new Error(`${kind} must not open the menu`); },
        });
        assertBlocked(outcome, 'active-operation');
        assert.deepEqual(snapshot(fixture.dir), before);
      } finally {
        fixture.abort();
        cleanup(fixture.dir);
      }
    }
  });

  await test('cancellation and every post-menu repository drift stay read-only before Squashing begins', async () => {
    const cancelled = createAutosquashFixture('lgvs-autosquash-cancel-');
    try {
      const before = snapshot(cancelled.dir);
      let starts = 0;
      const outcome = await autosquash(cancelled.dir, cancelled.visible, 5, {
        action: undefined,
        chooseAction: async () => undefined,
        onStart: () => { starts += 1; },
      });
      assert.equal(outcome.kind, 'cancelled');
      assert.equal(starts, 0);
      assert.deepEqual(snapshot(cancelled.dir), before);
    } finally {
      cleanup(cancelled.dir);
    }

    const headDrift = createAutosquashFixture('lgvs-autosquash-head-drift-');
    try {
      let starts = 0;
      const beforeHead = git(headDrift.dir, 'rev-parse', 'HEAD').trim();
      const outcome = await autosquash(headDrift.dir, headDrift.visible, 5, {
        chooseAction: async () => { commit(headDrift.dir, 'menu drift', { 'drift.txt': 'drift\n' }); return 'a'; },
        onStart: () => { starts += 1; },
      });
      assertBlocked(outcome, 'drift', /changed while .*menu/i);
      assert.equal(starts, 0, 'HEAD drift must fail before Squashing/mutation');
      assert.notEqual(git(headDrift.dir, 'rev-parse', 'HEAD').trim(), beforeHead);
      assert.equal(detectGitOperationState(headDrift.dir), undefined);
    } finally {
      cleanup(headDrift.dir);
    }

    const messageDrift = createAutosquashFixture('lgvs-autosquash-message-drift-');
    try {
      let starts = 0;
      const outcome = await autosquash(messageDrift.dir, messageDrift.visible, 5, {
        chooseAction: async () => {
          const tree = git(messageDrift.dir, 'rev-parse', `${messageDrift.target}^{tree}`).trim();
          const parent = git(messageDrift.dir, 'rev-parse', `${messageDrift.target}^`).trim();
          const replacement = git(messageDrift.dir, 'commit-tree', tree, '-p', parent, '-m', 'externally replaced target message').trim();
          git(messageDrift.dir, 'replace', messageDrift.target, replacement);
          return 'a';
        },
        onStart: () => { starts += 1; },
      });
      assertBlocked(outcome, 'drift', /changed while .*menu/i);
      assert.equal(starts, 0, 'same selected object with changed message/order context must fail before Squashing');
      assert.equal(git(messageDrift.dir, 'show', '-s', '--format=%s', messageDrift.target).trim(), 'externally replaced target message');
      assert.equal(detectGitOperationState(messageDrift.dir), undefined);
    } finally {
      cleanup(messageDrift.dir);
    }

    const parentOrderDrift = createAutosquashFixture('lgvs-autosquash-parent-order-drift-');
    try {
      let starts = 0;
      const initialHead = git(parentOrderDrift.dir, 'rev-parse', 'HEAD').trim();
      const initialMessage = git(parentOrderDrift.dir, 'show', '-s', '--format=%B', parentOrderDrift.target);
      const outcome = await autosquash(parentOrderDrift.dir, parentOrderDrift.visible, 5, {
        chooseAction: async () => {
          const tree = git(parentOrderDrift.dir, 'rev-parse', `${parentOrderDrift.target}^{tree}`).trim();
          const alternateRoot = git(parentOrderDrift.dir, 'commit-tree', tree, '-m', 'external alternate root').trim();
          const replacement = git(parentOrderDrift.dir, 'commit-tree', tree, '-p', alternateRoot, '-m', 'target subject', '-m', 'target body').trim();
          git(parentOrderDrift.dir, 'replace', parentOrderDrift.target, replacement);
          return 'a';
        },
        onStart: () => { starts += 1; },
      });
      assertBlocked(outcome, 'drift', /changed while .*menu/i);
      assert.equal(starts, 0, 'parent/first-parent-order drift must fail before Squashing');
      assert.equal(git(parentOrderDrift.dir, 'rev-parse', 'HEAD').trim(), initialHead, 'replacement drift proves HEAD alone is not the sole guard');
      assert.equal(git(parentOrderDrift.dir, 'show', '-s', '--format=%B', parentOrderDrift.target), initialMessage, 'parent/order drift is caught even when the selected message remains unchanged');
      assert.equal(detectGitOperationState(parentOrderDrift.dir), undefined);
    } finally {
      cleanup(parentOrderDrift.dir);
    }
  });

  await test('a real autosquash replay conflict stays active for Status recovery and abort restores the exact snapshot', async () => {
    const dir = initRepo('lgvs-autosquash-conflict-');
    try {
      const base = commit(dir, 'base', { 'shared.txt': 'base\n' });
      const target = commit(dir, 'target', { 'shared.txt': 'target\n' });
      const dependent = commit(dir, 'dependent', { 'shared.txt': 'dependent\n' });
      const fixup = commit(dir, 'fixup! target', { 'shared.txt': 'fixup\n' });
      const visible = [short(dir, fixup), short(dir, dependent), short(dir, target), short(dir, base)];
      const before = snapshot(dir);
      const outcome = await autosquash(dir, visible, 2);
      assert.equal(outcome.kind, 'rebase-active');
      assert.match(outcome.message, /Status|rebas/i);
      assert.equal(detectGitOperationState(dir).kind, 'rebase', 'the failed rebase must remain active for Status continue/skip/abort');
      assert.match(git(dir, 'status', '--porcelain=v1'), /UU shared\.txt/);
      git(dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(dir), before, 'real Git abort must restore branch, refs, worktree, and history exactly');
    } finally {
      cleanup(dir);
    }
  });

  await test('a no-operation rebase failure surfaces Git\'s exact error and always clears Squashing', async () => {
    const fixture = createAutosquashFixture('lgvs-autosquash-hook-failure-');
    try {
      const hook = path.join(fixture.dir, '.git', 'hooks', 'pre-rebase');
      fs.writeFileSync(hook, '#!/bin/sh\necho autosquash hook refusal >&2\nexit 17\n', { mode: 0o755 });
      const states = [];
      const item = commitAutosquashMenuItem({
        repoPath: fixture.dir,
        visibleHashes: fixture.visible,
        selectedIndex: 5,
        range: { mode: 'none' },
        isLocalCommits: true,
        key: 'S',
        chooseAction: async () => 'a',
        onStatus: status => states.push(status),
      });
      await assert.rejects(() => item.run(), /autosquash hook refusal/i);
      assert.deepEqual(states, ['Squashing', ''], 'the exact transient status must clear even when Git fails before starting an operation');
      assert.equal(detectGitOperationState(fixture.dir), undefined, 'the module must not invent or auto-abort an operation');
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('autosquash is isolated to the captured repository path', async () => {
    const target = createAutosquashFixture('lgvs-autosquash-isolation-target-');
    const untouched = createAutosquashFixture('lgvs-autosquash-isolation-untouched-');
    try {
      const beforeUntouched = snapshot(untouched.dir);
      const outcome = await autosquash(target.dir, target.visible, 5);
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(snapshot(untouched.dir), beforeUntouched, 'a second repository must remain byte-for-byte untouched');
      assert.equal(git(target.dir, 'log', '--format=%s', '--first-parent').trim().split('\n').includes('fixup! target subject'), false);
    } finally {
      cleanup(target.dir);
      cleanup(untouched.dir);
    }
  });

  if (!process.exitCode) console.log('commitAutosquash tests passed');
})();

function firstParentFromFixture(fixture) {
  return [fixture.head, fixture.squash, fixture.unrelated, fixture.fixup, fixture.ordinary, fixture.target, fixture.base];
}
