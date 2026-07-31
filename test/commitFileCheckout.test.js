const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitFileCheckout.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Commit-files checkout must live in a small compiled commitFileCheckout module.');

const {
  COMMIT_FILE_RANGE_MESSAGE,
  assertValidCommitFileCheckoutPath,
  canInspectSingleCommit,
  checkoutCommitFile,
  commitFileCheckoutPath,
  hasTrackedPorcelainChanges,
  parsePorcelainV1Status,
  projectCommitFileTreeRows,
} = require(modulePath);
const { DEFAULT_LAZYGIT_GUI, DEFAULT_LAZYGIT_KEYMAP, readLazyGitConfig } = require('../out/lazygitConfig');

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

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_EDITOR: 'true' },
    }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error((stderr || stdout || error.message).trim());
        failure.stdout = stdout;
        failure.stderr = stderr;
        reject(failure);
      } else {
        resolve(stdout);
      }
    });
  });
}

function initRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'lgvs@example.test');
  git(dir, 'config', 'user.name', 'LazyGitVS Test');
  return dir;
}

function write(dir, relativePath, contents) {
  const target = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function commit(dir, subject, files) {
  for (const [relativePath, contents] of Object.entries(files)) write(dir, relativePath, contents);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', subject);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function checkoutInput(repoPath, commitHash, filePath, calls) {
  return checkoutCommitFile({
    repoPath,
    commitHash,
    path: filePath,
    runGit: async (args, cwd) => {
      calls.push({ args, cwd });
      return runGit(args, cwd);
    },
  });
}

function sourceFixture(prefix = 'lgvs-commit-file-checkout-') {
  const dir = initRepo(prefix);
  const base = commit(dir, 'base', {
    'file.txt': 'one\n',
    'dir/a.txt': 'one\n',
    'unrelated.txt': 'keep\n',
  });
  const three = commit(dir, 'three', {
    'file.txt': 'three\n',
    'dir/a.txt': 'three\n',
    'dir/b.txt': 'new\n',
    'unrelated.txt': 'keep\n',
  });
  git(dir, 'checkout', '--detach', base);
  return { dir, base, three };
}

function assertNoCheckout(calls, label) {
  assert(!calls.some(call => call.args[0] === 'checkout'), label);
}

(async () => {
  await test('config defaults and LG_CONFIG_FILE customize Commit-files checkout key read-only', () => {
    assert.equal(DEFAULT_LAZYGIT_KEYMAP.commitFiles.checkoutCommitFile, 'c');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-commit-file-config-'));
    const config = path.join(dir, 'config.yml');
    fs.writeFileSync(config, `
keybinding:
  commitFiles:
    checkoutCommitFile: x
`);
    const previous = process.env.LG_CONFIG_FILE;
    process.env.LG_CONFIG_FILE = config;
    try {
      const resolved = readLazyGitConfig();
      assert.equal(resolved.keymap.commitFiles.checkoutCommitFile, 'x');
      assert.equal(fs.readFileSync(config, 'utf8').includes('checkoutCommitFile: x'), true, 'config remains read-only');
    } finally {
      if (previous === undefined) delete process.env.LG_CONFIG_FILE;
      else process.env.LG_CONFIG_FILE = previous;
      cleanup(dir);
    }
  });

  await test('source routing isolates configured c to Commit-files and keeps range entry read-only', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitFileCheckout.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitFileCheckout'"), 'controller must delegate checkout/path safety to the small Commit-files module');
    assert(config.includes("commitFiles: { checkoutCommitFile: 'c' }"), 'default must use lazygit keybinding.commitFiles.checkoutCommitFile = c');
    assert(extension.includes("panel==='commits'&&${this.commitFilesFor ? 'true' : 'false'}&&hit(e,cf.checkoutCommitFile)"), 'configured c must route only while Commit-files is active');
    assert(extension.includes("vscode.postMessage({type:'checkoutCommitFile'})"), 'Commit-files c must have its own message rather than entering top-level commit actions');
    assert(extension.includes('private async checkoutCurrentCommitFile()'), 'controller needs an explicit Commit-files checkout action');
    assert(extension.includes("if (!commitFileCheckout.canInspectSingleCommit(this.commitRange.mode)) return void vscode.window.showErrorMessage(commitFileCheckout.COMMIT_FILE_RANGE_MESSAGE);"), 'Enter with a visual commit range must refuse before setting commitFilesFor');
    assert(extension.includes("if(panel==='hunks'&&hit(e,u.select,u.togglePanel,u.remove,m.toggleSelectHunk))"), 'Hunks retain their own configured c/action surface');
    assert(extension.includes("key: key(f.commitChanges) || 'c', label: '$(git-commit) Commit'"), 'Files retain configured c commit semantics');
    assert(extension.includes("panel==='commits'&&!${this.commitFilesFor ? 'true' : 'false'}&&hit(e,u.remove,c.squashDown,c.markCommitAsFixup"), 'top-level Commits retains its f/c-era routing without promoting Commit-files c');
    assert(model.includes("label: '$(debug-step-over) Checkout'"), 'Commit-files command/help path must use the upstream action description Checkout');
    assert(!model.includes('confirm:'), 'upstream Commit-files checkout has no confirmation callback');
    assert(!model.includes('showWarningMessage'), 'Commit-files checkout stays VS Code-native without a terminal or confirmation modal');
    assert(fs.readFileSync(path.join(root, 'src', 'gitService.ts'), 'utf8').includes("cp.execFile('git'"), 'Git runner must use execFile with argv rather than a shell');
    assert(readme.includes('partial Commit-files checkout parity'), 'README must describe this as a bounded Commit-files checkout slice');
    assert(keybindingAudit.includes('configured `keybinding.commitFiles.checkoutCommitFile`'), 'keybinding audit must document configured Commit-files c');
    assert(parity.includes('Bounded partial Commit-files checkout slice'), 'parity gap report must document the bounded checkout contract');
  });

  await test('path validation rejects traversal, absolute, empty, NUL, and Git pathspec-magic paths', () => {
    assert.doesNotThrow(() => assertValidCommitFileCheckoutPath('dir/file.txt'));
    for (const unsafe of ['', '.', '..', '../file.txt', 'dir/../file.txt', '/tmp/file.txt', '\\server\\share', 'C:\\temp\\file.txt', 'dir\u0000file.txt', ':(top)', 'glob*.txt']) {
      assert.throws(() => assertValidCommitFileCheckoutPath(unsafe), /relative|path/i, `must reject ${JSON.stringify(unsafe)}`);
    }
  });

  await test('pure status parser retains rename records and distinguishes tracked changes from untracked-only paths', () => {
    const parsed = parsePorcelainV1Status(' M file.txt\0R  renamed.txt\0old-name.txt\0?? loose.txt\0D  removed.txt\0UU conflict.txt\0');
    assert.deepStrictEqual(parsed.map(entry => [entry.xy, entry.path, entry.originalPath]), [
      [' M', 'file.txt', undefined],
      ['R ', 'renamed.txt', 'old-name.txt'],
      ['??', 'loose.txt', undefined],
      ['D ', 'removed.txt', undefined],
      ['UU', 'conflict.txt', undefined],
    ]);
    assert.equal(hasTrackedPorcelainChanges(parsePorcelainV1Status('?? only-untracked.txt\0')), false);
    assert.equal(hasTrackedPorcelainChanges(parsed), true);
  });

  await test('pure Commit-files projection preserves file and directory checkout paths', () => {
    const rows = projectCommitFileTreeRows([
      { status: 'M', path: 'dir/a.txt' },
      { status: 'A', path: 'dir/b.txt' },
      { status: 'M', path: 'root.txt' },
    ], DEFAULT_LAZYGIT_GUI, new Set());
    const directory = rows.find(row => row.kind === 'dir' && row.path === 'dir');
    const file = rows.find(row => row.kind === 'file' && row.path === 'dir/a.txt');
    assert(directory && file);
    assert.equal(commitFileCheckoutPath(directory), 'dir');
    assert.equal(commitFileCheckoutPath(file), 'dir/a.txt');
    assert.equal(canInspectSingleCommit('none'), true);
    assert.equal(canInspectSingleCommit('sticky'), false);
    assert.match(COMMIT_FILE_RANGE_MESSAGE, /single inspected commit|visual commit range/i);
  });

  await test('checkout uses captured cwd and exact argv after a second commit/status revalidation', async () => {
    const repoPath = '/captured/repository';
    const hash = 'a'.repeat(40);
    const calls = [];
    await checkoutCommitFile({
      repoPath,
      commitHash: hash,
      path: 'dir/file.txt',
      runGit: async (args, cwd) => {
        calls.push({ args, cwd });
        if (args[0] === 'status' || args[0] === 'ls-tree') return '';
        return `${hash}\n`;
      },
    });
    assert.deepStrictEqual(calls, [
      { args: ['rev-parse', '--verify', `${hash}^{commit}`], cwd: repoPath },
      { args: ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'dir/file.txt'], cwd: repoPath },
      { args: ['ls-tree', '-r', '--name-only', '-z', hash, '--', 'dir/file.txt'], cwd: repoPath },
      { args: ['rev-parse', '--verify', `${hash}^{commit}`], cwd: repoPath },
      { args: ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'dir/file.txt'], cwd: repoPath },
      { args: ['checkout', hash, '--', 'dir/file.txt'], cwd: repoPath },
    ]);
  });

  await test('real Git file checkout restores the inspected commit content and leaves Files-visible modification', async () => {
    const fixture = sourceFixture('lgvs-commit-file-file-');
    try {
      const calls = [];
      await checkoutInput(fixture.dir, fixture.three, 'file.txt', calls);
      assert.equal(fs.readFileSync(path.join(fixture.dir, 'file.txt'), 'utf8'), 'three\n');
      assert.match(git(fixture.dir, 'status', '--porcelain=v1', '--', 'file.txt'), /^M\s+file\.txt/m, 'checkout must leave a normal Files-panel-visible modification');
      assert.deepStrictEqual(calls.at(-1), { args: ['checkout', fixture.three, '--', 'file.txt'], cwd: fixture.dir });
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('real Git directory checkout restores every selected directory path from the inspected commit', async () => {
    const fixture = sourceFixture('lgvs-commit-file-directory-');
    try {
      await checkoutInput(fixture.dir, fixture.three, 'dir', []);
      assert.equal(fs.readFileSync(path.join(fixture.dir, 'dir', 'a.txt'), 'utf8'), 'three\n');
      assert.equal(fs.readFileSync(path.join(fixture.dir, 'dir', 'b.txt'), 'utf8'), 'new\n');
      const status = git(fixture.dir, 'status', '--porcelain=v1', '--', 'dir');
      assert.match(status, /dir\/a\.txt/);
      assert.match(status, /dir\/b\.txt/);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('unrelated dirty paths remain untouched while the selected Commit-files path is checked out', async () => {
    const fixture = sourceFixture('lgvs-commit-file-unrelated-');
    try {
      write(fixture.dir, 'unrelated.txt', 'local unrelated\n');
      await checkoutInput(fixture.dir, fixture.three, 'file.txt', []);
      assert.equal(fs.readFileSync(path.join(fixture.dir, 'file.txt'), 'utf8'), 'three\n');
      assert.equal(fs.readFileSync(path.join(fixture.dir, 'unrelated.txt'), 'utf8'), 'local unrelated\n');
      assert.match(git(fixture.dir, 'status', '--porcelain=v1', '--', 'unrelated.txt'), /^ M unrelated\.txt/m);
    } finally {
      cleanup(fixture.dir);
    }
  });

  await test('tracked staged, unstaged, conflict, and deleted selected paths fail before checkout with local modifications', async () => {
    const cases = [
      {
        name: 'staged',
        setup(fixture) { write(fixture.dir, 'file.txt', 'staged local\n'); git(fixture.dir, 'add', 'file.txt'); },
      },
      {
        name: 'unstaged',
        setup(fixture) { write(fixture.dir, 'file.txt', 'unstaged local\n'); },
      },
      {
        name: 'deleted',
        setup(fixture) { fs.rmSync(path.join(fixture.dir, 'file.txt')); },
      },
    ];
    for (const item of cases) {
      const fixture = sourceFixture(`lgvs-commit-file-${item.name}-`);
      try {
        item.setup(fixture);
        const before = fs.existsSync(path.join(fixture.dir, 'file.txt')) ? fs.readFileSync(path.join(fixture.dir, 'file.txt'), 'utf8') : undefined;
        const calls = [];
        await assert.rejects(checkoutInput(fixture.dir, fixture.three, 'file.txt', calls), /local modifications/i, item.name);
        assertNoCheckout(calls, `${item.name} tracked change must fail before checkout`);
        assert.equal(fs.existsSync(path.join(fixture.dir, 'file.txt')) ? fs.readFileSync(path.join(fixture.dir, 'file.txt'), 'utf8') : undefined, before);
      } finally {
        cleanup(fixture.dir);
      }
    }

    const directoryFixture = sourceFixture('lgvs-commit-file-directory-local-');
    try {
      write(directoryFixture.dir, 'dir/a.txt', 'directory local modification\n');
      const calls = [];
      await assert.rejects(checkoutInput(directoryFixture.dir, directoryFixture.three, 'dir', calls), /local modifications/i);
      assertNoCheckout(calls, 'a tracked modification below the selected directory must fail before checkout');
      assert.equal(fs.readFileSync(path.join(directoryFixture.dir, 'dir/a.txt'), 'utf8'), 'directory local modification\n');
    } finally {
      cleanup(directoryFixture.dir);
    }

    const renameFixture = sourceFixture('lgvs-commit-file-renamed-local-');
    try {
      git(renameFixture.dir, 'mv', 'dir/a.txt', 'dir/renamed.txt');
      const calls = [];
      await assert.rejects(checkoutInput(renameFixture.dir, renameFixture.three, 'dir', calls), /local modifications/i);
      assertNoCheckout(calls, 'a tracked rename below the selected directory must fail before checkout');
      assert.equal(fs.existsSync(path.join(renameFixture.dir, 'dir/a.txt')), false);
      assert.equal(fs.readFileSync(path.join(renameFixture.dir, 'dir/renamed.txt'), 'utf8'), 'one\n');
    } finally {
      cleanup(renameFixture.dir);
    }

    const dir = initRepo('lgvs-commit-file-conflict-');
    try {
      const base = commit(dir, 'base', { 'file.txt': 'base\n' });
      git(dir, 'checkout', '-b', 'side');
      const side = commit(dir, 'side', { 'file.txt': 'side\n' });
      git(dir, 'checkout', 'master');
      const main = commit(dir, 'main', { 'file.txt': 'main\n' });
      assert.throws(() => git(dir, 'merge', 'side'));
      const calls = [];
      await assert.rejects(checkoutInput(dir, main || side || base, 'file.txt', calls), /local modifications/i);
      assertNoCheckout(calls, 'conflict must fail before checkout');
      assert.match(git(dir, 'status', '--porcelain=v1', '--', 'file.txt'), /^UU file\.txt/m);
    } finally {
      cleanup(dir);
    }
  });

  await test('an untracked collision is rejected before Git can silently overwrite it', async () => {
    const dir = initRepo('lgvs-commit-file-untracked-collision-');
    try {
      const base = commit(dir, 'base', { 'base.txt': 'base\n' });
      const source = commit(dir, 'source adds file', { 'base.txt': 'base\n', 'new.txt': 'from source\n' });
      git(dir, 'checkout', '--detach', base);
      write(dir, 'new.txt', 'untracked must survive\n');
      const calls = [];
      await assert.rejects(checkoutInput(dir, source, 'new.txt', calls), /untracked.*overwrit/i);
      assertNoCheckout(calls, 'untracked collision must not execute checkout');
      assert.equal(fs.readFileSync(path.join(dir, 'new.txt'), 'utf8'), 'untracked must survive\n');
      assert.match(git(dir, 'status', '--porcelain=v1', '--untracked-files=all', '--', 'new.txt'), /^\?\? new\.txt/m);
    } finally {
      cleanup(dir);
    }
  });

  await test('a path deleted in the inspected source commit lets exact Git checkout fail without deleting the worktree file', async () => {
    const dir = initRepo('lgvs-commit-file-deleted-source-');
    try {
      const base = commit(dir, 'base', { 'gone.txt': 'keep\n' });
      fs.rmSync(path.join(dir, 'gone.txt'));
      git(dir, 'add', '-A');
      const source = git(dir, 'commit', '-m', 'delete gone') || git(dir, 'rev-parse', 'HEAD').trim();
      const deleted = git(dir, 'rev-parse', 'HEAD').trim();
      git(dir, 'checkout', '--detach', base);
      const calls = [];
      await assert.rejects(checkoutInput(dir, deleted, 'gone.txt', calls), /pathspec|did not match/i);
      assert.deepStrictEqual(calls.at(-1), { args: ['checkout', deleted, '--', 'gone.txt'], cwd: dir });
      assert.equal(fs.readFileSync(path.join(dir, 'gone.txt'), 'utf8'), 'keep\n');
      assert(source === '' || typeof source === 'string');
    } finally {
      cleanup(dir);
    }
  });

  await test('rename/new destination path checks out from the inspected commit without using oldPath', async () => {
    const dir = initRepo('lgvs-commit-file-rename-');
    try {
      const base = commit(dir, 'base', { 'old.txt': 'old\n' });
      git(dir, 'mv', 'old.txt', 'new.txt');
      write(dir, 'new.txt', 'renamed source\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-m', 'rename');
      const renamed = git(dir, 'rev-parse', 'HEAD').trim();
      git(dir, 'checkout', '--detach', base);
      await checkoutInput(dir, renamed, 'new.txt', []);
      assert.equal(fs.readFileSync(path.join(dir, 'new.txt'), 'utf8'), 'renamed source\n');
      assert.equal(fs.readFileSync(path.join(dir, 'old.txt'), 'utf8'), 'old\n', 'checking out the selected new path must not infer a destructive oldPath operation');
    } finally {
      cleanup(dir);
    }
  });

  await test('captured repository cwd isolates two repositories', async () => {
    const first = sourceFixture('lgvs-commit-file-repo-a-');
    const second = initRepo('lgvs-commit-file-repo-b-');
    try {
      commit(second, 'base', { 'file.txt': 'repo b\n' });
      write(second, 'file.txt', 'repo b local\n');
      const calls = [];
      await checkoutInput(first.dir, first.three, 'file.txt', calls);
      assert(calls.every(call => call.cwd === first.dir), 'every verifier and mutation must use captured repository A cwd');
      assert.equal(fs.readFileSync(path.join(first.dir, 'file.txt'), 'utf8'), 'three\n');
      assert.equal(fs.readFileSync(path.join(second, 'file.txt'), 'utf8'), 'repo b local\n');
      assert.match(git(second, 'status', '--porcelain=v1', '--', 'file.txt'), /^ M file\.txt/m);
    } finally {
      cleanup(first.dir);
      cleanup(second);
    }
  });

  await test('controller refreshes and restores Commit-files focus/selection with no cancellation prompt', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const start = extension.indexOf('private async checkoutCurrentCommitFile()');
    const end = extension.indexOf('private async enterCommitFileHunkMode', start);
    const handler = extension.slice(start, end);
    assert(start >= 0 && end > start, 'checkout handler must remain a bounded Commit-files controller method');
    assert(handler.includes('await this.refresh(true);'), 'success must refresh Files/status and the Commit-files preview');
    assert(handler.includes("await this.restorePanelFocusAfterModal('commits');"), 'success must keep Commit-files focus');
    assert(!handler.includes('commitFileSelected = 0'), 'success must preserve the selected Commit-files row');
    assert(!handler.includes('showWarningMessage'), 'no confirmation/cancellation path applies upstream');
  });

  console.log('commitFileCheckout tests passed');
})();
