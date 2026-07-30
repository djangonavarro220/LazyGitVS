const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initRepo, git, cleanupFixture } = require('./helpers/gitFixtures');
const { readLazyGitConfig } = require('../out/lazygitConfig');
const {
  BISECT_MENU_TITLE,
  BISECT_RESET_PROMPT,
  buildBisectActions,
  executeBisectAction,
  readBisectInfo,
  runBisectOptions,
  startBisectWithTerms
} = require('../out/bisectOptions');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');
const bisectSource = fs.readFileSync(path.join(root, 'src', 'bisectOptions.ts'), 'utf8');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function createHistory(dir, count = 8) {
  const hashes = [];
  for (let i = 0; i < count; i++) {
    write(path.join(dir, 'history.txt'), `${i}\n`);
    git(dir, 'add', 'history.txt');
    git(dir, 'commit', '-m', `commit ${i}`);
    hashes.push(git(dir, 'rev-parse', 'HEAD').trim());
  }
  return hashes;
}

async function runGit(args, cwd) {
  return cp.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function snapshot(dir) {
  return {
    head: git(dir, 'rev-parse', 'HEAD').trim(),
    status: git(dir, 'status', '--porcelain'),
    bisectLog: (() => {
      try { return git(dir, 'bisect', 'log'); } catch (_) { return ''; }
    })()
  };
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stderr || error.stdout || error);
    process.exitCode = 1;
  }
}

