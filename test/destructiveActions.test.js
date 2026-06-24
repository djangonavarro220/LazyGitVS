const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { destructiveGitActionReason } = require('../out/destructiveActions');

const root = path.join(__dirname, '..');
const gitMenusSource = fs.readFileSync(path.join(root, 'src', 'gitMenus.ts'), 'utf8');
const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

function sh(command, cwd) {
  return cp.execFileSync(command[0], command.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function git(cwd, ...args) { return sh(['git', ...args], cwd); }
function write(file, text) { fs.writeFileSync(file, text); }
function snapshot(dir) {
  return {
    status: git(dir, 'status', '--short'),
    cached: git(dir, 'diff', '--cached'),
    worktree: git(dir, 'diff')
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

test('destructive Git action matrix requires explicit confirmation', () => {
  const destructive = [
    [['reset', '--soft', 'HEAD~1'], 'reset'],
    [['reset', '--mixed', 'HEAD~1'], 'reset'],
    [['reset', '--hard', 'HEAD'], 'reset'],
    [['clean', '-fd'], 'clean'],
    [['restore', '--', 'file.txt'], 'discard'],
    [['restore', '--staged', '--worktree', '--', 'file.txt'], 'discard'],
    [['checkout', '-f', 'topic'], 'force checkout'],
    [['checkout', '--ours', '--', 'file.txt'], 'conflict checkout'],
    [['checkout', '--theirs', '--', 'file.txt'], 'conflict checkout'],
    [['branch', '-d', 'topic'], 'delete branch'],
    [['branch', '-D', 'topic'], 'delete branch'],
    [['tag', '-d', 'v1'], 'delete tag'],
    [['remote', 'remove', 'origin'], 'remove remote'],
    [['stash', 'drop', 'stash@{0}'], 'drop stash'],
    [['stash', 'pop', 'stash@{0}'], 'pop stash'],
    [['merge', 'topic'], 'merge'],
    [['rebase', 'topic'], 'rebase'],
    [['cherry-pick', 'abc123'], 'cherry-pick'],
    [['revert', 'abc123'], 'revert'],
    [['push', '--force-with-lease'], 'force push'],
    [['commit', '--amend', '--no-edit'], 'amend']
  ];
  for (const [args, expected] of destructive) {
    assert.equal(destructiveGitActionReason(args), expected, `${args.join(' ')} should be classified as destructive`);
  }
  for (const args of [
    ['status'],
    ['add', '--', 'file.txt'],
    ['restore', '--staged', '--', 'file.txt'],
    ['push'],
    ['pull'],
    ['fetch'],
    ['stash', 'push'],
    ['stash', 'apply', 'stash@{0}'],
    ['commit', '-m', 'msg'],
    ['merge', '--ff-only', 'origin/main']
  ]) {
    assert.equal(destructiveGitActionReason(args), undefined, `${args.join(' ')} should not require destructive confirmation`);
  }
});

test('reset catalog uses explicit destructive confirmation messages, not generic danger fallback', () => {
  assert.match(gitMenusSource, /dangerousGitMenuItem\(\{ key: 's', label: '\$\(debug-restart\) Soft reset to previous commit'/, 'soft reset must use central dangerous menu helper');
  assert.match(gitMenusSource, /resetConfirmation\('HEAD~1', 'soft'\)/, 'soft reset must have an explicit reset confirmation');
  assert.match(gitMenusSource, /dangerousGitMenuItem\(\{ key: 'm', label: '\$\(debug-restart\) Mixed reset to previous commit'/, 'mixed reset must use central dangerous menu helper');
  assert.match(gitMenusSource, /resetConfirmation\('HEAD~1', 'mixed'\)/, 'mixed reset must have an explicit reset confirmation');
});

test('destructive run-based catalog actions use explicit confirmation wrappers', () => {
  assert.match(extensionSource, /dangerousGitMenuItem\(\{ key: key\(k\.renameCommit\)[\s\S]+?git\(\['commit', '--amend', '-m', msg\.trim\(\)\]\)/, 'reword HEAD commit rewrites history and must be explicitly confirmed');
  assert.match(extensionSource, /dangerousGitMenuItem\(\{ key: key\(k\.renameStash\)[\s\S]+?git\(\['stash', 'drop', s\.ref\]\)/, 'rename stash drops the old stash ref and must be explicitly confirmed');
});

test('cancelling a destructive menu item leaves git status, cached diff and worktree diff unchanged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-destructive-cancel-'));
  const originalLoad = Module._load;
  try {
    git(dir, 'init');
    git(dir, 'config', 'user.email', 'lgvs@example.test');
    git(dir, 'config', 'user.name', 'LazyGitVS Test');
    write(path.join(dir, 'file.txt'), 'base\n');
    git(dir, 'add', 'file.txt');
    git(dir, 'commit', '-m', 'base');
    write(path.join(dir, 'file.txt'), 'index\n');
    git(dir, 'add', 'file.txt');
    write(path.join(dir, 'file.txt'), 'worktree\n');
    write(path.join(dir, 'untracked.txt'), 'new\n');
    const before = snapshot(dir);

    Module._load = function(request, parent, isMain) {
      if (request === 'vscode') {
        return {
          window: {
            showWarningMessage: async () => undefined,
            withProgress: async (_options, task) => task(),
            showInformationMessage: () => undefined
          },
          ProgressLocation: { Notification: 15 }
        };
      }
      return originalLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve('../out/gitMenus')];
    const { executeGitMenuItem } = require('../out/gitMenus');
    const ran = await executeGitMenuItem({ label: 'Hard reset to HEAD', args: ['reset', '--hard', 'HEAD'] });

    assert.equal(ran, false, 'cancelled destructive action should report false');
    assert.deepEqual(snapshot(dir), before);
  } finally {
    Module._load = originalLoad;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
