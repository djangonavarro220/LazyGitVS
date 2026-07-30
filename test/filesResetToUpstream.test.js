const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const configSource = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');
const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const gitMenusSource = fs.readFileSync(path.join(root, 'src', 'gitMenus.ts'), 'utf8');
const webviewSecuritySource = fs.readFileSync(path.join(root, 'src', 'webviewSecurity.ts'), 'utf8');
const { readLazyGitConfig } = require('../out/lazygitConfig');
const { resetConfirmation } = require('../out/destructiveActions');

function sh(command, cwd) {
  return cp.execFileSync(command[0], command.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function git(cwd, ...args) {
  return sh(['git', ...args], cwd);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function snapshot(dir) {
  return {
    head: git(dir, 'rev-parse', 'HEAD').trim(),
    status: git(dir, 'status', '--porcelain'),
    cached: git(dir, 'diff', '--cached'),
    worktree: git(dir, 'diff'),
    tracked: fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8')
  };
}

function createTrackingFixture(prefix) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const remote = path.join(rootDir, 'origin.git');
  const repo = path.join(rootDir, 'repo');
  fs.mkdirSync(repo);
  git(rootDir, 'init', '--bare', remote);
  git(repo, 'init');
  git(repo, 'config', 'user.email', 'lgvs@example.test');
  git(repo, 'config', 'user.name', 'LazyGitVS Test');
  write(path.join(repo, 'tracked.txt'), 'upstream base\n');
  git(repo, 'add', 'tracked.txt');
  git(repo, 'commit', '-m', 'upstream base');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'HEAD');
  const upstream = git(repo, 'rev-parse', '@{upstream}').trim();
  write(path.join(repo, 'tracked.txt'), 'local ahead\n');
  git(repo, 'add', 'tracked.txt');
  git(repo, 'commit', '-m', 'local ahead');
  return { rootDir, repo, upstream };
}

function cleanup(fixture) {
  if (fixture?.rootDir) fs.rmSync(fixture.rootDir, { recursive: true, force: true });
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

const originalLoad = Module._load;
let confirmationResponse = 'Run';
let quickPickInput;
const errors = [];
const quickPickTitles = [];
Module._load = function mockVscode(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      window: {
        showWarningMessage: async () => confirmationResponse,
        showInformationMessage: () => undefined,
        showErrorMessage: message => { errors.push(String(message)); return undefined; },
        withProgress: async (_options, task) => task(),
        createQuickPick: () => {
          if (quickPickInput === undefined) throw new Error('a no-upstream reset must not open a menu');
          const changeHandlers = [];
          const acceptHandlers = [];
          const hideHandlers = [];
          const quickPick = {
            title: '', placeholder: '', items: [], selectedItems: [], activeItems: [],
            onDidChangeValue: handler => { changeHandlers.push(handler); return { dispose() {} }; },
            onDidAccept: handler => { acceptHandlers.push(handler); return { dispose() {} }; },
            onDidHide: handler => { hideHandlers.push(handler); return { dispose() {} }; },
            show: () => queueMicrotask(() => changeHandlers.forEach(handler => handler(quickPickInput))),
            hide: () => undefined,
            dispose: () => undefined
          };
          quickPickTitles.push(quickPick);
          return quickPick;
        }
      },
      ProgressLocation: { Notification: 15 }
    };
  }
  return originalLoad.apply(this, arguments);
};

delete require.cache[require.resolve('../out/gitMenus')];
const {
  RESET_TO_UPSTREAM_MENU_TITLE,
  buildResetToUpstreamMenuItems,
  executeGitMenuItem,
  showResetToUpstreamMenu
} = require('../out/gitMenus');

// RED guard: the Files upstream reset catalog is intentionally absent until the feature exists.
assert.equal(typeof buildResetToUpstreamMenuItems, 'function', 'Files upstream reset needs one reusable gitMenus catalog');

