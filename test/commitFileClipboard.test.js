const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'out', 'commitFileClipboard.js');
const extensionPath = path.join(root, 'src', 'extension.ts');
const configPath = path.join(root, 'src', 'lazygitConfig.ts');
const securityPath = path.join(root, 'src', 'webviewSecurity.ts');
const readmePath = path.join(root, 'README.md');
const keybindingAuditPath = path.join(root, 'docs', 'lazygit-keybinding-audit.md');
const parityPath = path.join(root, 'docs', 'lazygit-parity-gap-report.md');

assert(fs.existsSync(modulePath), 'Commit-files clipboard behavior must live in a small compiled commitFileClipboard module.');

const {
  COMMIT_FILE_CLIPBOARD_MENU_TITLE,
  commitFileClipboardCatalog,
  commitFileContentArgs,
  commitFileDiffArgs,
  runCommitFileClipboardAction,
} = require(modulePath);
const { DEFAULT_LAZYGIT_KEYMAP, readLazyGitConfig } = require('../out/lazygitConfig');

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

function itemByKey(items, key) {
  const item = items.find(candidate => candidate.key === key);
  assert(item, `missing menu item for ${key}`);
  assert.equal(typeof item.run, 'function', `menu item ${key} must be executable`);
  return item;
}

function clipboardInput(overrides = {}) {
  const copies = [];
  const calls = [];
  const commitHash = 'a'.repeat(40);
  const parentHash = 'b'.repeat(40);
  const input = {
    repoPath: '/captured/repository',
    commitHash,
    row: {
      kind: 'file',
      file: { status: 'R', path: 'src/current[1].txt', oldPath: 'src/old.txt' },
    },
    gitConfig: { diffContextSize: 7, renameSimilarityThreshold: 80 },
    runGit: async (args, cwd) => {
      calls.push({ args, cwd });
      if (args[0] === 'rev-list') return `${commitHash} ${parentHash}\n`;
      return `clipboard output for ${args.join(' ')}`;
    },
    copyText: async (text, label) => {
      copies.push({ text, label });
    },
    ...overrides,
  };
  return { input, copies, calls, commitHash, parentHash };
}

