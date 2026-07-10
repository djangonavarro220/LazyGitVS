const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { cleanupFixture, git, initRepo } = require('./helpers/gitFixtures');
const {
  findReflogAction,
  performReflogAction,
  readReflog,
  reflogActionPrompt,
} = require('../out/undoRedo');

function commit(dir, message, content = message) {
  fs.writeFileSync(path.join(dir, 'tracked.txt'), `${content}\n`);
  git(dir, 'add', 'tracked.txt');
  git(dir, 'commit', '-m', message);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

async function test(name, fn) {
  let dir;
  try {
    dir = initRepo('lgvs-undo-redo-');
    await fn(dir);
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stderr || error.stdout || error);
    process.exitCode = 1;
  } finally {
    cleanupFixture(dir);
  }
}

(async () => {
  await test('undo commit uses a confirmed soft reset and redo uses a confirmed hard reset', async dir => {
    const first = commit(dir, 'first');
    const second = commit(dir, 'second');
    const undo = findReflogAction(await readReflog(dir), 'undo');
    assert.deepStrictEqual(undo, { kind: 'commit', from: first, to: second });
    assert.strictEqual(reflogActionPrompt(undo, 'undo'), `Are you sure you want to soft reset to '${first.slice(0, 8)}'?`);

    let confirmed = false;
    await performReflogAction(dir, undo, 'undo', async prompt => {
      confirmed = true;
      assert.strictEqual(prompt, reflogActionPrompt(undo, 'undo'));
      return true;
    });
    assert.strictEqual(confirmed, true);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD').trim(), first);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8'), 'second\n', 'soft reset must preserve commit changes');
    assert.match(git(dir, 'reflog', '-1', '--format=%gs').trim(), /^\[lazygit undo\]: updating HEAD$/);

    const redo = findReflogAction(await readReflog(dir), 'redo');
    assert.deepStrictEqual(redo, { kind: 'commit', from: first, to: second });
    assert.strictEqual(reflogActionPrompt(redo, 'redo'), `Are you sure you want to hard reset to '${second.slice(0, 8)}'? An auto-stash will be performed if necessary.`);
    await performReflogAction(dir, redo, 'redo', async () => true);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD').trim(), second);
    assert.match(git(dir, 'reflog', '-1', '--format=%gs').trim(), /^\[lazygit redo\]: updating HEAD$/);
  });

  await test('cancelling undo leaves HEAD, index, worktree, stash and reflog unchanged', async dir => {
    commit(dir, 'first');
    commit(dir, 'second');
    fs.appendFileSync(path.join(dir, 'tracked.txt'), 'local\n');
    git(dir, 'add', 'tracked.txt');
    fs.appendFileSync(path.join(dir, 'tracked.txt'), 'worktree\n');
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'keep\n');
    const before = {
      head: git(dir, 'rev-parse', 'HEAD'),
      status: git(dir, 'status', '--porcelain=v1'),
      stash: git(dir, 'stash', 'list'),
      reflog: git(dir, 'reflog', '--format=%H %gs'),
      content: fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8'),
    };
    const action = findReflogAction(await readReflog(dir), 'undo');
    assert(action);
    const changed = await performReflogAction(dir, action, 'undo', async () => false);
    assert.strictEqual(changed, false);
    assert.deepStrictEqual({
      head: git(dir, 'rev-parse', 'HEAD'),
      status: git(dir, 'status', '--porcelain=v1'),
      stash: git(dir, 'stash', 'list'),
      reflog: git(dir, 'reflog', '--format=%H %gs'),
      content: fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8'),
    }, before);
  });

  await test('undo and redo stop safely at reflog limits', async dir => {
    const only = commit(dir, 'only');
    const entries = await readReflog(dir);
    assert.strictEqual(findReflogAction(entries, 'undo'), undefined, 'root commit has no safe previous commit');
    assert.strictEqual(findReflogAction(entries, 'redo'), undefined);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD').trim(), only);

    commit(dir, 'second');
    const undo = findReflogAction(await readReflog(dir), 'undo');
    await performReflogAction(dir, undo, 'undo', async () => true);
    assert.strictEqual(findReflogAction(await readReflog(dir), 'undo'), undefined);
    const redo = findReflogAction(await readReflog(dir), 'redo');
    await performReflogAction(dir, redo, 'redo', async () => true);
    assert.strictEqual(findReflogAction(await readReflog(dir), 'redo'), undefined);
  });

  await test('checkout undo and redo switch the original branches with lazygit reflog markers', async dir => {
    commit(dir, 'base');
    git(dir, 'checkout', '-b', 'feature');
    commit(dir, 'feature commit');
    git(dir, 'checkout', 'master');
    const undo = findReflogAction(await readReflog(dir), 'undo');
    assert.deepStrictEqual(undo, { kind: 'checkout', from: 'feature', to: 'master' });
    await performReflogAction(dir, undo, 'undo', async () => true);
    assert.strictEqual(git(dir, 'branch', '--show-current').trim(), 'feature');
    const redo = findReflogAction(await readReflog(dir), 'redo');
    assert.deepStrictEqual(redo, { kind: 'checkout', from: 'feature', to: 'master' });
    await performReflogAction(dir, redo, 'redo', async () => true);
    assert.strictEqual(git(dir, 'branch', '--show-current').trim(), 'master');
  });

  await test('checkout autostash uses upstream second confirmation and cancellation does not mutate', async dir => {
    commit(dir, 'base', 'base');
    git(dir, 'checkout', '-b', 'feature');
    commit(dir, 'feature change', 'feature');
    git(dir, 'checkout', 'master');
    fs.writeFileSync(path.join(dir, 'tracked.txt'), 'local conflict\n');
    const before = {
      branch: git(dir, 'branch', '--show-current'),
      status: git(dir, 'status', '--porcelain=v1'),
      reflog: git(dir, 'reflog', '--format=%H %gs'),
      content: fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8'),
    };
    const action = findReflogAction(await readReflog(dir), 'undo');
    const prompts = [];
    const changed = await performReflogAction(dir, action, 'undo', async (prompt, title) => {
      prompts.push({ prompt, title });
      return title === 'Undo';
    });
    assert.strictEqual(changed, false);
    assert.deepStrictEqual(prompts, [
      { prompt: "Are you sure you want to checkout 'feature'? An auto-stash will be performed if necessary.", title: 'Undo' },
      { prompt: 'You must stash and pop your changes to bring them across. Do this automatically? (enter/esc)', title: 'Autostash?' },
    ]);
    assert.deepStrictEqual({
      branch: git(dir, 'branch', '--show-current'),
      status: git(dir, 'status', '--porcelain=v1'),
      reflog: git(dir, 'reflog', '--format=%H %gs'),
      content: fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8'),
    }, before);
  });

  await test('hard redo auto-stashes tracked changes, preserves untracked files, and restores tracked changes', async dir => {
    fs.writeFileSync(path.join(dir, 'local.txt'), 'base\n');
    git(dir, 'add', 'local.txt');
    commit(dir, 'first');
    commit(dir, 'second');
    const undo = findReflogAction(await readReflog(dir), 'undo');
    await performReflogAction(dir, undo, 'undo', async () => true);
    fs.appendFileSync(path.join(dir, 'local.txt'), 'local tracked\n');
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'local untracked\n');
    const redo = findReflogAction(await readReflog(dir), 'redo');
    await performReflogAction(dir, redo, 'redo', async () => true);
    assert.match(fs.readFileSync(path.join(dir, 'local.txt'), 'utf8'), /local tracked/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'untracked.txt'), 'utf8'), 'local untracked\n');
    assert.strictEqual(git(dir, 'stash', 'list').trim(), '');
  });

  await test('an action in one repository cannot mutate another repository', async dir => {
    commit(dir, 'primary first');
    const primaryHead = commit(dir, 'primary second');
    const other = initRepo('lgvs-undo-redo-other-');
    try {
      commit(other, 'other first');
      const otherHead = commit(other, 'other second');
      const action = findReflogAction(await readReflog(dir), 'undo');
      await performReflogAction(dir, action, 'undo', async () => true);
      assert.notStrictEqual(git(dir, 'rev-parse', 'HEAD').trim(), primaryHead);
      assert.strictEqual(git(other, 'rev-parse', 'HEAD').trim(), otherHead);
    } finally {
      cleanupFixture(other);
    }
  });

  await test('merge, rebase, cherry-pick and revert states block undo and redo before prompting', async dir => {
    commit(dir, 'first');
    commit(dir, 'second');
    const gitDir = git(dir, 'rev-parse', '--git-dir').trim();
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', path.join('rebase-merge', 'head-name')]) {
      const markerPath = path.join(dir, gitDir, marker);
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(markerPath, 'fixture\n');
      let prompts = 0;
      const action = findReflogAction(await readReflog(dir), 'undo');
      await assert.rejects(() => performReflogAction(dir, action, 'undo', async () => { prompts++; return true; }), /Can't undo while rebasing/);
      assert.strictEqual(prompts, 0);
      fs.rmSync(markerPath, { force: true });
      if (marker.includes('rebase-merge')) fs.rmSync(path.dirname(markerPath), { recursive: true, force: true });
    }
  });
})();