(async () => {
  await test('exact upstream labels, order, menu title, keys, configured route and selection-preserving refresh are guarded', async () => {
    const selected = '0123456789abcdef';
    const startActions = buildBisectActions({ started: false, startHash: '', currentHash: '', newTerm: 'bad', oldTerm: 'good' }, selected);
    assert.equal(BISECT_MENU_TITLE, 'Bisect');
    assert.deepEqual(startActions.map(action => [action.id, action.key, action.label, action.commands || []]), [
      ['start-new', 'b', 'Mark 0123456 as bad (start bisect)', [['bisect', 'start'], ['bisect', 'bad', selected]]],
      ['start-old', 'g', 'Mark 0123456 as good (start bisect)', [['bisect', 'start'], ['bisect', 'good', selected]]],
      ['choose-terms', 't', 'Choose bisect terms', []]
    ], 'the non-bisect menu must preserve the upstream b/g/t ordering and wording');

    const midActions = buildBisectActions({ started: true, startHash: 'start', currentHash: 'fedcba9876543210', newTerm: 'bad', oldTerm: 'good' }, selected);
    assert.deepEqual(midActions.map(action => [action.id, action.key, action.label, action.commands || []]), [
      ['mark-new', 'b', 'Mark current commit (fedcba9) as bad', [['bisect', 'bad', 'fedcba9876543210']]],
      ['mark-old', 'g', 'Mark current commit (fedcba9) as good', [['bisect', 'good', 'fedcba9876543210']]],
      ['skip-current', 's', 'Skip current commit (fedcba9)', [['bisect', 'skip', 'fedcba9876543210']]],
      ['skip-selected', 'S', 'Skip selected commit (0123456)', [['bisect', 'skip', selected]]],
      ['reset', 'r', 'Reset bisect', [['bisect', 'reset']]]
    ], 'the active-bisect menu must preserve the upstream b/g/s/S/r ordering and only include selected skip when it differs from current');
    assert.equal(midActions.at(-1).confirmation, BISECT_RESET_PROMPT);
    assert.equal(BISECT_RESET_PROMPT, "Are you sure you want to reset 'git bisect'?");

    assert(configSource.includes("viewBisectOptions: 'b'"), 'lazygit default keybinding must remain commits.viewBisectOptions=b');
    assert(extension.includes('key(k.viewBisectOptions) || \'b\''), 'the shared Commits command catalog must expose viewBisectOptions');
    assert(extension.includes('c.viewBisectOptions'), 'Commits webview routing must dispatch the configured viewBisectOptions key');
    assert(extension.includes('private async openBisectOptions'), 'the Commits catalog must open one dedicated Bisect QuickPick');
    assert(bisectSource.includes('if (action) finish(action);'), 'typing a non-key in the Bisect QuickPick must keep it open instead of treating filtering as cancellation');
    assert(extension.includes('const repoPath = workspaceRoot();') && extension.includes('git(args, cwd)'), 'the controller must bind argv Git calls to the repository active when the menu opened');
    assert(extension.includes('previousCommitHash'), 'a successful bisect refresh must restore the selected commit by hash before previewing it');
    assert(bisectSource.includes("['bisect', 'start']") && bisectSource.includes("['bisect', 'reset']"), 'bisect operations must stay Git argument arrays, never shell strings');
  });

  await test('LG_CONFIG_FILE changes the Commits bisect-options key without changing the lazygit default', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-bisect-config-'));
    const config = path.join(dir, 'config.yml');
    const previous = process.env.LG_CONFIG_FILE;
    write(config, 'keybinding:\n  commits:\n    viewBisectOptions: x\n');
    process.env.LG_CONFIG_FILE = config;
    try {
      assert.equal(readLazyGitConfig().keymap.commits.viewBisectOptions, 'x');
    } finally {
      if (previous === undefined) delete process.env.LG_CONFIG_FILE;
      else process.env.LG_CONFIG_FILE = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('cancelling the one Bisect QuickPick leaves a real repository and selection operation untouched', async () => {
    const dir = initRepo('lgvs-bisect-picker-cancel-');
    try {
      const hashes = createHistory(dir, 4);
      const calls = [];
      let onChange;
      let onHide;
      const result = await runBisectOptions({
        repoPath: dir,
        selectedHash: hashes.at(-1),
        runGit: async (args, cwd) => { calls.push({ args, cwd }); return runGit(args, cwd); },
        createQuickPick: () => ({
          title: undefined,
          placeholder: undefined,
          items: [],
          activeItems: [],
          selectedItems: [],
          onDidChangeValue: listener => { onChange = listener; return { dispose() {} }; },
          onDidAccept: () => ({ dispose() {} }),
          onDidHide: listener => { onHide = listener; return { dispose() {} }; },
          show: () => { onChange('filter text'); onHide(); },
          hide: () => onHide(),
          dispose() {}
        }),
        showInputBox: async () => { throw new Error('cancelled picker must not request terms'); },
        confirm: async () => { throw new Error('cancelled picker must not ask for confirmation'); }
      });
      assert.equal(result, false);
      assert.equal(calls.filter(call => call.args[0] === 'bisect').length, 0);
      assert.equal((await readBisectInfo(dir, runGit)).started, false);
    } finally {
      cleanupFixture(dir);
    }
  });

  await test('real Git start/mark menu action uses argument arrays, custom terms, reset confirmation and cancellation no-op', async () => {
    const dir = initRepo('lgvs-bisect-start-');
    try {
      const hashes = createHistory(dir);
      const selected = hashes.at(-1);
      const opened = await readBisectInfo(dir, runGit);
      const startBad = buildBisectActions(opened, selected).find(action => action.id === 'start-new');
      const calls = [];
      const recordingGit = async (args, cwd) => {
        calls.push({ args: [...args], cwd });
        return runGit(args, cwd);
      };
      assert.equal(await executeBisectAction({ repoPath: dir, opened, action: startBad, runGit: recordingGit }), true);
      assert.deepEqual(calls.filter(call => call.args[0] === 'bisect').map(call => call.args), [
        ['bisect', 'start'],
        ['bisect', 'bad', selected]
      ], 'start and mark must be two execFile-style argv invocations, not a shell command');
      assert(calls.every(call => call.cwd === dir), 'every state read and mutation must stay on the explicitly active repository');

      const started = await readBisectInfo(dir, runGit);
      assert.equal(started.started, true);
      const reset = buildBisectActions(started, selected).find(action => action.id === 'reset');
      const beforeCancel = snapshot(dir);
      assert.equal(await executeBisectAction({ repoPath: dir, opened: started, action: reset, runGit, confirm: async () => false }), false);
      assert.deepEqual(snapshot(dir), beforeCancel, 'cancelling reset must not mutate Git state');
      assert.equal(await executeBisectAction({ repoPath: dir, opened: started, action: reset, runGit, confirm: async () => true }), true);
      assert.equal((await readBisectInfo(dir, runGit)).started, false, 'confirmed reset must clear the real BISECT_START state');

      const noBisect = await readBisectInfo(dir, runGit);
      assert.equal(await startBisectWithTerms({ repoPath: dir, opened: noBisect, oldTerm: 'fixed', newTerm: 'unfixed', runGit }), true);
      const customTerms = await readBisectInfo(dir, runGit);
      assert.deepEqual([customTerms.oldTerm, customTerms.newTerm], ['fixed', 'unfixed'], 'Choose bisect terms must use upstream --term-old/--term-new semantics');
      const customReset = buildBisectActions(customTerms, selected).find(action => action.id === 'reset');
      assert.equal(await executeBisectAction({ repoPath: dir, opened: customTerms, action: customReset, runGit, confirm: async () => true }), true);
    } finally {
      cleanupFixture(dir);
    }
  });

  await test('active bisect exposes only valid current-state actions and skips the selected commit through real Git', async () => {
    const dir = initRepo('lgvs-bisect-mid-');
    try {
      const hashes = createHistory(dir);
      git(dir, 'bisect', 'start');
      git(dir, 'bisect', 'bad', hashes.at(-1));
      git(dir, 'bisect', 'good', hashes[0]);
      const opened = await readBisectInfo(dir, runGit);
      assert.equal(opened.started, true);
      assert(opened.currentHash, 'a real bad/good range should select a current bisect commit');
      const selected = hashes.find(hash => hash !== opened.currentHash);
      const actions = buildBisectActions(opened, selected);
      assert.deepEqual(actions.map(action => action.key), ['b', 'g', 's', 'S', 'r']);
      assert(!actions.some(action => action.id === 'choose-terms'), 'custom terms are only valid before bisect starts');
      const skipSelected = actions.find(action => action.id === 'skip-selected');
      assert.equal(await executeBisectAction({ repoPath: dir, opened, action: skipSelected, runGit }), true);
      assert.match(git(dir, 'bisect', 'log'), /git bisect skip/, 'selected-commit skip must mutate the real bisect state');
      const afterSkip = await readBisectInfo(dir, runGit);
      const reset = buildBisectActions(afterSkip, selected).find(action => action.id === 'reset');
      assert.equal(await executeBisectAction({ repoPath: dir, opened: afterSkip, action: reset, runGit, confirm: async () => true }), true);
    } finally {
      cleanupFixture(dir);
    }
  });

  await test('a failed start-and-mark rolls back bisect state and leaves the repository unchanged', async () => {
    const dir = initRepo('lgvs-bisect-rollback-');
    try {
      const hashes = createHistory(dir);
      const selected = hashes.at(-1);
      const before = snapshot(dir);
      const opened = await readBisectInfo(dir, runGit);
      const startBad = buildBisectActions(opened, selected).find(action => action.id === 'start-new');
      let markAttempted = false;
      await assert.rejects(
        () => executeBisectAction({
          repoPath: dir,
          opened,
          action: startBad,
          runGit: async (args, cwd) => {
            if (args[0] === 'bisect' && args[1] === 'bad') {
              markAttempted = true;
              throw new Error('forced mark failure');
            }
            return runGit(args, cwd);
          }
        }),
        /forced mark failure/
      );
      assert.equal(markAttempted, true);
      assert.equal((await readBisectInfo(dir, runGit)).started, false, 'failed second step must reset the newly started bisect session');
      assert.deepEqual(snapshot(dir), before, 'an execution error must not leave a started bisect or move HEAD');
    } finally {
      cleanupFixture(dir);
    }
  });

  await test('explicit active repository isolation leaves a second real repository untouched', async () => {
    const primary = initRepo('lgvs-bisect-primary-');
    const secondary = initRepo('lgvs-bisect-secondary-');
    try {
      const primaryHashes = createHistory(primary);
      createHistory(secondary);
      const secondaryBefore = snapshot(secondary);
      const opened = await readBisectInfo(primary, runGit);
      const action = buildBisectActions(opened, primaryHashes.at(-1)).find(item => item.id === 'start-old');
      assert.equal(await executeBisectAction({ repoPath: primary, opened, action, runGit }), true);
      assert.equal((await readBisectInfo(primary, runGit)).started, true);
      assert.equal((await readBisectInfo(secondary, runGit)).started, false);
      assert.deepEqual(snapshot(secondary), secondaryBefore, 'the active repository operation must not touch another workspace repository');
      const reset = buildBisectActions(await readBisectInfo(primary, runGit), primaryHashes.at(-1)).find(item => item.id === 'reset');
      await executeBisectAction({ repoPath: primary, opened: await readBisectInfo(primary, runGit), action: reset, runGit, confirm: async () => true });
    } finally {
      cleanupFixture(primary);
      cleanupFixture(secondary);
    }
  });

  if (!process.exitCode) console.log('bisectOptions tests passed');
})();
