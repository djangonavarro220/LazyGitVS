const assert = require('assert');
const { CommitFilesController, commitFilesHostMessageAllowed, loadCommitFilesFor } = require('../out/commitFilesController');

const hashA = 'a'.repeat(40);
const hashB = 'b'.repeat(40);
const file = path => ({ status: 'M', path });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness(initial = {}) {
  const state = { liveRepo: '/repo-a', selectedCommitHash: hashA, filterText: '', selectionEpoch: 1, activeViewPanel: 'commits', physicalPanel: 'commits', ...initial };
  const calls = [];
  const controller = new CommitFilesController({
    getContext: () => state,
    runGit: async (args, cwd) => { calls.push({ args, cwd }); return args[2]?.includes('HEAD^{commit}') ? hashA + '\n' : 'refs/heads/main\n'; },
    loadFiles: async hash => [file(`${hash.slice(0, 4)}.txt`)],
    treeOptions: {},
    capabilityFactory: kind => `${kind}-${calls.length}`,
  });
  return { state, calls, controller };
}

(async () => {
  const { state, controller } = harness();
  const token = controller.beginLoad(hashA);
  assert.deepStrictEqual(Object.keys(token).sort(), ['commitHash', 'filterText', 'generation', 'liveRepo', 'selectionEpoch']);
  assert(await loadCommitFilesFor({ controller, token, commit: { hash: hashA } }));
  assert(controller.active);
  const capability = controller.capabilityForRender();
  assert.equal(commitFilesHostMessageAllowed('commits', controller.context(), capability), true);
  assert.equal(commitFilesHostMessageAllowed('files', controller.context(), capability), false);
  state.physicalPanel = 'files';
  assert.equal(commitFilesHostMessageAllowed('commits', controller.context(), capability), false);
  state.physicalPanel = 'commits';
  const preview = controller.beginPreview();
  controller.setSelected(0, 2);
  assert.equal(controller.previewCurrent(preview), false, 'selection changes invalidate preview publication');
  controller.invalidate();
  assert.equal(controller.active, false);

  const stale = harness({ selectedCommitHash: hashA });
  const pendingFiles = deferred();
  stale.controller.options.loadFiles = async () => pendingFiles.promise;
  const staleToken = stale.controller.beginLoad(hashA);
  const staleLoad = loadCommitFilesFor({ controller: stale.controller, token: staleToken, commit: { hash: hashA } });
  stale.state.selectedCommitHash = hashB;
  stale.state.selectionEpoch = 2;
  pendingFiles.resolve([file('stale.txt')]);
  assert.equal(await staleLoad, false, 'a late load cannot publish after the selected commit changes');
  assert.equal(stale.controller.active, false);

  console.log('commitFilesController compatibility tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
