const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const controllerPath = path.join(root, 'src', 'commitFilesController.ts');
assert(fs.existsSync(controllerPath), 'Commit-files must have one isolated CommitFilesController module.');
const controllerSource = fs.readFileSync(controllerPath, 'utf8');
const {
  CommitFilesController,
  commitFilesFocusMessageAllowed,
  commitFilesHostMessageAllowed,
  loadCommitFilesFor,
} = require('../out/commitFilesController');

assert(extension.includes("from './commitFilesController'"), 'extension.ts must bind Commit-files behavior to the authoritative controller.');
assert(extension.includes('private readonly commitFilesController = new CommitFilesController'), 'extension.ts must instantiate one authoritative CommitFilesController.');
for (const forbidden of ['CommitFilesSessionMachine', 'commitFilesSession', 'commitFileOwner', 'commitFileLoading', 'private commitFilesFor', 'private commitFileItems', 'private commitFileSelected', 'private collapsedCommitFileDirs']) {
  assert(!extension.includes(forbidden), `split Commit-files authority must not remain in extension.ts: ${forbidden}`);
}
for (const required of ['class CommitFilesController', 'beginLoad', 'activateLoaded', 'invalidate', 'loadIsCurrent', 'previewCurrent', 'hunkCurrent', 'runMutation']) {
  assert(controllerSource.includes(required), `controller must own ${required}.`);
}
assert(controllerSource.includes('commitFileCheckout') && controllerSource.includes('commitFileClipboard') && controllerSource.includes('discardCommitFileChanges'), 'controller must own Commit-files action orchestration.');

(async () => {
  const controller = new CommitFilesController({
    getContext: () => ({ liveRepo: '/repo-a', selectedCommitHash: 'a'.repeat(40), filterText: '', activeViewPanel: 'commits', physicalPanel: 'commits', selectionEpoch: 1 }),
    runGit: async () => 'refs/heads/main\n',
    loadFiles: async () => [{ status: 'M', path: 'a.txt' }, { status: 'A', path: 'src/needle.ts' }, { status: 'R', oldPath: 'legacy-name.ts', path: 'renamed.ts' }],
    treeOptions: {},
  });
  const token = controller.beginLoad('a'.repeat(40));
  assert(token);
  const loaded = await loadCommitFilesFor({ controller, token, commit: { hash: 'a'.repeat(40) } });
  assert(loaded, 'fresh load should activate through the controller boundary.');
  assert(controller.active, 'controller should own the active drilldown.');
  const renderCapability = controller.capabilityForRender();
  assert.equal(commitFilesHostMessageAllowed('commits', controller.context(), renderCapability), true);
  const physicallyFocusedContext = { ...controller.context(), activeViewPanel: 'files' };
  assert.equal(commitFilesHostMessageAllowed('commits', physicallyFocusedContext, renderCapability), false, 'actions stay blocked until Commits is active');
  assert.equal(commitFilesFocusMessageAllowed('commits', physicallyFocusedContext, renderCapability), true, 'the current physical Commit-files document may adopt focus before it is logically active');
  assert.equal(commitFilesFocusMessageAllowed('files', physicallyFocusedContext, renderCapability), false);
  assert.equal(commitFilesFocusMessageAllowed('commits', physicallyFocusedContext, `${renderCapability}-stale`), false);
  assert(extension.includes("type === 'focusArea' ? commitFilesFocusRequestAllowed() : commitFilesRequestAllowed()"), 'only focusArea may use the focus-adoption capability predicate');
  controller.invalidateTransient({ selectionEpoch: 2, filterText: 'needle' });
  assert.deepStrictEqual(controller.rows({ showFileTree: false }).map(row => row.file?.path).filter(Boolean), ['src/needle.ts'], 'Commit-files search must filter controller-owned rows');
  assert.equal(controller.owner.selectedRowIdentity, 'file:src/needle.ts', 'filtering must rebind ownership to the visible selected row');
  controller.invalidateTransient({ selectionEpoch: 3, filterText: 'legacy-name' });
  assert.deepStrictEqual(controller.rows({ showFileTree: false }).map(row => row.file?.path).filter(Boolean), ['renamed.ts'], 'Commit-files search must include old rename paths');
  controller.invalidateTransient({ selectionEpoch: 4, filterText: '' });
  assert.equal(controller.rows({ showFileTree: false }).length, 3, 'clearing search must restore all Commit-files rows');
  controller.invalidate();
  assert.equal(controller.active, false);
  console.log('commitFilesController tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
