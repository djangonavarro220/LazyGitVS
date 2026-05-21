const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function sh(command, cwd, input) {
  return cp.execFileSync(command[0], command.slice(1), { cwd, input, encoding: 'utf8', stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
}
function git(cwd, ...args) { return sh(['git', ...args], cwd); }
function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-git-'));
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

test('stage and unstage file primitive', dir => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  assert.match(git(dir, 'status', '--porcelain'), /^A  a.txt/m);
  git(dir, 'rm', '--cached', '--', 'a.txt');
  assert.match(git(dir, 'status', '--porcelain'), /^\?\? a.txt/m);
});

test('stash primitive stores and restores changes', dir => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  git(dir, 'stash', 'push');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\n');
  git(dir, 'stash', 'pop');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'two\n');
});

test('reset and nuke primitive cleans tracked and untracked changes', dir => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(dir, 'junk.txt'), 'junk\n');
  git(dir, 'reset', '--hard', 'HEAD');
  git(dir, 'clean', '-fd');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(fs.existsSync(path.join(dir, 'junk.txt')), false);
});

test('conflict ours/theirs primitives resolve sides', dir => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');
  git(dir, 'checkout', '-b', 'other');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'theirs\n');
  git(dir, 'commit', '-am', 'theirs');
  git(dir, 'checkout', 'master');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'ours\n');
  git(dir, 'commit', '-am', 'ours');
  try { git(dir, 'merge', 'other'); } catch (_) {}
  assert.match(git(dir, 'status', '--porcelain'), /^UU a.txt/m);
  git(dir, 'checkout', '--ours', '--', 'a.txt');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'ours\n');
  git(dir, 'add', 'a.txt');
  assert.doesNotMatch(git(dir, 'status', '--porcelain'), /^UU/m);
});
