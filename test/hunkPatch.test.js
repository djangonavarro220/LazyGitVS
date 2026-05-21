const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseDiffHunks, hunkChangedLineIndexes, hunkSelectableLineIndexes, singleLinePatch } = require('../out/hunkPatch');
const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');

function sh(command, cwd, input) {
  return cp.execFileSync(command[0], command.slice(1), { cwd, input, encoding: 'utf8', stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
}
function git(cwd, ...args) { return sh(['git', ...args], cwd); }
function write(file, text) { fs.writeFileSync(file, text); }
function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-hunk-'));
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

test('parseDiffHunks keeps separate file headers for multi-file diffs', dir => {
  write(path.join(dir, 'a.txt'), 'a1\na2\na3\n');
  write(path.join(dir, 'b.txt'), 'b1\nb2\nb3\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'base');
  write(path.join(dir, 'a.txt'), 'a1\nA2\na3\n');
  write(path.join(dir, 'b.txt'), 'b1\nB2\nb3\n');
  const hunks = parseDiffHunks(git(dir, 'diff', '--unified=1'), false);
  assert.equal(hunks.length, 2);
  assert.match(hunks[0].patch, /diff --git a\/a\.txt b\/a\.txt/);
  assert.doesNotMatch(hunks[0].patch, /b\.txt/);
  assert.match(hunks[1].patch, /diff --git a\/b\.txt b\/b\.txt/);
});

test('hunk navigation uses zero-context diffs so nearby editor blocks stay separate', dir => {
  assert.match(extensionSource, /const diffArgs = \['diff', '--unified=0'/, 'unstaged hunk navigation must ignore preview context and use zero-context diffs');
  assert.match(extensionSource, /const cachedDiffArgs = \['diff', '--cached', '--unified=0'/, 'staged hunk navigation must ignore preview context and use zero-context diffs');
  assert.match(extensionSource, /zeroContextPatch\(patch\)/, 'whole hunk apply must use --unidiff-zero for zero-context navigation patches');

  write(path.join(dir, 'keybindings.json'), Array.from({ length: 20 }, (_, i) => `  "cmd${i}": true,`).join('\n') + '\n');
  git(dir, 'add', 'keybindings.json');
  git(dir, 'commit', '-m', 'base');
  const changed = Array.from({ length: 20 }, (_, i) => `  "cmd${i}": ${i === 7 || i === 13 ? 'false' : 'true'},`).join('\n') + '\n';
  write(path.join(dir, 'keybindings.json'), changed);
  git(dir, 'add', 'keybindings.json');

  const stagedHunks = parseDiffHunks(git(dir, 'diff', '--cached', '--unified=0', '--', 'keybindings.json'), true);
  assert.equal(stagedHunks.length, 2);
  assert.match(stagedHunks[0].patch, /cmd7": false/);
  assert.doesNotMatch(stagedHunks[0].patch, /cmd13": false/);
  assert.match(stagedHunks[1].patch, /cmd13": false/);
  sh(['git', 'apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount', '--unidiff-zero'], dir, stagedHunks[0].patch);
  const cached = git(dir, 'diff', '--cached', '--', 'keybindings.json');
  const unstaged = git(dir, 'diff', '--', 'keybindings.json');
  assert.doesNotMatch(cached, /cmd7": false/);
  assert.match(cached, /cmd13": false/);
  assert.match(unstaged, /cmd7": false/);
  assert.doesNotMatch(unstaged, /cmd13": false/);
});

test('singleLinePatch stages only selected changed line inside one hunk', dir => {
  write(path.join(dir, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');
  write(path.join(dir, 'a.txt'), 'one\nTWO\nthree\nFOUR\nfive\n');
  const hunk = parseDiffHunks(git(dir, 'diff'), false)[0];
  const changed = hunkChangedLineIndexes(hunk);
  assert.equal(changed.length, 4);
  assert.deepEqual(hunkSelectableLineIndexes(hunk), [2, 5]);
  const patch = singleLinePatch(hunk, hunkSelectableLineIndexes(hunk)[1]); // FOUR replacement only
  sh(['git', 'apply', '--cached', '--whitespace=nowarn', '--recount'], dir, patch);
  const cached = git(dir, 'diff', '--cached');
  const unstaged = git(dir, 'diff');
  assert.match(cached, /\+FOUR/);
  assert.doesNotMatch(cached, /\+TWO/);
  assert.match(unstaged, /\+TWO/);
  assert.doesNotMatch(unstaged, /\+FOUR/);
});

test('parsed hunk patch applies when index already has nearby staged changes', dir => {
  fs.mkdirSync(path.join(dir, '.config/vscode'), { recursive: true });
  const rel = '.config/vscode/keybindings.json';
  const file = path.join(dir, rel);
  write(file, Array.from({ length: 250 }, (_, i) => `  "cmd${i}": true,`).join('\n') + '\n');
  git(dir, 'add', rel);
  git(dir, 'commit', '-m', 'base');

  const staged = fs.readFileSync(file, 'utf8').split('\n');
  staged[220] = '  "cmd220": false,';
  write(file, staged.join('\n'));
  git(dir, 'add', rel);

  const unstaged = fs.readFileSync(file, 'utf8').split('\n');
  unstaged[221] = '  "cmd221": false,';
  write(file, unstaged.join('\n'));

  const hunk = parseDiffHunks(git(dir, 'diff', '--', rel), false)[0];
  assert.doesNotMatch(hunk.patch, /\n\n$/);
  sh(['git', 'apply', '--cached', '--whitespace=nowarn', '--recount'], dir, hunk.patch);
  const cached = git(dir, 'diff', '--cached', '--', rel);
  assert.match(cached, /cmd220": false/);
  assert.match(cached, /cmd221": false/);
});

test('staged line mode treats replacement pairs as one selectable line', dir => {
  write(path.join(dir, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');
  write(path.join(dir, 'a.txt'), 'one\nTWO\nthree\nFOUR\nfive\n');
  git(dir, 'add', 'a.txt');

  let hunk = parseDiffHunks(git(dir, 'diff', '--cached'), true)[0];
  assert.deepEqual(hunkChangedLineIndexes(hunk), [1, 2, 4, 5]);
  assert.deepEqual(hunkSelectableLineIndexes(hunk), [2, 5]);

  const patch = singleLinePatch(hunk, hunkSelectableLineIndexes(hunk)[0]);
  sh(['git', 'apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount'], dir, patch);
  const cached = git(dir, 'diff', '--cached');
  const unstaged = git(dir, 'diff');
  assert.doesNotMatch(cached, /\+TWO/);
  assert.match(cached, /\+FOUR/);
  assert.match(unstaged, /\+TWO/);
  assert.doesNotMatch(unstaged, /\+FOUR/);
});

test('staged LINE mode unstages selected adjacent replacement with zero context', dir => {
  write(path.join(dir, 'settings.json'), '  "cmd0": true,\n  "cmd1": true,\n  "cmd2": true,\n');
  git(dir, 'add', 'settings.json');
  git(dir, 'commit', '-m', 'base');
  write(path.join(dir, 'settings.json'), '  "cmd0": false,\n  "cmd1": false,\n  "cmd2": true,\n');
  git(dir, 'add', 'settings.json');

  const hunk = parseDiffHunks(git(dir, 'diff', '--cached', '--unified=0', '--', 'settings.json'), true)[0];
  assert.deepEqual(hunkChangedLineIndexes(hunk), [0, 1, 2, 3]);
  assert.deepEqual(hunkSelectableLineIndexes(hunk), [2, 3]);

  const patch = singleLinePatch(hunk, hunkSelectableLineIndexes(hunk)[1]);
  sh(['git', 'apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount', '--unidiff-zero'], dir, patch);
  const cached = git(dir, 'diff', '--cached', '--', 'settings.json');
  const unstaged = git(dir, 'diff', '--', 'settings.json');
  assert.match(cached, /\+  "cmd0": false,/);
  assert.doesNotMatch(cached, /\+  "cmd1": false,/);
  assert.match(unstaged, /\+  "cmd1": false,/);
  assert.doesNotMatch(unstaged, /\+  "cmd0": false,/);
});

test('line patches apply with unidiff-zero fallback both U to S and S to U', dir => {
  write(path.join(dir, 'settings.json'), Array.from({ length: 20 }, (_, i) => `  "cmd${i}": true,`).join('\n') + '\n');
  git(dir, 'add', 'settings.json');
  git(dir, 'commit', '-m', 'base');
  const changed = Array.from({ length: 20 }, (_, i) => `  "cmd${i}": ${i === 7 || i === 8 ? 'false' : 'true'},`).join('\n') + '\n';

  write(path.join(dir, 'settings.json'), changed);
  let unstagedHunk = parseDiffHunks(git(dir, 'diff', '--', 'settings.json'), false)[0];
  let stagePatch = singleLinePatch(unstagedHunk, hunkSelectableLineIndexes(unstagedHunk)[0]);
  sh(['git', 'apply', '--cached', '--whitespace=nowarn', '--recount', '--unidiff-zero'], dir, stagePatch);
  assert.match(git(dir, 'diff', '--cached', '--', 'settings.json'), /\+  "cmd7": false,/);

  git(dir, 'reset', '--hard', 'HEAD');
  write(path.join(dir, 'settings.json'), changed);
  git(dir, 'add', 'settings.json');
  let stagedHunk = parseDiffHunks(git(dir, 'diff', '--cached', '--', 'settings.json'), true)[0];
  let unstagePatch = singleLinePatch(stagedHunk, hunkSelectableLineIndexes(stagedHunk)[0]);
  sh(['git', 'apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount', '--unidiff-zero'], dir, unstagePatch);
  assert.doesNotMatch(git(dir, 'diff', '--cached', '--', 'settings.json'), /\+  "cmd7": false,/);
  assert.match(git(dir, 'diff', '--cached', '--', 'settings.json'), /\+  "cmd8": false,/);
});

test('singleLinePatch handles zero-count pure add/delete hunks', dir => {
  write(path.join(dir, 'a.txt'), 'middle\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');

  write(path.join(dir, 'a.txt'), 'top\nmiddle\n');
  let hunk = parseDiffHunks(git(dir, 'diff', '--unified=0'), false)[0];
  let patch = singleLinePatch(hunk, hunkChangedLineIndexes(hunk)[0]);
  assert.match(patch, /@@ -0,0 \+1 @@/);
  sh(['git', 'apply', '--cached', '--whitespace=nowarn', '--recount', '--unidiff-zero'], dir, patch);
  assert.match(git(dir, 'diff', '--cached'), /\+top/);
  git(dir, 'restore', '--staged', 'a.txt');

  write(path.join(dir, 'a.txt'), '');
  hunk = parseDiffHunks(git(dir, 'diff', '--unified=0'), false)[0];
  patch = singleLinePatch(hunk, hunkChangedLineIndexes(hunk)[0]);
  assert.match(patch, /@@ -1 \+0,0 @@/);
  sh(['git', 'apply', '--cached', '--whitespace=nowarn', '--recount', '--unidiff-zero'], dir, patch);
  assert.match(git(dir, 'diff', '--cached'), /-middle/);
});

test('binary diffs produce no patchable hunks instead of fake line actions', dir => {
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3, 4]));
  git(dir, 'add', 'bin.dat');
  git(dir, 'commit', '-m', 'base');
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 9, 3, 4, 5]));
  const hunks = parseDiffHunks(git(dir, 'diff', '--binary'), false);
  assert.equal(hunks.length, 0);
});

test('renamed text file hunk remains patchable', dir => {
  write(path.join(dir, 'old.txt'), 'one\ntwo\nthree\n');
  git(dir, 'add', 'old.txt');
  git(dir, 'commit', '-m', 'base');
  git(dir, 'mv', 'old.txt', 'new.txt');
  write(path.join(dir, 'new.txt'), 'one\nTWO\nthree\n');
  git(dir, 'add', 'new.txt');
  const hunks = parseDiffHunks(git(dir, 'diff', '--cached', '--find-renames=50%'), true);
  assert.equal(hunks.length, 1);
  assert.match(hunks[0].patch, /rename from old\.txt/);
  assert.match(hunks[0].patch, /rename to new\.txt/);
});
