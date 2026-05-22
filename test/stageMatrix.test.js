const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseDiffHunks, hunkSelectableLineIndexes, singleLinePatch } = require('../out/hunkPatch');

const root = path.join(__dirname, '..');
const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

function sh(command, cwd, input) {
  return cp.execFileSync(command[0], command.slice(1), {
    cwd,
    input,
    encoding: 'utf8',
    stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
  });
}
function git(cwd, ...args) { return sh(['git', ...args], cwd); }
function write(file, text) { fs.writeFileSync(file, text); }
function read(file) { return fs.readFileSync(file, 'utf8'); }
function status(dir) { return git(dir, 'status', '--short'); }
function assertStatus(dir, regex, message) { assert.match(status(dir), regex, `${message}\n${status(dir)}`); }
function assertNoStatus(dir, regex, message) { assert.doesNotMatch(status(dir), regex, `${message}\n${status(dir)}`); }
function applyCached(dir, patch, reverse = false) {
  const args = ['git', 'apply', '--cached', '--whitespace=nowarn', '--recount', '--unidiff-zero'];
  if (reverse) args.splice(2, 0, '--reverse');
  sh(args, dir, patch);
}
function applyWorktree(dir, patch, reverse = false) {
  const args = ['git', 'apply', '--whitespace=nowarn', '--recount', '--unidiff-zero'];
  if (reverse) args.splice(2, 0, '--reverse');
  sh(args, dir, patch);
}
function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-stage-matrix-'));
  try {
    git(dir, 'init');
    git(dir, 'config', 'user.email', 'lgvs@example.test');
    git(dir, 'config', 'user.name', 'LazyGitVS Test');
    fn(dir);
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stderr || error.stdout || error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function commitBase(dir, rel, text) {
  write(path.join(dir, rel), text);
  git(dir, 'add', rel);
  git(dir, 'commit', '-m', `base ${rel}`);
}

test('LGVS source keeps explicit stage/unstage commands for common git states', () => {
  assert.match(extensionSource, /git\(\['restore', '--staged', '--', file\.path\]\)/, 'tracked file unstage must use git restore --staged -- path');
  assert.match(extensionSource, /git\(\['rm', '--cached', '--', file\.path\]\)/, 'new added file unstage must use git rm --cached -- path');
  assert.match(extensionSource, /git\(\['add', '--', file\.path\]\)/, 'file stage must use git add -- path');
  assert.match(extensionSource, /\['apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount'\]/, 'staged hunk/line unstage must reverse-apply to the index');
});

test('file toggle: modified tracked file stages then unstages without touching worktree', dir => {
  commitBase(dir, 'app.txt', 'one\ntwo\nthree\n');
  write(path.join(dir, 'app.txt'), 'one\nTWO\nthree\n');

  git(dir, 'add', '--', 'app.txt');
  assertStatus(dir, /^M  app\.txt/m, 'stage should move tracked edit into index');

  git(dir, 'restore', '--staged', '--', 'app.txt');
  assertStatus(dir, /^ M app\.txt/m, 'unstage should leave tracked edit in worktree');
  assert.equal(read(path.join(dir, 'app.txt')), 'one\nTWO\nthree\n');
});

test('file toggle: newly added file unstages back to untracked, not deleted', dir => {
  write(path.join(dir, 'new.txt'), 'new\n');
  git(dir, 'add', '--', 'new.txt');
  assertStatus(dir, /^A  new\.txt/m, 'new file should stage as add');

  git(dir, 'rm', '--cached', '--', 'new.txt');
  assertStatus(dir, /^\?\? new\.txt/m, 'unstage added file should become untracked');
  assert.equal(read(path.join(dir, 'new.txt')), 'new\n');
});

test('stage-all then unstage-all covers mixed modified, deleted and untracked files', dir => {
  commitBase(dir, 'keep.txt', 'keep\n');
  commitBase(dir, 'delete.txt', 'delete\n');
  write(path.join(dir, 'keep.txt'), 'changed\n');
  fs.unlinkSync(path.join(dir, 'delete.txt'));
  write(path.join(dir, 'untracked.txt'), 'new\n');

  git(dir, 'add', '-A');
  assertStatus(dir, /^M  keep\.txt/m, 'add -A should stage modification');
  assertStatus(dir, /^D  delete\.txt/m, 'add -A should stage deletion');
  assertStatus(dir, /^A  untracked\.txt/m, 'add -A should stage untracked file');

  git(dir, 'restore', '--staged', '.');
  assertStatus(dir, /^ M keep\.txt/m, 'unstage-all should leave modification unstaged');
  assertStatus(dir, /^ D delete\.txt/m, 'unstage-all should leave deletion unstaged');
  assertStatus(dir, /^\?\? untracked\.txt/m, 'unstage-all should leave new file untracked');
});

test('hunk toggle: stage and unstage one selected replacement hunk while leaving sibling hunk staged', dir => {
  commitBase(dir, 'settings.json', Array.from({ length: 12 }, (_, i) => `  "cmd${i}": true,`).join('\n') + '\n');
  const changed = Array.from({ length: 12 }, (_, i) => `  "cmd${i}": ${i === 3 || i === 9 ? 'false' : 'true'},`).join('\n') + '\n';
  write(path.join(dir, 'settings.json'), changed);

  const hunks = parseDiffHunks(git(dir, 'diff', '--unified=0', '--', 'settings.json'), false);
  assert.equal(hunks.length, 2);
  applyCached(dir, hunks[0].patch);
  assert.match(git(dir, 'diff', '--cached', '--', 'settings.json'), /cmd3": false/);
  assert.doesNotMatch(git(dir, 'diff', '--cached', '--', 'settings.json'), /cmd9": false/);

  const stagedHunk = parseDiffHunks(git(dir, 'diff', '--cached', '--unified=0', '--', 'settings.json'), true)[0];
  applyCached(dir, stagedHunk.patch, true);
  assertNoStatus(dir, /^M  settings\.json/m, 'unstaging selected hunk should remove it from index');
  assertStatus(dir, /^ M settings\.json/m, 'unstaging selected hunk should keep worktree edit');
  assert.match(git(dir, 'diff', '--', 'settings.json'), /cmd3": false/);
  assert.match(git(dir, 'diff', '--', 'settings.json'), /cmd9": false/);
});

test('line toggle: stage/unstage only selected addition, deletion and replacement lines', dir => {
  commitBase(dir, 'lines.txt', 'one\ntwo\nthree\nfour\nfive\n');
  write(path.join(dir, 'lines.txt'), 'zero\none\nTWO\nfour\nFIVE\nsix\n');

  let hunk = parseDiffHunks(git(dir, 'diff', '--unified=0', '--', 'lines.txt'), false)[0];
  let selectable = hunkSelectableLineIndexes(hunk);
  assert(selectable.length >= 1, 'expected selectable changed lines');
  applyCached(dir, singleLinePatch(hunk, selectable[0]));
  const afterStageOne = git(dir, 'diff', '--cached', '--', 'lines.txt');
  assert(afterStageOne.includes('+zero') || afterStageOne.includes('+TWO') || afterStageOne.includes('+FIVE') || afterStageOne.includes('+six'), afterStageOne);

  hunk = parseDiffHunks(git(dir, 'diff', '--cached', '--unified=0', '--', 'lines.txt'), true)[0];
  selectable = hunkSelectableLineIndexes(hunk);
  applyCached(dir, singleLinePatch(hunk, selectable[0]), true);
  assert.equal(git(dir, 'diff', '--cached', '--', 'lines.txt'), '', 'unstaging the selected line should clear the index again');
  assertStatus(dir, /^ M lines\.txt/m, 'worktree should still contain all line edits');
});

test('discard still differs from unstage: unstaged discard changes worktree, staged unstage does not', dir => {
  commitBase(dir, 'discard.txt', 'old\n');
  write(path.join(dir, 'discard.txt'), 'new\n');
  let hunk = parseDiffHunks(git(dir, 'diff', '--unified=0', '--', 'discard.txt'), false)[0];
  applyWorktree(dir, hunk.patch, true);
  assert.equal(read(path.join(dir, 'discard.txt')), 'old\n');
  assert.equal(status(dir), '');

  write(path.join(dir, 'discard.txt'), 'new\n');
  git(dir, 'add', '--', 'discard.txt');
  hunk = parseDiffHunks(git(dir, 'diff', '--cached', '--unified=0', '--', 'discard.txt'), true)[0];
  applyCached(dir, hunk.patch, true);
  assert.equal(read(path.join(dir, 'discard.txt')), 'new\n');
  assertStatus(dir, /^ M discard\.txt/m, 'unstage should not discard the worktree edit');
});