(async () => {
  try {
    await test('preserves exact lazygit Files g source routing, configured key, active-repository capture, and focus restoration contracts', async () => {
      assert.match(configSource, /commits:\s*\{[^}]*viewResetOptions: 'g'/, 'default g must come from lazygit keybinding.commits.viewResetOptions');
      assert(!configSource.includes('viewUpstreamResetOptions'), 'LGVS must not invent a Files-only upstream reset config key');
      assert.match(extensionSource, /private filesCommandCatalog\(viewPanel: ViewPanel\): GitMenuItem\[\]\s*\{[\s\S]*?k = this\.lazygitKeymap\.commits;[\s\S]*?key\(k\.viewResetOptions\) \|\| 'g'[\s\S]*?this\.resetToUpstreamMenu\(viewPanel\)/, 'the shared Files command catalog must use commits.viewResetOptions and open the upstream reset menu');
      assert(extensionSource.includes("if(panel==='files'&&hit(e,c.viewResetOptions)){e.preventDefault();vscode.postMessage({type:'resetToUpstreamMenu'});return;}"), 'Files webview g must dispatch the configured commits.viewResetOptions key');
      assert(extensionSource.includes("if (type === 'resetToUpstreamMenu') await this.resetToUpstreamMenu(panel);"), 'the webview message must route through the Files reset-to-upstream controller path');
      assert(webviewSecuritySource.includes("'resetToUpstreamMenu'"), 'the reset-to-upstream webview message must pass the central message allowlist');
      assert.match(extensionSource, /private async resetToUpstreamMenu\(viewPanel: ViewPanel\) \{\s*const repoPath = workspaceRoot\(\);\s*await this\.runMenu\(\(\) => showResetToUpstreamMenu\(repoPath\), viewPanel\);\s*\}/, 'the controller must capture the active repo before opening the menu and use the shared refresh/focus wrapper');
      assert.match(extensionSource, /private async runMenu\([\s\S]*?await this\.refresh\(false\);[\s\S]*?await this\.restorePanelFocusAfterModal\(viewPanel\);/, 'menu completion must retain the standard Files refresh/focus restoration contract');
      assert(extensionSource.includes("const previousPath = this.currentFile()?.path;") && extensionSource.includes("row.file.path === previousPath"), 'refresh must retain the selected Files path when it still exists after reset');
      assert(gitMenusSource.includes("args: ['reset', '--mixed', '@{upstream}']"), 'mixed reset must use an argv array and literal @{upstream}');
      assert(gitMenusSource.includes("args: ['reset', '--soft', '@{upstream}']"), 'soft reset must use an argv array and literal @{upstream}');
      assert(gitMenusSource.includes("args: ['reset', '--hard', '@{upstream}']"), 'hard reset must use an argv array and literal @{upstream}');

      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-files-upstream-config-'));
      const config = path.join(configDir, 'config.yml');
      const previous = process.env.LG_CONFIG_FILE;
      write(config, 'keybinding:\n  commits:\n    viewResetOptions: x\n');
      process.env.LG_CONFIG_FILE = config;
      try {
        assert.equal(readLazyGitConfig().keymap.commits.viewResetOptions, 'x', 'Files must respect a configured commits.viewResetOptions override');
      } finally {
        if (previous === undefined) delete process.env.LG_CONFIG_FILE;
        else process.env.LG_CONFIG_FILE = previous;
        fs.rmSync(configDir, { recursive: true, force: true });
      }
    });

    await test('builds the exact upstream Reset to @{upstream} menu order, labels, keys, argv, and central confirmations', async () => {
      const items = buildResetToUpstreamMenuItems();
      assert.equal(RESET_TO_UPSTREAM_MENU_TITLE, 'Reset to @{upstream}');
      assert.deepEqual(items.map(item => [item.key, item.label, item.args]), [
        ['m', 'Mixed reset', ['reset', '--mixed', '@{upstream}']],
        ['s', 'Soft reset', ['reset', '--soft', '@{upstream}']],
        ['h', 'Hard reset', ['reset', '--hard', '@{upstream}']]
      ]);
      assert(items.every(item => item.danger && item.destructiveSeverity === 'history-rewrite' && item.confirm), 'every upstream history reset must use the central dangerous/reset confirmation contract');
      assert.equal(items[0].confirm, resetConfirmation('@{upstream}', 'mixed'));
      assert.equal(items[1].confirm, resetConfirmation('@{upstream}', 'soft'));
      assert.equal(items[2].confirm, resetConfirmation('@{upstream}', 'hard'));
      assert.match(items[2].confirm, /index and working tree/i, 'hard reset confirmation must explicitly warn about index/worktree loss');
    });

    for (const [mode, expected] of [
      ['mixed', { cached: '', worktree: true, tracked: 'local ahead\n' }],
      ['soft', { cached: true, worktree: '', tracked: 'local ahead\n' }],
      ['hard', { cached: '', worktree: '', tracked: 'upstream base\n' }]
    ]) {
      await test(`runs confirmed ${mode} reset to @{upstream} through argv with real Git semantics`, async () => {
        const fixture = createTrackingFixture(`lgvs-files-upstream-${mode}-`);
        try {
          const calls = [];
          const runGit = async (args, cwd) => {
            calls.push({ args: [...args], cwd });
            return sh(['git', ...args], cwd);
          };
          confirmationResponse = 'Run';
          const item = buildResetToUpstreamMenuItems().find(candidate => candidate.key === mode[0]);
          assert(item, `${mode} menu item must exist`);
          assert.equal(await executeGitMenuItem(item, { cwd: fixture.repo, runGit }), true);
          const resetCalls = calls.filter(call => call.args[0] === 'reset');
          assert.deepEqual(resetCalls, [{ args: ['reset', `--${mode}`, '@{upstream}'], cwd: fixture.repo }], 'the mutation must be exactly one argv reset against the active repository');
          assert.equal(git(fixture.repo, 'rev-parse', 'HEAD').trim(), fixture.upstream, 'HEAD must move to @{upstream}');
          const after = snapshot(fixture.repo);
          if (expected.cached === '') assert.equal(after.cached, '', `${mode} reset must leave the index clean when expected`);
          else assert.notEqual(after.cached, '', `${mode} reset must preserve the index when expected`);
          if (expected.worktree === '') assert.equal(after.worktree, '', `${mode} reset must leave the working tree clean when expected`);
          else assert.notEqual(after.worktree, '', `${mode} reset must preserve the working tree delta when expected`);
          assert.equal(after.tracked, expected.tracked);
        } finally {
          cleanup(fixture);
        }
      });
    }

    await test('cancelling upstream reset is a no-op in a real tracking repository', async () => {
      const fixture = createTrackingFixture('lgvs-files-upstream-cancel-');
      try {
        const before = snapshot(fixture.repo);
        const calls = [];
        const runGit = async (args, cwd) => {
          calls.push({ args: [...args], cwd });
          return sh(['git', ...args], cwd);
        };
        confirmationResponse = undefined;
        const hard = buildResetToUpstreamMenuItems().find(item => item.key === 'h');
        assert.equal(await executeGitMenuItem(hard, { cwd: fixture.repo, runGit }), false);
        assert.deepEqual(snapshot(fixture.repo), before, 'cancelling the confirmation must not mutate HEAD, index, or worktree');
        assert.equal(calls.filter(call => call.args[0] === 'reset').length, 0, 'cancel must not invoke git reset');
      } finally {
        confirmationResponse = 'Run';
        cleanup(fixture);
      }
    });

    await test('the captured active repository is isolated from a second real tracking repository', async () => {
      const primary = createTrackingFixture('lgvs-files-upstream-primary-');
      const secondary = createTrackingFixture('lgvs-files-upstream-secondary-');
      try {
        const secondaryBefore = snapshot(secondary.repo);
        const calls = [];
        const runGit = async (args, cwd) => {
          calls.push({ args: [...args], cwd });
          return sh(['git', ...args], cwd);
        };
        confirmationResponse = 'Run';
        quickPickInput = 'm';
        quickPickTitles.length = 0;
        assert.equal(await showResetToUpstreamMenu(primary.repo, runGit), true);
        assert.equal(quickPickTitles.at(-1)?.title, 'Reset to @{upstream}', 'the actual menu must retain the exact upstream title');
        assert.deepEqual(quickPickTitles.at(-1)?.items.map(item => item.label), ['esc Cancel', 'm Mixed reset', 's Soft reset', 'h Hard reset'], 'the actual QuickPick must display upstream reset options in lazygit key/order form');
        assert.equal(git(primary.repo, 'rev-parse', 'HEAD').trim(), primary.upstream);
        assert.deepEqual(snapshot(secondary.repo), secondaryBefore, 'a Files menu opened for the primary repo must leave the secondary repo untouched');
        assert(calls.every(call => call.cwd === primary.repo), 'all reads/mutations must use the repository captured while the menu was opened');
        assert.deepEqual(calls.filter(call => call.args[0] === 'reset'), [{ args: ['reset', '--mixed', '@{upstream}'], cwd: primary.repo }]);
      } finally {
        quickPickInput = undefined;
        cleanup(primary);
        cleanup(secondary);
      }
    });

    await test('a repository without an upstream reports a clear error and performs no reset', async () => {
      const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-files-no-upstream-'));
      try {
        git(rootDir, 'init');
        git(rootDir, 'config', 'user.email', 'lgvs@example.test');
        git(rootDir, 'config', 'user.name', 'LazyGitVS Test');
        write(path.join(rootDir, 'tracked.txt'), 'base\n');
        git(rootDir, 'add', 'tracked.txt');
        git(rootDir, 'commit', '-m', 'base');
        const before = snapshot(rootDir);
        const calls = [];
        const runGit = async (args, cwd) => {
          calls.push({ args: [...args], cwd });
          return sh(['git', ...args], cwd);
        };
        errors.length = 0;
        assert.equal(await showResetToUpstreamMenu(rootDir, runGit), false);
        assert.deepEqual(snapshot(rootDir), before, 'missing upstream must not mutate the repository');
        assert.equal(calls.filter(call => call.args[0] === 'reset').length, 0, 'missing upstream must not invoke git reset');
        assert.match(errors.at(-1) || '', /no upstream.*@\{upstream\}/i, 'missing upstream must be reported clearly');
      } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
    });
  } finally {
    Module._load = originalLoad;
  }

  if (!process.exitCode) console.log('filesResetToUpstream tests passed');
})();
