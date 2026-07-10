const assert = require('assert');
const { RefreshCoordinator } = require('../out/refreshCoordinator');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

(async () => {
  const coordinator = new RefreshCoordinator();
  const firstRefreshStarted = deferred();
  const releaseFirstRefresh = deferred();
  let selectedRepo = 'repo-a';
  let renderedRepo;
  const runs = [];

  const loadSelectedRepository = async updatePreview => {
    const repoForRun = selectedRepo;
    runs.push({ repo: repoForRun, updatePreview });
    if (runs.length === 1) {
      firstRefreshStarted.resolve();
      await releaseFirstRefresh.promise;
    }
    renderedRepo = repoForRun;
  };

  const backgroundRefresh = coordinator.request(false, loadSelectedRepository);
  await firstRefreshStarted.promise;

  selectedRepo = 'repo-b';
  let selectionResolved = false;
  const explicitSelectionRefresh = coordinator.request(true, loadSelectedRepository)
    .then(() => { selectionResolved = true; });

  await Promise.resolve();
  assert.equal(selectionResolved, false, 'selection must not resolve against the refresh already in flight');
  assert.equal(coordinator.hasPending, true, 'selection during an in-flight refresh must queue one follow-up pass');

  releaseFirstRefresh.resolve();
  await explicitSelectionRefresh;
  await backgroundRefresh;

  assert.deepEqual(runs, [
    { repo: 'repo-a', updatePreview: false },
    { repo: 'repo-b', updatePreview: true }
  ], 'refresh storms should coalesce while preserving an explicit selection follow-up for the new repo');
  assert.equal(renderedRepo, 'repo-b', 'awaiting explicit selection must guarantee the selected repository data is rendered');
  assert.equal(coordinator.isInFlight, false, 'the coordinator must become idle after draining the pending selection');
  assert.equal(coordinator.hasPending, false, 'the coordinator must not leave a redundant background refresh queued');

  console.log('refreshSelectionCoalescing tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
