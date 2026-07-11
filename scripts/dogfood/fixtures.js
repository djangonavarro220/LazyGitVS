const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed
STDOUT:
${r.stdout}
STDERR:
${r.stderr}`);
  return r.stdout.trim();
}
function git(cwd, ...args) { return sh('git', args, { cwd }); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, value) { ensureDir(path.dirname(p)); fs.writeFileSync(p, value); }
function append(p, value) { ensureDir(path.dirname(p)); fs.appendFileSync(p, value); }

const telemetryReposByFixture = new Map();

function makeTelemetryFixture() {
  const fileCount = Number(process.env.LGVS_TELEMETRY_FILE_COUNT);
  const repoCount = Number(process.env.LGVS_TELEMETRY_REPO_COUNT);
  if (![320, 2000, 10000].includes(fileCount) || ![1, 4, 16].includes(repoCount)) {
    throw new Error(`Unsupported telemetry fixture ${fileCount} files / ${repoCount} repos`);
  }
  const primary = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-telemetry-'));
  const repos = Array.from({ length: repoCount }, (_, index) => index === 0 ? primary : `${primary}-repo-${String(index + 1).padStart(2, '0')}`);
  let remaining = fileCount;
  repos.forEach((repo, repoIndex) => {
    ensureDir(repo);
    git(repo, 'init');
    git(repo, 'config', 'user.email', 'lgvs@example.test');
    git(repo, 'config', 'user.name', 'LGVS Telemetry');
    const count = Math.ceil(remaining / (repoCount - repoIndex));
    remaining -= count;
    for (let i = 0; i < count; i++) write(path.join(repo, 'bulk', `file-${String(i).padStart(5, '0')}.txt`), `base ${repoIndex}/${i}\n`);
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'telemetry baseline');
    for (let i = 0; i < Math.min(count, 20); i++) append(path.join(repo, 'bulk', `file-${String(i).padStart(5, '0')}.txt`), `changed ${repoIndex}/${i}\n`);
  });
  telemetryReposByFixture.set(primary, repos);
  return primary;
}

function makeFixture() {
  if (process.env.LGVS_DOGFOOD_TELEMETRY) return makeTelemetryFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-dogfood-'));
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'lgvs@example.test');
  git(dir, 'config', 'user.name', 'LGVS Dogfood');
  write(path.join(dir, 'settings.json'), JSON.stringify({ alpha: 'one', beta: 'two', gamma: 'three', delta: 'four' }, null, 2) + '\n');
  write(path.join(dir, 'README.md'), '# LGVS dogfood\n\nbase\n\nline 4\nline 5\nline 6\nline 7\nline 8\ntail\n');
  write(path.join(dir, 'src/app.ts'), 'export const value = 1;\n\nexport function greet() {\n  return "hello";\n}\n');
  write(path.join(dir, '.gitignore'), 'workspace/\n');
  if (process.env.LGVS_DOGFOOD_EDGE_FILES) {
    write(path.join(dir, 'DELETE_ME.md'), 'delete me baseline\n');
    write(path.join(dir, 'RENAME_ME.md'), 'rename me baseline\n');
    write(path.join(dir, 'CONFLICT.md'), 'base conflict line\n');
  }
  if (process.env.LGVS_DOGFOOD_BINARY_FILE) {
    fs.writeFileSync(path.join(dir, 'BINARY.bin'), Buffer.from([0, 159, 146, 150, 0, 1, 2, 3]));
  }
  if (process.env.LGVS_DOGFOOD_LARGE_REPO) {
    for (let i = 0; i < 320; i++) write(path.join(dir, `bulk/file-${String(i).padStart(3, '0')}.txt`), `base ${i}\n`);
  }
  if (process.env.LGVS_DOGFOOD_DEEP_TREE) {
    write(path.join(dir, '.config/karabiner/assets/complex_modifications/misc_rules.json'), '{"rules":[]}\n');
    write(path.join(dir, '.config/vscode/keybindings.json'), '[]\n');
    write(path.join(dir, '.config/vscode/settings.json'), '{}\n');
    write(path.join(dir, 'AGENTS.md'), 'dogfood agent notes\n');
  }
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'initial');
  write(path.join(dir, 'commit-tree/routes/api/target.ts'), 'export const COMMIT_TREE_TARGET = "nested commit fixture";\n');
  git(dir, 'add', 'commit-tree/routes/api/target.ts');
  git(dir, 'commit', '-m', 'dogfood commit file tree');
  git(dir, 'branch', 'feature/dogfood');
  git(dir, 'tag', 'v0.0.1');
  git(dir, 'remote', 'add', 'origin', 'https://example.invalid/lazygitvs-dogfood.git');

  if (process.env.LGVS_DOGFOOD_EDGE_FILES) {
    fs.unlinkSync(path.join(dir, 'DELETE_ME.md'));
    git(dir, 'mv', 'RENAME_ME.md', 'RENAMED.md');
    git(dir, 'checkout', '-b', 'lgvs-conflict-left');
    write(path.join(dir, 'CONFLICT.md'), 'left conflict line\n');
    git(dir, 'add', 'CONFLICT.md');
    git(dir, 'commit', '-m', 'left conflict change');
    git(dir, 'checkout', 'master');
    write(path.join(dir, 'CONFLICT.md'), 'right conflict line\n');
    git(dir, 'add', 'CONFLICT.md');
    git(dir, 'commit', '-m', 'right conflict change');
    spawnSync('git', ['merge', 'lgvs-conflict-left'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return dir;
  }

  write(path.join(dir, 'STASHED.md'), 'temporary stash evidence\n');
  git(dir, 'add', 'STASHED.md');
  git(dir, 'stash', 'push', '-m', 'dogfood stash entry');

  write(path.join(dir, 'settings.json'), JSON.stringify({ alpha: 'ONE', beta: 'two', gamma: 'three', delta: 'FOUR' }, null, 2) + '\n');
  git(dir, 'add', 'settings.json');
  write(path.join(dir, 'settings.json'), JSON.stringify({ alpha: 'ONE', beta: 'two', gamma: 'THREE', delta: 'FOUR' }, null, 2) + '\n');
  write(path.join(dir, 'README.md'), '# LGVS dogfood\n\nbase changed\n\nline 4\nline 5\nline 6\nline 7\nline 8\ntail changed\n');
  write(path.join(dir, 'src/app.ts'), 'export const value = 2;\n\nexport function greet() {\n  return "hello dogfood";\n}\n');
  if (process.env.LGVS_DOGFOOD_BINARY_FILE) {
    fs.writeFileSync(path.join(dir, 'BINARY.bin'), Buffer.from([0, 159, 146, 150, 9, 8, 7, 6]));
  }
  if (process.env.LGVS_DOGFOOD_LARGE_REPO) {
    for (let i = 0; i < 320; i++) append(path.join(dir, `bulk/file-${String(i).padStart(3, '0')}.txt`), `changed ${i}\n`);
  }
  if (process.env.LGVS_DOGFOOD_DEEP_TREE) {
    append(path.join(dir, 'AGENTS.md'), 'staged agent change\n');
    git(dir, 'add', 'AGENTS.md');
    write(path.join(dir, '.config/karabiner/assets/complex_modifications/misc_rules.json'), '{"rules":[{"description":"changed"}]}\n');
    write(path.join(dir, '.config/vscode/keybindings.json'), '[{"key":"x","command":"noop"}]\n');
    write(path.join(dir, '.config/vscode/settings.json'), '{"editor.tabSize":2}\n');
  }
  const secondaryRepo = `${dir}-other-repo`;
  ensureDir(secondaryRepo);
  git(secondaryRepo, 'init');
  git(secondaryRepo, 'config', 'user.email', 'lgvs@example.test');
  git(secondaryRepo, 'config', 'user.name', 'LGVS Dogfood');
  write(path.join(secondaryRepo, 'OTHER_REPO_SENTINEL.md'), 'secondary repository baseline\n');
  git(secondaryRepo, 'add', '.');
  git(secondaryRepo, 'commit', '-m', 'initial secondary');
  append(path.join(secondaryRepo, 'OTHER_REPO_SENTINEL.md'), 'secondary repository changed\n');

  const deepRepo = path.join(dir, 'workspace', 'level-one', 'level-two', 'deep-repo');
  ensureDir(deepRepo);
  git(deepRepo, 'init');
  git(deepRepo, 'config', 'user.email', 'lgvs@example.test');
  git(deepRepo, 'config', 'user.name', 'LGVS Dogfood');
  write(path.join(deepRepo, 'DEEP_REPO_SENTINEL.md'), 'deep repository baseline\n');
  git(deepRepo, 'add', '.');
  git(deepRepo, 'commit', '-m', 'initial deep');
  append(path.join(deepRepo, 'DEEP_REPO_SENTINEL.md'), 'deep repository changed\n');
  // Keep the primary keyboard flow on tracked files. Untracked files are useful,
  // but if they sort first they turn Enter into the no-hunk untracked edge case
  // and mask the real HUNK/LINE staging path.
  return dir;
}
function fixtureRepos(fixture) { return telemetryReposByFixture.get(fixture) || [fixture, `${fixture}-other-repo`, path.join(fixture, 'workspace', 'level-one', 'level-two', 'deep-repo')]; }
function secondaryFixtureRepo(fixture) { return fixtureRepos(fixture)[1]; }
function deepNestedFixtureRepo(fixture) { return fixtureRepos(fixture)[2]; }
function status(cwd) { return git(cwd, 'status', '--short'); }
function diffCachedNames(cwd) { return git(cwd, 'diff', '--cached', '--name-only'); }
function diffNames(cwd) { return git(cwd, 'diff', '--name-only'); }
function startMergeOperation(cwd) {
  git(cwd, 'stash', 'push', '-m', 'dogfood operation fixture');
  git(cwd, 'checkout', '-b', 'lgvs-operation-other');
  write(path.join(cwd, 'OPERATION_CONFLICT.md'), 'other\n');
  git(cwd, 'add', 'OPERATION_CONFLICT.md');
  git(cwd, 'commit', '-m', 'operation other side');
  git(cwd, 'checkout', 'master');
  write(path.join(cwd, 'OPERATION_CONFLICT.md'), 'master\n');
  git(cwd, 'add', 'OPERATION_CONFLICT.md');
  git(cwd, 'commit', '-m', 'operation master side');
  spawnSync('git', ['merge', 'lgvs-operation-other'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!fs.existsSync(path.join(cwd, '.git', 'MERGE_HEAD'))) throw new Error('Dogfood merge fixture did not enter merge state');
}
function mergeOperationInProgress(cwd) { return fs.existsSync(path.join(cwd, '.git', 'MERGE_HEAD')); }

module.exports = { makeFixture, fixtureRepos, secondaryFixtureRepo, deepNestedFixtureRepo, status, diffCachedNames, diffNames, git, ensureDir, write, startMergeOperation, mergeOperationInProgress };
