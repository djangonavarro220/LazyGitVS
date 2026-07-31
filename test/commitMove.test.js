const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitMove.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const readmePath = path.join(root, 'README.md');
const auditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Commits move down/up must live in a small compiled commitMove module.');

const {
  CANNOT_MOVE_ANY_FURTHER,
  MOVE_COMMIT_DOWN_LABEL,
  MOVE_COMMIT_UP_LABEL,
  MOVE_REBASE_ARGS,
  MOVING_STATUS,
  commitMoveMenuItem,
  moveSelectedCommits,
  rewriteMoveTodo,
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

function firstParent(dir) {
  const output = git(dir, 'rev-list', '--first-parent', 'HEAD').trim();
  return output ? output.split('\n') : [];
}

function firstParentSubjects(dir) {
  const output = git(dir, 'log', '--first-parent', '--format=%s').trim();
  return output ? output.split('\n') : [];
}

function snapshot(dir) {
  return {
    branch: git(dir, 'branch', '--show-current').trim(),
    head: git(dir, 'rev-parse', 'HEAD').trim(),
    tree: git(dir, 'rev-parse', 'HEAD^{tree}').trim(),
    status: git(dir, 'status', '--porcelain=v1', '--untracked-files=all'),
    cached: git(dir, 'diff', '--cached', '--binary'),
    working: git(dir, 'diff', '--binary'),
    firstParent: firstParent(dir),
    log: git(dir, 'log', '--format=%H%x09%P%x09%B'),
    refs: git(dir, 'show-ref'),
  };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function privateEditorDirectories(directory = os.tmpdir()) {
  return fs.readdirSync(directory).filter(name => name.startsWith('lazygitvs-move-')).sort();
}

function visibleFirstParent(dir) {
  return firstParent(dir).map(hash => short(dir, hash));
}

function move(dir, visibleHashes, selectedIndex, direction, options = {}) {
  return moveSelectedCommits({
    repoPath: dir,
    visibleHashes,
    selectedIndex,
    range: options.range || { mode: 'none' },
    direction,
    isLocalCommits: options.isLocalCommits !== false,
    onStart: options.onStart,
  });
}

function createLinearFixture(prefix = 'lgvs-move-linear-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n', 'shared.txt': 'base\n' });
  const older = commit(dir, 'older', { 'older.txt': 'older\n' });
  const middle = commit(dir, 'middle', { 'middle.txt': 'middle\n' });
  const newer = commit(dir, 'newer', { 'newer.txt': 'newer\n' });
  const head = commit(dir, 'head', { 'head.txt': 'head\n' });
  return { dir, base, older, middle, newer, head, visible: [short(dir, head), short(dir, newer), short(dir, middle), short(dir, older), short(dir, base)] };
}

function createRangeFixture(prefix = 'lgvs-move-range-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', { 'base.txt': 'base\n' });
  const older = commit(dir, 'older', { 'older.txt': 'older\n' });
  const oldestSelected = commit(dir, 'oldest selected', { 'oldest.txt': 'oldest\n' });
  const newestSelected = commit(dir, 'newest selected', { 'newest.txt': 'newest\n' });
  const newer = commit(dir, 'newer', { 'newer.txt': 'newer\n' });
  const head = commit(dir, 'head', { 'head.txt': 'head\n' });
  return {
    dir,
    base,
    older,
    oldestSelected,
    newestSelected,
    newer,
    head,
    visible: [short(dir, head), short(dir, newer), short(dir, newestSelected), short(dir, oldestSelected), short(dir, older), short(dir, base)],
  };
}

function createActiveOperationFixture(kind) {
  const dir = initRepo(`lgvs-move-active-${kind}-`);
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

async function withGitWrapper(prefix, source, envNames, fn) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const wrapper = path.join(bin, 'git');
  const realGit = cp.execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const previousPath = process.env.PATH;
  const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  fs.writeFileSync(wrapper, source, { mode: 0o755 });
  try {
    process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
    process.env.LGVS_MOVE_REAL_GIT = realGit;
    return await fn(bin);
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    delete process.env.LGVS_MOVE_REAL_GIT;
    cleanup(bin);
  }
}

