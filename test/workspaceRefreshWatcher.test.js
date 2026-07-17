const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const { GitRepositoryRefreshWatcher, createGitRepositoryRefreshWatcher } = require('../out/gitRepositoryRefreshWatcher');

function emitter() {
  const listeners = new Set();
  return {
    event(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire(value) { for (const listener of [...listeners]) listener(value); },
    get size() { return listeners.size; }
  };
}

function repository(name) {
  const changes = emitter();
  return { name, state: { onDidChange: changes.event }, changes };
}

const repoA = repository('repo-a');
const repoB = repository('repo-b');
const opened = emitter();
const closed = emitter();
const unrelatedWorkspaceChanges = emitter();
const api = {
  repositories: [repoA, repoB],
  onDidOpenRepository: opened.event,
  onDidCloseRepository: closed.event
};

let scheduled = 0;
const watcher = new GitRepositoryRefreshWatcher(() => { scheduled++; });
watcher.connect(api);

let baselineScheduled = 0;
const baselineSubscription = unrelatedWorkspaceChanges.event(() => { baselineScheduled++; });
for (let i = 0; i < 1000; i++) {
  unrelatedWorkspaceChanges.fire(`dist/generated-${i}.js`);
  if (i === 499) repoA.changes.fire();
}
baselineSubscription.dispose();
assert.equal(baselineScheduled, 1000, 'the previous broad watcher seam schedules once for every generated event before debounce');
assert.equal(scheduled, 1, 'sustained generated churn must not delay or add schedules around a legitimate repository change');
repoB.changes.fire();
assert.equal(scheduled, 2, 'each repository root must remain independently observed');

const repoC = repository('repo-c');
opened.fire(repoC);
repoC.changes.fire();
assert.equal(scheduled, 3, 'repositories opened after activation must be observed without recreating a workspace-wide watcher');

closed.fire(repoA);
repoA.changes.fire();
assert.equal(scheduled, 3, 'closed repositories must release their state listener');

watcher.dispose();
repoB.changes.fire();
repoC.changes.fire();
assert.equal(scheduled, 3, 'disposing the lifecycle must release every repository listener');
assert.equal(repoA.changes.size + repoB.changes.size + repoC.changes.size, 0, 'repository listeners must not leak');

watcher.connect(api);
repoB.changes.fire();
assert.equal(scheduled, 3, 'connect after disposal must not resume refresh scheduling');
assert.equal(repoA.changes.size + repoB.changes.size + repoC.changes.size, 0, 'connect after disposal must not reinstall repository listeners');

assert(!extensionSource.includes("createFileSystemWatcher('**/*')"), 'production must not retain the broad workspace watcher');
assert(extensionSource.includes('createGitRepositoryRefreshWatcher(() => this.scheduleRefresh(), vscode.extensions)'), 'the production controller must invoke the executable Git extension wiring seam');

async function testProductionWiring() {
  const missingCalls = [];
  const missingWatcher = createGitRepositoryRefreshWatcher(() => assert.fail('missing vscode.git must not schedule'), {
    getExtension(id) { missingCalls.push(id); return undefined; }
  });
  assert.deepEqual(missingCalls, ['vscode.git'], 'production wiring must request the built-in Git extension');
  missingWatcher.dispose();

  const wiredRepo = repository('wired-repo');
  let activateCalls = 0;
  const apiVersions = [];
  let wiredSchedules = 0;
  const wiredWatcher = createGitRepositoryRefreshWatcher(() => { wiredSchedules++; }, {
    getExtension() {
      return {
        activate() {
          activateCalls++;
          return Promise.resolve({
            getAPI(version) { apiVersions.push(version); return { repositories: [wiredRepo] }; }
          });
        }
      };
    }
  });
  await Promise.resolve();
  wiredRepo.changes.fire();
  assert.equal(activateCalls, 1, 'production wiring must activate vscode.git');
  assert.deepEqual(apiVersions, [1], 'production wiring must obtain Git API version 1');
  assert.equal(wiredSchedules, 1, 'production wiring must connect repository changes to refresh scheduling');
  wiredWatcher.dispose();

  let rejectionSchedules = 0;
  const rejectingWatcher = createGitRepositoryRefreshWatcher(() => { rejectionSchedules++; }, {
    getExtension() { return { activate: () => Promise.reject(new Error('activation failed')) }; }
  });
  await Promise.resolve();
  assert.equal(rejectionSchedules, 0, 'activation rejection must remain contained');
  rejectingWatcher.dispose();

  const delayedRepo = repository('delayed-repo');
  let resolveActivation;
  const delayedActivation = new Promise(resolve => { resolveActivation = resolve; });
  let delayedSchedules = 0;
  const delayedWatcher = createGitRepositoryRefreshWatcher(() => { delayedSchedules++; }, {
    getExtension() { return { activate: () => delayedActivation }; }
  });
  delayedWatcher.dispose();
  resolveActivation({ getAPI: version => {
    assert.equal(version, 1);
    return { repositories: [delayedRepo] };
  } });
  await delayedActivation;
  await Promise.resolve();
  delayedRepo.changes.fire();
  assert.equal(delayedRepo.changes.size, 0, 'delayed activation after disposal must not install listeners');
  assert.equal(delayedSchedules, 0, 'delayed activation after disposal must not schedule refresh');
}

testProductionWiring().then(() => {
  console.log(JSON.stringify({ generatedEvents: 1000, beforeGeneratedRefreshSchedules: baselineScheduled, afterGeneratedRefreshSchedules: 0, legitimateRepositoryChanges: 3, legitimateRefreshSchedules: 3, multiRootRepositories: 3 }));
  console.log('workspaceRefreshWatcher tests passed');
}, error => {
  console.error(error);
  process.exitCode = 1;
});
