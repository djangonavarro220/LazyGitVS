const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function sh(command, cwd, input) {
  return cp.execFileSync(command[0], command.slice(1), {
    cwd,
    input,
    encoding: 'utf8',
    stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
  });
}

function git(cwd, ...args) {
  return sh(['git', ...args], cwd);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function append(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, content);
}

function initRepo(prefix = 'lgvs-fixture-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'lgvs@example.test');
  git(dir, 'config', 'user.name', 'LazyGitVS Fixture');
  return dir;
}

function createRealisticRepo() {
  const dir = initRepo('lgvs-realistic-');

  write(path.join(dir, 'settings.json'), JSON.stringify({
    alpha: 'one',
    beta: 'two',
    gamma: 'three',
    delta: 'four'
  }, null, 2) + '\n');
  write(path.join(dir, 'README.md'), '# LGVS fixture\n\nbase\n');
  write(path.join(dir, 'src/app.ts'), 'export const value = 1;\n\nexport function greet() {\n  return "hello";\n}\n');
  write(path.join(dir, 'conflict.txt'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'initial');
  git(dir, 'branch', 'feature/dogfood');
  git(dir, 'tag', 'v0.0.1');
  git(dir, 'remote', 'add', 'origin', 'https://example.invalid/lazygitvs-dogfood.git');

  write(path.join(dir, 'STASHED.md'), 'temporary stash evidence\n');
  git(dir, 'add', 'STASHED.md');
  git(dir, 'stash', 'push', '-m', 'dogfood stash entry');

  write(path.join(dir, 'settings.json'), JSON.stringify({
    alpha: 'ONE',
    beta: 'two',
    gamma: 'three',
    delta: 'FOUR'
  }, null, 2) + '\n');
  git(dir, 'add', 'settings.json');
  write(path.join(dir, 'settings.json'), JSON.stringify({
    alpha: 'ONE',
    beta: 'two',
    gamma: 'THREE',
    delta: 'FOUR'
  }, null, 2) + '\n');
  append(path.join(dir, 'README.md'), 'unstaged readme line\n');
  write(path.join(dir, 'src/app.ts'), 'export const value = 2;\n\nexport function greet() {\n  return "hello dogfood";\n}\n');
  write(path.join(dir, 'notes.md'), 'untracked note\n');

  function createConflict() {
    git(dir, 'reset', '--hard', 'HEAD');
    git(dir, 'clean', '-fd');
    git(dir, 'checkout', '-B', 'conflict-other');
    write(path.join(dir, 'conflict.txt'), 'theirs\n');
    git(dir, 'commit', '-am', 'theirs conflict side');
    git(dir, 'checkout', 'master');
    write(path.join(dir, 'conflict.txt'), 'ours\n');
    git(dir, 'commit', '-am', 'ours conflict side');
    try {
      git(dir, 'merge', 'conflict-other');
    } catch (_) {
      // Expected: leave the repo in a conflicted state for assertions.
    }
  }

  return { dir, createConflict };
}

function cleanupFixture(fixture) {
  if (!fixture) return;
  const dir = typeof fixture === 'string' ? fixture : fixture.dir;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { createRealisticRepo, cleanupFixture, git, initRepo };