async function withGitArgAudit(fn) {
  return withGitWrapper('lgvs-move-git-wrapper-', `#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
fs.appendFileSync(process.env.LGVS_MOVE_ARGV_AUDIT, JSON.stringify({
  args: process.argv.slice(2),
  sequenceEditor: process.env.GIT_SEQUENCE_EDITOR,
  editor: process.env.GIT_EDITOR,
  lang: process.env.LANG,
  lcAll: process.env.LC_ALL,
  lcMessages: process.env.LC_MESSAGES,
}) + '\\n');
const result = cp.spawnSync(process.env.LGVS_MOVE_REAL_GIT, process.argv.slice(2), { stdio: 'inherit', env: process.env });
process.exit(typeof result.status === 'number' ? result.status : 1);
`, ['LGVS_MOVE_ARGV_AUDIT'], async bin => {
    const audit = path.join(bin, 'argv.jsonl');
    process.env.LGVS_MOVE_ARGV_AUDIT = audit;
    const result = await fn();
    return {
      result,
      calls: fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [],
    };
  });
}

async function withSecondStatusHeadDrift(fn) {
  return withGitWrapper('lgvs-move-drift-wrapper-', `#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
const args = process.argv.slice(2);
const counter = process.env.LGVS_MOVE_DRIFT_COUNTER;
if (args[0] === 'status' && counter) {
  const count = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  fs.writeFileSync(counter, String(count + 1));
  if (count === 1) {
    const drift = cp.spawnSync(process.env.LGVS_MOVE_REAL_GIT, ['commit', '--allow-empty', '-m', 'external drift'], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, GIT_EDITOR: 'true' } });
    if (drift.status !== 0) process.exit(typeof drift.status === 'number' ? drift.status : 1);
  }
}
const result = cp.spawnSync(process.env.LGVS_MOVE_REAL_GIT, args, { stdio: 'inherit', env: process.env });
process.exit(typeof result.status === 'number' ? result.status : 1);
`, ['LGVS_MOVE_DRIFT_COUNTER'], async bin => {
    process.env.LGVS_MOVE_DRIFT_COUNTER = path.join(bin, 'status-count');
    return fn();
  });
}

function assertBlocked(outcome, reason, fragment) {
  assert.equal(outcome.kind, 'blocked');
  assert.equal(outcome.reason, reason);
  if (fragment) assert.match(outcome.message, fragment);
}

