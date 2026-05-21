const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_LAZYGIT_KEYMAP,
  parseSimpleYaml,
  readLazyGitKeymap,
  readLazyGitConfig,
} = require('../out/lazygitConfig');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test('parseSimpleYaml parses nested lazygit keybindings and arrays', () => {
  const parsed = parseSimpleYaml(`
keybinding:
  universal:
    push: X
    jumpToBlock:
      - "1"
      - "2"
  files:
    confirmDiscard: "z" # comment
`);

  assert.equal(parsed.keybinding.universal.push, 'X');
  assert.deepEqual(parsed.keybinding.universal.jumpToBlock, ['1', '2']);
  assert.equal(parsed.keybinding.files.confirmDiscard, 'z');
});

test('readLazyGitKeymap merges LG_CONFIG_FILE over defaults read-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-config-'));
  const config = path.join(dir, 'config.yml');
  fs.writeFileSync(config, `
keybinding:
  universal:
    push: X
  files:
    stashAllChanges: Z
`);

  const previous = process.env.LG_CONFIG_FILE;
  process.env.LG_CONFIG_FILE = config;
  try {
    const result = readLazyGitKeymap();
    assert.deepEqual(result.files, [config]);
    assert.equal(result.keymap.universal.push, 'X');
    assert.equal(result.keymap.files.stashAllChanges, 'Z');
    assert.equal(result.keymap.universal.pull, DEFAULT_LAZYGIT_KEYMAP.universal.pull);
    assert.equal(fs.readFileSync(config, 'utf8').includes('push: X'), true);
  } finally {
    if (previous === undefined) delete process.env.LG_CONFIG_FILE;
    else process.env.LG_CONFIG_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readLazyGitConfig merges gui settings used by LGVS', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-gui-config-'));
  const config = path.join(dir, 'config.yml');
  fs.writeFileSync(config, `
gui:
  showBottomLine: false
  showPanelJumps: false
  showFileTree: true
  fileTreeSortOrder: foldersFirst
  fileTreeSortCaseSensitive: false
  wrapLinesInStagingView: false
  useHunkModeInStagingView: false
git:
  diffContextSize: 7
  ignoreWhitespaceInDiffView: true
  renameSimilarityThreshold: 72
  paging:
    colorArg: always
keybinding:
  universal:
    push: X
`);

  const previous = process.env.LG_CONFIG_FILE;
  process.env.LG_CONFIG_FILE = config;
  try {
    const result = readLazyGitConfig();
    assert.equal(result.gui.showBottomLine, false);
    assert.equal(result.gui.showPanelJumps, false);
    assert.equal(result.gui.showFileTree, true);
    assert.equal(result.gui.fileTreeSortOrder, 'foldersFirst');
    assert.equal(result.gui.fileTreeSortCaseSensitive, false);
    assert.equal(result.gui.wrapLinesInStagingView, false);
    assert.equal(result.gui.useHunkModeInStagingView, false);
    assert.equal(result.keymap.universal.push, 'X');
    assert.equal(result.git.diffContextSize, 7);
    assert.equal(result.git.ignoreWhitespaceInDiffView, true);
    assert.equal(result.git.renameSimilarityThreshold, 72);
    assert.equal(result.git.paging.colorArg, 'always');
  } finally {
    if (previous === undefined) delete process.env.LG_CONFIG_FILE;
    else process.env.LG_CONFIG_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('readLazyGitConfig fails when LG_CONFIG_FILE points to missing file', () => {
  const previous = process.env.LG_CONFIG_FILE;
  process.env.LG_CONFIG_FILE = path.join(os.tmpdir(), 'missing-lgvs-config.yml');
  try {
    assert.throws(() => readLazyGitConfig(), /LG_CONFIG_FILE points to missing/);
  } finally {
    if (previous === undefined) delete process.env.LG_CONFIG_FILE;
    else process.env.LG_CONFIG_FILE = previous;
  }
});
