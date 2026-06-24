const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const originalLoad = Module._load;
Module._load = function mockVscode(request, parent, isMain) {
  if (request === 'vscode') return { workspace: {}, extensions: { getExtension: () => undefined } };
  return originalLoad.call(this, request, parent, isMain);
};

const { applyHunk, applyLine } = require('../out/gitActions');
const { setActiveWorkspaceRoot } = require('../out/gitService');
const { hunkSelectableLineIndexes, parseDiffHunks } = require('../out/hunkPatch');

function sh(command, cwd, input) {
  return cp.execFileSync(command[0], command.slice(1), { cwd, input, encoding: 'utf8', stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
}
function git(cwd, ...args) { return sh(['git', ...args], cwd); }
function write(file, text) { fs.writeFileSync(file, text); }
function snapshot(dir) {
  return {
    cached: git(dir, 'diff', '--cached'),
    unstaged: git(dir, 'diff'),
    status: git(dir, 'status', '--porcelain')
  };
}

async function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-patch-recovery-'));
  try {
    git(dir, 'init');
    git(dir, 'config', 'user.email', 'lgvs@example.test');
    git(dir, 'config', 'user.name', 'LazyGitVS Test');
    setActiveWorkspaceRoot(dir);
    await fn(dir);
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stderr || error.stdout || error);
    process.exitCode = 1;
  } finally {
    setActiveWorkspaceRoot(undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function prepareStalePatchRepo(dir) {
  const file = path.join(dir, 'a.txt');
  write(file, 'one\ntwo\nthree\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');

  write(file, 'one\nTWO\nthree\n');
  const hunk = parseDiffHunks(git(dir, 'diff', '--unified=0', '--', 'a.txt'), false)[0];

  write(file, 'one\nINDEX\nthree\n');
  git(dir, 'add', 'a.txt');
  write(file, 'one\nWORKTREE\nthree\n');
  return hunk;
}

(async () => {
  await test('failed stale HUNK stage is preflighted and leaves index/worktree intact', async dir => {
    const hunk = prepareStalePatchRepo(dir);
    const before = snapshot(dir);
    await assert.rejects(
      () => applyHunk(hunk),
      error => {
        assert.equal(error.name, 'PatchApplyError');
        assert.equal(error.patchOperation, 'stage hunk');
        assert.equal(error.patchPhase, 'check');
        assert.match(error.message, /Cannot stage hunk: patch no longer applies cleanly/);
        assert.match(error.causeMessage, /patch failed|does not apply/i);
        return true;
      }
    );
    assert.deepEqual(snapshot(dir), before);
  });

  await test('failed stale LINE stage is preflighted and leaves index/worktree intact', async dir => {
    const hunk = prepareStalePatchRepo(dir);
    const before = snapshot(dir);
    await assert.rejects(
      () => applyLine(hunk, hunkSelectableLineIndexes(hunk)[0]),
      error => {
        assert.equal(error.name, 'PatchApplyError');
        assert.equal(error.patchOperation, 'stage line');
        assert.equal(error.patchPhase, 'check');
        assert.match(error.message, /Cannot stage line: patch no longer applies cleanly/);
        assert.match(error.causeMessage, /patch failed|does not apply/i);
        return true;
      }
    );
    assert.deepEqual(snapshot(dir), before);
  });
})();