(async () => {
  await test('configured Ctrl+J/Ctrl+K stays only on top-level Local Commits and documents bounded move parity', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitMove.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const audit = fs.readFileSync(auditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitMove'"), 'extension.ts must delegate bounded move behavior to commitMove.ts');
    assert(config.includes("moveDownCommit: '<ctrl+j>'") && config.includes("moveUpCommit: '<ctrl+k>'"), 'the defaults must match lazygit keybinding.commits.moveDownCommit/moveUpCommit');
    assert(extension.includes("key: key(k.moveDownCommit) || '<ctrl+j>'") && extension.includes("key: key(k.moveUpCommit) || '<ctrl+k>'"), 'the Commits catalog must use both configured move keys');
    assert(extension.includes('c.moveDownCommit,c.moveUpCommit'), 'only the top-level commitAction webview route may own the configured move keys');
    assert(extension.includes('moveAction') && extension.includes('this.commitFilesController.commit) return'), 'Commit-files must never run a top-level move action');
    assert(extension.includes("if(panel==='hunks'&&hit(e,u.select,u.togglePanel,u.remove"), 'Files/Hunks must retain their own routes');
    assert.equal(extension.trimEnd().split(/\r?\n/).length < 1800, true, 'extension.ts must remain under the controller ceiling');

    assert.equal(MOVING_STATUS, 'Moving');
    assert.equal(MOVE_COMMIT_DOWN_LABEL, 'Move commit down one');
    assert.equal(MOVE_COMMIT_UP_LABEL, 'Move commit up one');
    assert.equal(CANNOT_MOVE_ANY_FURTHER, 'Cannot move any further');
    assert.deepEqual(MOVE_REBASE_ARGS, ['rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges']);
    assert(model.includes("GIT_EDITOR: 'true'") && model.includes('GIT_SEQUENCE_EDITOR') && model.includes('0o700'), 'moves require a private noninteractive 0700 sequence editor');
    assert(model.includes("LANG: 'C'") && model.includes("LC_ALL: 'C'") && model.includes("LC_MESSAGES: 'C'"), 'moves must use a stable C locale');
    assert(model.includes("cp.execFile('git'"), 'moves must invoke Git with execFile argv, never a shell');
    assert(!model.includes('confirm:') && !model.includes('createTerminal'), 'moves must start without a confirmation or terminal');
    assert(readme.includes('partial Commits move down/up parity'), 'README must describe move as bounded partial parity');
    assert(audit.includes('configured `keybinding.commits.moveDownCommit`') && audit.includes('configured `keybinding.commits.moveUpCommit`'), 'keybinding audit must document both configured move keys');
    assert(parity.includes('Bounded partial Move down/up slice') && parity.includes('Move commit down/up `<ctrl+j>` / `<ctrl+k>`'), 'gap report must replace the stale move gap honestly');
  });

  await test('the dedicated todo transformer swaps only the selected pick block with one adjacent ordinary pick and fails closed', () => {
    const destination = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const oldest = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const newest = 'cccccccccccccccccccccccccccccccccccccccc';
    const after = 'dddddddddddddddddddddddddddddddddddddddd';
    const downTodo = [
      '# header remains byte-for-byte\r\n',
      `pick ${destination.slice(0, 12)} destination\n`,
      'exec echo destination-directive\n',
      `pick ${oldest.slice(0, 12)} oldest selected\n`,
      'label untouched\n',
      `pick ${newest.slice(0, 12)} newest selected\n`,
      'update-ref refs/heads/topic\n',
      `pick ${after.slice(0, 12)} after\n`,
    ].join('');
    assert.equal(rewriteMoveTodo(downTodo, [newest, oldest], destination, 'down'), [
      '# header remains byte-for-byte\r\n',
      `pick ${oldest.slice(0, 12)} oldest selected\n`,
      'exec echo destination-directive\n',
      `pick ${newest.slice(0, 12)} newest selected\n`,
      'label untouched\n',
      `pick ${destination.slice(0, 12)} destination\n`,
      'update-ref refs/heads/topic\n',
      `pick ${after.slice(0, 12)} after\n`,
    ].join(''));

    const upTodo = [
      `pick ${oldest} oldest selected\n`,
      '# preserve this comment\n',
      `pick ${newest} newest selected\n`,
      'reset keep\n',
      `pick ${destination} destination\n`,
      'merge -C eeeeeee side # untouched\n',
    ].join('');
    assert.equal(rewriteMoveTodo(upTodo, [newest.slice(0, 12), oldest.slice(0, 12)], destination.slice(0, 12), 'up'), [
      `pick ${destination} destination\n`,
      '# preserve this comment\n',
      `pick ${oldest} oldest selected\n`,
      'reset keep\n',
      `pick ${newest} newest selected\n`,
      'merge -C eeeeeee side # untouched\n',
    ].join(''), 'full and abbreviated hashes must map one-to-one');
    assert.throws(() => rewriteMoveTodo(`${downTodo}pick ${oldest.slice(0, 12)} duplicate\n`, [newest, oldest], destination, 'down'), /exactly one|duplicate/i);
    assert.throws(() => rewriteMoveTodo(downTodo, [newest, oldest], after, 'down'), /adjacent|destination/i);
    assert.throws(() => rewriteMoveTodo(downTodo, [newest, newest], destination, 'down'), /duplicate/i);
    assert.throws(() => rewriteMoveTodo(downTodo.replace(`pick ${oldest.slice(0, 12)}`, `fixup ${oldest.slice(0, 12)}`), [newest, oldest], destination, 'down'), /exactly one|pick/i);
  });

  await test('single selected commit moves exactly one rendered position down and up through real Git', async () => {
    const down = createLinearFixture('lgvs-move-single-down-');
    try {
      const before = firstParent(down.dir);
      const outcome = await move(down.dir, down.visible, 2, 'down');
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.delta, 1);
      assert.equal(outcome.selectedIndex, 3);
      assert.deepEqual(outcome.range, { mode: 'none' });
      assert.deepEqual(outcome.beforeFirstParent, before);
      assert.deepEqual(outcome.afterFirstParent, firstParent(down.dir));
      assert.deepEqual(firstParentSubjects(down.dir), ['head', 'newer', 'older', 'middle', 'base']);
      assert.equal(git(down.dir, 'status', '--porcelain=v1', '--untracked-files=all'), '');
      assert.equal(detectGitOperationState(down.dir), undefined);
    } finally {
      cleanup(down.dir);
    }

    const up = createLinearFixture('lgvs-move-single-up-');
    try {
      const outcome = await move(up.dir, up.visible, 2, 'up');
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.delta, -1);
      assert.equal(outcome.selectedIndex, 1);
      assert.deepEqual(outcome.range, { mode: 'none' });
      assert.deepEqual(firstParentSubjects(up.dir), ['head', 'middle', 'newer', 'older', 'base']);
      assert.equal(git(up.dir, 'status', '--porcelain=v1', '--untracked-files=all'), '');
    } finally {
      cleanup(up.dir);
    }
  });

  await test('a contiguous visible range moves as one block in both directions and preserves its range shape', async () => {
    const down = createRangeFixture('lgvs-move-range-down-');
    try {
      const outcome = await move(down.dir, down.visible, 2, 'down', { range: { mode: 'sticky', anchor: 3 } });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.delta, 1);
      assert.equal(outcome.selectedIndex, 3);
      assert.deepEqual(outcome.range, { mode: 'sticky', anchor: 4 });
      assert.deepEqual(firstParentSubjects(down.dir), ['head', 'newer', 'older', 'newest selected', 'oldest selected', 'base']);
    } finally {
      cleanup(down.dir);
    }

    const up = createRangeFixture('lgvs-move-range-up-');
    try {
      const outcome = await move(up.dir, up.visible, 2, 'up', { range: { mode: 'nonsticky', anchor: 3 } });
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.delta, -1);
      assert.equal(outcome.selectedIndex, 1);
      assert.deepEqual(outcome.range, { mode: 'nonsticky', anchor: 2 });
      assert.deepEqual(firstParentSubjects(up.dir), ['head', 'newest selected', 'oldest selected', 'newer', 'older', 'base']);
    } finally {
      cleanup(up.dir);
    }
  });

  await test('HEAD and root boundaries use the right base/--root argv and retain intentional empty commits', async () => {
    const head = createLinearFixture('lgvs-move-head-down-');
    try {
      const outcome = await move(head.dir, head.visible, 0, 'down');
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.selectedIndex, 1);
      assert.deepEqual(firstParentSubjects(head.dir), ['newer', 'head', 'middle', 'older', 'base']);
    } finally {
      cleanup(head.dir);
    }

    const root = initRepo('lgvs-move-root-down-');
    try {
      const rootHash = commit(root, 'root', { 'root.txt': 'root\n' });
      const middle = commit(root, 'middle', { 'middle.txt': 'middle\n' });
      const headHash = commit(root, 'head', { 'head.txt': 'head\n' });
      const visible = [short(root, headHash), short(root, middle), short(root, rootHash)];
      const audited = await withGitArgAudit(() => move(root, visible, 1, 'down'));
      assert.equal(audited.result.kind, 'success');
      assert.deepEqual(audited.calls.filter(call => call.args[0] === 'rebase').map(call => call.args), [[
        'rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges', '--root',
      ]], 'moving down across a root destination must use --root exactly once');
      assert.deepEqual(firstParentSubjects(root), ['head', 'root', 'middle']);
    } finally {
      cleanup(root);
    }

    const empty = initRepo('lgvs-move-empty-');
    try {
      const base = commit(empty, 'base', { 'base.txt': 'base\n' });
      const older = commit(empty, 'older', { 'older.txt': 'older\n' });
      const selected = commit(empty, 'intentional empty', {}, { allowEmpty: true });
      const headHash = commit(empty, 'head', { 'head.txt': 'head\n' });
      const outcome = await move(empty, [short(empty, headHash), short(empty, selected), short(empty, older), short(empty, base)], 1, 'down');
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(firstParentSubjects(empty), ['head', 'older', 'intentional empty', 'base']);
    } finally {
      cleanup(empty);
    }
  });

  await test('no-autosquash preserves fixup-looking subjects and Git updateRefs may follow rewritten commits', async () => {
    const fixup = initRepo('lgvs-move-fixup-subject-');
    try {
      const base = commit(fixup, 'base', { 'base.txt': 'base\n' });
      const target = commit(fixup, 'target', { 'target.txt': 'target\n' });
      const destination = commit(fixup, 'bridge', { 'bridge.txt': 'bridge\n' });
      const selected = commit(fixup, 'fixup! target', { 'fixup.txt': 'fixup\n' });
      const head = commit(fixup, 'head', { 'head.txt': 'head\n' });
      const outcome = await move(fixup, [short(fixup, head), short(fixup, selected), short(fixup, destination), short(fixup, target), short(fixup, base)], 1, 'down');
      assert.equal(outcome.kind, 'success');
      assert.deepEqual(firstParentSubjects(fixup), ['head', 'bridge', 'fixup! target', 'target', 'base']);
      assert.equal(fs.readFileSync(path.join(fixup, 'fixup.txt'), 'utf8'), 'fixup\n');
    } finally {
      cleanup(fixup);
    }

    const refs = createLinearFixture('lgvs-move-update-refs-');
    try {
      git(refs.dir, 'config', 'rebase.updateRefs', 'true');
      git(refs.dir, 'branch', 'bookmark-middle', refs.middle);
      const beforeBookmark = git(refs.dir, 'rev-parse', 'bookmark-middle').trim();
      const outcome = await move(refs.dir, refs.visible, 2, 'up');
      assert.equal(outcome.kind, 'success');
      const afterBookmark = git(refs.dir, 'rev-parse', 'bookmark-middle').trim();
      assert.notEqual(afterBookmark, beforeBookmark, 'rebase.updateRefs must be allowed to follow a rewritten move target');
      assert.equal(afterBookmark, outcome.afterFirstParent[outcome.selectedIndex + 1], 'the untouched update-ref directive must remain attached to its original todo position');
    } finally {
      cleanup(refs.dir);
    }
  });

  await test('all bounded guards reject before Moving or mutation', async () => {
    for (const kind of ['staged', 'unstaged', 'untracked']) {
      const fixture = createLinearFixture(`lgvs-move-dirty-${kind}-`);
      try {
        if (kind === 'staged') { write(fixture.dir, 'staged.txt', 'staged\n'); git(fixture.dir, 'add', 'staged.txt'); }
        if (kind === 'unstaged') write(fixture.dir, 'shared.txt', 'unstaged\n');
        if (kind === 'untracked') write(fixture.dir, 'untracked.txt', 'untracked\n');
        const before = snapshot(fixture.dir);
        let starts = 0;
        assertBlocked(await move(fixture.dir, fixture.visible, 2, 'down', { onStart: () => { starts += 1; } }), 'dirty-worktree');
        assert.equal(starts, 0);
        assert.deepEqual(snapshot(fixture.dir), before);
      } finally {
        cleanup(fixture.dir);
      }
    }

    const guarded = createLinearFixture('lgvs-move-context-');
    try {
      const before = snapshot(guarded.dir);
      let starts = 0;
      assertBlocked(await move(guarded.dir, guarded.visible, 2, 'down', { isLocalCommits: false, onStart: () => { starts += 1; } }), 'branch-view');
      assertBlocked(await move(guarded.dir, guarded.visible, guarded.visible.length - 1, 'down'), 'boundary', /Cannot move any further/i);
      assertBlocked(await move(guarded.dir, guarded.visible, 0, 'up'), 'boundary', /Cannot move any further/i);
      assertBlocked(await move(guarded.dir, guarded.visible, 99, 'down'), 'empty-selection');
      assertBlocked(await move(guarded.dir, [guarded.visible[0], guarded.visible[1], guarded.visible[1], guarded.visible[3]], 1, 'down', { range: { mode: 'sticky', anchor: 2 } }), 'invalid-selection');
      assertBlocked(await move(guarded.dir, [guarded.visible[0], guarded.visible[3], guarded.visible[4]], 0, 'down'), 'unsupported-history', /first-parent|linear|unfiltered/i);
      assert.equal(starts, 0);
      assert.deepEqual(snapshot(guarded.dir), before);

      git(guarded.dir, 'config', 'commit.gpgSign', 'true');
      assertBlocked(await move(guarded.dir, guarded.visible, 2, 'down'), 'gpg-signing');
      git(guarded.dir, 'config', '--unset', 'commit.gpgSign');

      const branch = git(guarded.dir, 'branch', '--show-current').trim();
      git(guarded.dir, 'checkout', '-b', 'other', guarded.base);
      const unreachable = commit(guarded.dir, 'unreachable', { 'unreachable.txt': 'unreachable\n' });
      git(guarded.dir, 'checkout', branch);
      assertBlocked(await move(guarded.dir, [short(guarded.dir, unreachable), guarded.visible[1]], 0, 'down'), 'unreachable');
      git(guarded.dir, 'checkout', '--detach');
      const detachedBefore = snapshot(guarded.dir);
      assertBlocked(await move(guarded.dir, [short(guarded.dir, 'HEAD'), guarded.visible[1]], 0, 'down'), 'detached-head');
      assert.deepEqual(snapshot(guarded.dir), detachedBefore);
    } finally {
      cleanup(guarded.dir);
    }

    const merge = initRepo('lgvs-move-merge-guards-');
    try {
      const base = commit(merge, 'base', { 'base.txt': 'base\n' });
      const branch = git(merge, 'branch', '--show-current').trim();
      git(merge, 'checkout', '-b', 'side');
      commit(merge, 'side', { 'side.txt': 'side\n' });
      git(merge, 'checkout', branch);
      const main = commit(merge, 'main', { 'main.txt': 'main\n' });
      git(merge, 'merge', '--no-ff', 'side', '-m', 'merge side');
      const mergeHash = git(merge, 'rev-parse', 'HEAD').trim();
      const after = commit(merge, 'after', { 'after.txt': 'after\n' });
      const visible = visibleFirstParent(merge);
      const before = snapshot(merge);
      assertBlocked(await move(merge, visible, 0, 'down'), 'merge-commit', /merge/i);
      assertBlocked(await move(merge, visible, 1, 'down'), 'merge-commit', /merge/i);
      assert.deepEqual(snapshot(merge), before);
      assert.equal(visible[1], short(merge, mergeHash));
      assert.equal(visible[2], short(merge, main));
      assert.equal(visible[visible.length - 1], short(merge, base));
      assert.equal(visible[0], short(merge, after));
      const nonlinear = git(merge, 'log', '--format=%h').trim().split('\n');
      assertBlocked(await move(merge, nonlinear, 0, 'down'), 'unsupported-history', /first-parent|linear|unfiltered/i);
    } finally {
      cleanup(merge);
    }

    for (const kind of ['merge', 'rebase', 'cherry-pick', 'revert']) {
      const fixture = createActiveOperationFixture(kind);
      try {
        assert.equal(detectGitOperationState(fixture.dir).kind, kind, `${kind} fixture must create a real operation`);
        const before = snapshot(fixture.dir);
        let starts = 0;
        assertBlocked(await move(fixture.dir, [short(fixture.dir, 'HEAD'), short(fixture.dir, 'HEAD^')], 0, 'down', { onStart: () => { starts += 1; } }), 'active-operation');
        assert.equal(starts, 0);
        assert.deepEqual(snapshot(fixture.dir), before);
      } finally {
        fixture.abort();
        cleanup(fixture.dir);
      }
    }
  });

  await test('the immediate second full preflight blocks drift before Moving or rebase spawn', async () => {
    const fixture = createLinearFixture('lgvs-move-drift-');
    try {
      let starts = 0;
      const outcome = await withSecondStatusHeadDrift(() => move(fixture.dir, fixture.visible, 2, 'down', { onStart: () => { starts += 1; } }));
      assertBlocked(outcome, 'drift', /changed before Move|changed/i);
      assert.equal(starts, 0, 'the status must not enter Moving for a drifted second preflight');
      assert.equal(git(fixture.dir, 'log', '-1', '--format=%s').trim(), 'external drift');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('a real replay conflict remains active for Status recovery and abort restores the exact snapshot', async () => {
    const dir = initRepo('lgvs-move-conflict-');
    try {
      const base = commit(dir, 'base', { 'shared.txt': 'base\n' });
      const destination = commit(dir, 'destination', { 'shared.txt': 'destination\n' });
      const selected = commit(dir, 'selected', { 'shared.txt': 'selected\n' });
      const head = commit(dir, 'head', { 'head.txt': 'head\n' });
      const visible = [short(dir, head), short(dir, selected), short(dir, destination), short(dir, base)];
      const before = snapshot(dir);
      const states = [];
      const item = commitMoveMenuItem({
        repoPath: dir,
        visibleHashes: visible,
        selectedIndex: 1,
        range: { mode: 'none' },
        direction: 'down',
        isLocalCommits: true,
        key: '<ctrl+j>',
        onStatus: status => states.push(status),
      });
      await item.run();
      assert.deepEqual(states.slice(0, 1), ['Moving']);
      assert.match(states[1], /Status|rebase/i);
      assert.equal(detectGitOperationState(dir).kind, 'rebase');
      assert.match(git(dir, 'status', '--porcelain=v1'), /UU shared\.txt/);
      git(dir, 'rebase', '--abort');
      assert.deepEqual(snapshot(dir), before, 'real abort must restore the complete pre-move snapshot');
    } finally {
      cleanup(dir);
    }
  });

  await test('a no-operation failure exposes its exact error, clears Moving, and always removes the private 0700 editor', async () => {
    const fixture = createLinearFixture('lgvs-move-hook-failure-');
    const privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-move-editor-audit-'));
    const audit = path.join(privateTmp, 'editor-audit.txt');
    const previousTmpdir = process.env.TMPDIR;
    const previousAudit = process.env.LGVS_MOVE_AUDIT;
    try {
      process.env.TMPDIR = privateTmp;
      process.env.LGVS_MOVE_AUDIT = audit;
      const hook = path.join(fixture.dir, '.git', 'hooks', 'pre-rebase');
      fs.writeFileSync(hook, '#!/bin/sh\nfor d in "$TMPDIR"/lazygitvs-move-*; do\n  if [ -d "$d" ]; then stat -c "%a" "$d" > "$LGVS_MOVE_AUDIT"; stat -c "%a" "$d/sequence-editor" >> "$LGVS_MOVE_AUDIT"; fi\ndone\necho move hook refusal >&2\nexit 17\n', { mode: 0o755 });
      const states = [];
      const item = commitMoveMenuItem({
        repoPath: fixture.dir,
        visibleHashes: fixture.visible,
        selectedIndex: 2,
        range: { mode: 'none' },
        direction: 'down',
        isLocalCommits: true,
        key: '<ctrl+j>',
        onStatus: status => states.push(status),
      });
      await assert.rejects(() => item.run(), /move hook refusal/i);
      assert.deepEqual(states, ['Moving', ''], 'only a no-operation failure clears transient Moving');
      assert.match(fs.readFileSync(audit, 'utf8'), /^700\n700\n?$/, 'the live private editor directory and executable must both be 0700');
      assert.deepEqual(fs.readdirSync(privateTmp), ['editor-audit.txt'], 'the private sequence editor must be deleted after failure');
      assert.equal(detectGitOperationState(fixture.dir), undefined);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmpdir;
      if (previousAudit === undefined) delete process.env.LGVS_MOVE_AUDIT; else process.env.LGVS_MOVE_AUDIT = previousAudit;
      cleanup(privateTmp);
      cleanup(fixture.dir);
    }
  });

  await test('the exact native argv, editor environment, result metadata, and mutation remain isolated to the captured repository', async () => {
    const target = createLinearFixture('lgvs-move-argv-target-');
    const untouched = createLinearFixture('lgvs-move-argv-untouched-');
    try {
      const untouchedBefore = snapshot(untouched.dir);
      const audited = await withGitArgAudit(() => move(target.dir, target.visible, 2, 'up'));
      assert.equal(audited.result.kind, 'success');
      assert.equal(audited.result.delta, -1);
      assert.equal(audited.result.selectedIndex, 1);
      assert.deepEqual(audited.result.range, { mode: 'none' });
      const rebaseCalls = audited.calls.filter(call => call.args[0] === 'rebase');
      assert.deepEqual(rebaseCalls.map(call => call.args), [[
        'rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges', target.older,
      ]], 'up must use the selected oldest parent as the exact native base argv');
      assert.equal(rebaseCalls.length, 1, 'one requested move means one real interactive rebase');
      assert.equal(rebaseCalls[0].editor, 'true');
      assert.equal(rebaseCalls[0].lang, 'C');
      assert.equal(rebaseCalls[0].lcAll, 'C');
      assert.equal(rebaseCalls[0].lcMessages, 'C');
      assert.match(rebaseCalls[0].sequenceEditor, /lazygitvs-move-.*\/sequence-editor$/, 'the rebase must use the dedicated private editor, not a shell command');
      assert.deepEqual(snapshot(untouched.dir), untouchedBefore, 'a second repository must remain byte-for-byte untouched');
    } finally {
      cleanup(target.dir);
      cleanup(untouched.dir);
    }
  });

  if (!process.exitCode) console.log('commitMove tests passed');
})();