(async () => {
  await test('defaults and LG_CONFIG_FILE keep Commit-files y on the shared files copy binding read-only', () => {
    assert.equal(DEFAULT_LAZYGIT_KEYMAP.files.copyFileInfoToClipboard, 'y');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-commit-file-clipboard-config-'));
    const config = path.join(dir, 'config.yml');
    fs.writeFileSync(config, `
keybinding:
  files:
    copyFileInfoToClipboard: x
`);
    const previous = process.env.LG_CONFIG_FILE;
    process.env.LG_CONFIG_FILE = config;
    try {
      const resolved = readLazyGitConfig();
      assert.equal(resolved.keymap.files.copyFileInfoToClipboard, 'x');
      assert.equal(fs.readFileSync(config, 'utf8').includes('copyFileInfoToClipboard: x'), true, 'config remains read-only');
    } finally {
      if (previous === undefined) delete process.env.LG_CONFIG_FILE;
      else process.env.LG_CONFIG_FILE = previous;
      cleanup(dir);
    }
  });

  await test('source routing keeps configured files y inside Commit-files and allows the dedicated webview message', () => {
    const extension = fs.readFileSync(extensionPath, 'utf8');
    const config = fs.readFileSync(configPath, 'utf8');
    const security = fs.readFileSync(securityPath, 'utf8');
    const model = fs.readFileSync(path.join(root, 'src', 'commitFileClipboard.ts'), 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const keybindingAudit = fs.readFileSync(keybindingAuditPath, 'utf8');
    const parity = fs.readFileSync(parityPath, 'utf8');

    assert(extension.includes("from './commitFileClipboard'"), 'extension controller must delegate copy semantics to the small Commit-files clipboard module');
    assert(config.includes("copyFileInfoToClipboard: 'y'"), 'default y must remain lazygit keybinding.files.copyFileInfoToClipboard');
    assert(extension.includes("panel==='commits'&&${this.commitFilesFor ? 'true' : 'false'}&&hit(e,f.copyFileInfoToClipboard)"), 'configured y must route only while Commit-files is active');
    assert(extension.includes("vscode.postMessage({type:'copyCommitFileInfo'})"), 'Commit-files y must have its own message instead of entering top-level Commit copy');
    assert(extension.includes('commitFileClipboard.runCommitFileClipboardAction('), 'controller must delegate the menu integration to the extracted clipboard coordinator');
    assert(security.includes("'copyCommitFileInfo'"), 'the normalized webview contract must admit the dedicated menu message');
    assert(model.includes('export async function runCommitFileClipboardAction('), 'clipboard module must own the menu coordinator, not grow extension.ts');
    assert(extension.indexOf("if(panel==='commits'&&${this.commitFilesFor ? 'true' : 'false'}&&hit(e,f.copyFileInfoToClipboard)") < extension.indexOf("if(panel!=='files'&&hit(e,u.copyToClipboard))"), 'Commit-files y must be intercepted before generic non-Files copy routing');
    for (const label of ['File name', 'Relative path', 'Absolute path', 'Diff of selected file', 'Diff of all files', 'Content of selected file']) assert(model.includes(`label: '${label}'`), `catalog must retain exact upstream label ${label}`);
    assert(readme.includes('bounded Commit-files clipboard parity'), 'README must state the bounded Commit-files clipboard contract');
    assert(keybindingAudit.includes('configured `keybinding.files.copyFileInfoToClipboard`'), 'keybinding audit must state that Commit-files shares the configured upstream files y binding');
    assert(parity.includes('Bounded Commit-files clipboard slice'), 'gap report must record the completed bounded clipboard slice');
    assert(!parity.includes('Copy path / copy file info exact menu.'), 'completed Commit-files clipboard menu must leave the remaining-gaps list');
  });

  await test('catalog exactly exposes upstream n/p/P/s/a/c actions and captures repo, commit, literal paths, and config', async () => {
    const { input, copies, calls, commitHash, parentHash } = clipboardInput();
    const items = commitFileClipboardCatalog(input);
    assert.equal(COMMIT_FILE_CLIPBOARD_MENU_TITLE, 'Copy to clipboard');
    assert.deepEqual(items.map(item => [item.key, item.label]), [
      ['n', 'File name'],
      ['p', 'Relative path'],
      ['P', 'Absolute path'],
      ['s', 'Diff of selected file'],
      ['a', 'Diff of all files'],
      ['c', 'Content of selected file'],
    ]);

    await itemByKey(items, 'n').run();
    await itemByKey(items, 'p').run();
    await itemByKey(items, 'P').run();
    await itemByKey(items, 's').run();
    await itemByKey(items, 'a').run();
    await itemByKey(items, 'c').run();

    assert.deepEqual(copies.slice(0, 3), [
      { text: 'current[1].txt', label: 'file name copied to clipboard' },
      { text: 'src/current[1].txt', label: 'file path copied to clipboard' },
      { text: path.join('/captured/repository', 'src/current[1].txt'), label: 'file path copied to clipboard' },
    ]);
    assert.equal(copies[3].label, 'file diff copied to clipboard');
    assert.equal(copies[4].label, 'all files diff copied to clipboard');
    assert.equal(copies[5].label, 'file content copied to clipboard');
    assert.deepEqual(calls, [
      { args: ['rev-list', '--parents', '-n', '1', commitHash], cwd: '/captured/repository' },
      { args: commitFileDiffArgs(parentHash, commitHash, ['src/current[1].txt'], input.gitConfig), cwd: '/captured/repository' },
      { args: ['rev-list', '--parents', '-n', '1', commitHash], cwd: '/captured/repository' },
      { args: commitFileDiffArgs(parentHash, commitHash, ['.'], input.gitConfig), cwd: '/captured/repository' },
      { args: commitFileContentArgs(commitHash, 'src/current[1].txt'), cwd: '/captured/repository' },
    ]);
    assert.deepEqual(commitFileDiffArgs(parentHash, commitHash, ['src/current[1].txt'], input.gitConfig), [
      '-c', 'diff.noprefix=false', 'diff', '--submodule', '--no-ext-diff', '--unified=7', '--find-renames=80%', '--color=never',
      parentHash, commitHash, '--', ':(literal)src/current[1].txt',
    ]);
    assert.deepEqual(commitFileContentArgs(commitHash, 'src/current[1].txt'), ['show', `${commitHash}:src/current[1].txt`]);
  });

  await test('directory rows retain path and diff actions but do not expose blob-only content', async () => {
    const { input, calls, commitHash, parentHash } = clipboardInput({ row: { kind: 'dir', path: 'src' } });
    const items = commitFileClipboardCatalog(input);
    assert.deepEqual(items.map(item => item.key), ['n', 'p', 'P', 's', 'a']);
    await itemByKey(items, 's').run();
    assert.deepEqual(calls, [
      { args: ['rev-list', '--parents', '-n', '1', commitHash], cwd: '/captured/repository' },
      { args: commitFileDiffArgs(parentHash, commitHash, ['src'], input.gitConfig), cwd: '/captured/repository' },
    ]);
  });

  await test('extracted coordinator captures once and restores focus after success or menu failure', async () => {
    const { input } = clipboardInput();
    const source = {
      commitHash: input.commitHash,
      row: input.row,
      repoPath: input.repoPath,
      gitConfig: input.gitConfig,
      runGit: input.runGit,
      copyText: input.copyText,
    };
    const menus = [];
    let focusRestores = 0;
    await runCommitFileClipboardAction(source, async (title, items) => menus.push({ title, items }), async () => { focusRestores += 1; });
    assert.equal(menus.length, 1);
    assert.equal(menus[0].title, COMMIT_FILE_CLIPBOARD_MENU_TITLE);
    assert.equal(focusRestores, 1);
    await assert.rejects(() => runCommitFileClipboardAction(source, async () => { throw new Error('picker failure'); }, async () => { focusRestores += 1; }), /picker failure/);
    assert.equal(focusRestores, 2);
    await runCommitFileClipboardAction({ ...source, commitHash: undefined }, async () => { throw new Error('menu must not open without a captured commit'); }, async () => { throw new Error('focus must not restore without a menu'); });
  });

  await test('selected, all, content, and root-copy use actual captured Git objects without changing HEAD or the worktree', async () => {
    const dir = initRepo('lgvs-commit-file-clipboard-');
    try {
      const rootCommit = commit(dir, 'root', {
        'selected[1].txt': 'root value\n',
        'keep.txt': 'keep\n',
      });
      const inspectedCommit = commit(dir, 'inspected', {
        'selected[1].txt': 'inspected value\n',
        'nested/added.txt': 'added in inspected\n',
        'keep.txt': 'keep\n',
      });
      const headAfterInspection = commit(dir, 'later', {
        'selected[1].txt': 'later value\n',
        'nested/added.txt': 'added in inspected\n',
        'keep.txt': 'keep\n',
      });
      write(dir, 'selected[1].txt', 'working-tree value\n');

      const copies = [];
      const input = {
        repoPath: dir,
        commitHash: inspectedCommit,
        row: { kind: 'file', file: { status: 'M', path: 'selected[1].txt' } },
        gitConfig: { diffContextSize: 2, renameSimilarityThreshold: 50 },
        runGit,
        copyText: async (text, label) => copies.push({ text, label }),
      };
      const items = commitFileClipboardCatalog(input);
      await itemByKey(items, 's').run();
      await itemByKey(items, 'a').run();
      await itemByKey(items, 'c').run();


      assert.match(copies[0].text, /selected\[1\]\.txt/, 'literal Git pathspec must preserve a bracketed tracked filename');
      assert.match(copies[0].text, /-root value/);
      assert.match(copies[0].text, /\+inspected value/);
      assert(!copies[0].text.includes('added in inspected'), 'selected diff must not spill into another path');
      assert(!copies[0].text.includes('later value'), 'selected diff must not read a later commit');
      assert(!copies[0].text.includes('working-tree value'), 'selected diff must not read the worktree');
      assert.match(copies[1].text, /\+inspected value/);
      assert.match(copies[1].text, /nested\/added\.txt/);
      assert(!copies[1].text.includes('later value'), 'all diff must remain pinned to the inspected commit');
      assert.equal(copies[2].text, 'inspected value\n');

      assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), headAfterInspection, 'clipboard reads must not move HEAD');
      assert.equal(git(dir, 'status', '--porcelain').trim(), 'M selected[1].txt', 'clipboard reads must not alter the dirty worktree');

      const rootCopies = [];
      const rootItems = commitFileClipboardCatalog({
        ...input,
        commitHash: rootCommit,
        row: { kind: 'file', file: { status: 'A', path: 'selected[1].txt' } },
        copyText: async (text, label) => rootCopies.push({ text, label }),
      });
      await itemByKey(rootItems, 's').run();
      assert.match(rootCopies[0].text, /new file mode/);
      assert.match(rootCopies[0].text, /\+root value/);
    } finally {
      cleanup(dir);
    }
  });
})();
