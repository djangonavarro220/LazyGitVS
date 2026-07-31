const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CommitFilesController, LatestWinsAsyncGate, commitFilesHostMessageAllowed, loadCommitFilesFor } = require('../out/commitFilesController');
const { enterCommitFileHunkMode } = require('../out/commitFileHunk');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness(overrides = {}) {
  const state = { liveRepo: '/repo-a', selectedCommitHash: A, filterText: '', selectionEpoch: 1, activeViewPanel: 'commits', physicalPanel: 'commits', ...overrides };
  let branch = 'refs/heads/main';
  let head = '1'.repeat(40);
  const controller = new CommitFilesController({
    getContext: () => state,
    runGit: async args => args[2] === 'HEAD^{commit}' ? `${head}\n` : `${branch}\n`,
    loadFiles: async hash => [{ status: 'M', path: `${hash[0]}.txt` }],
    treeOptions: {},
    capabilityFactory: kind => `${kind}-${Math.random()}`,
  });
  return { state, controller, setBranch(value) { branch = value; }, setHead(value) { head = value; } };
}
async function loadFrom(controller, hash) {
  const token = controller.beginLoad(hash);
  return loadCommitFilesFor({ controller, token, commit: { hash } });
}

(async () => {
  // Selection/commit race: an old response resolves after a newer selection.
  {
    const h = harness();
    const release = deferred();
    h.controller.options.loadFiles = async () => release.promise;
    const old = loadFrom(h.controller, A);
    h.state.selectedCommitHash = B;
    h.state.selectionEpoch = 2;
    release.resolve([{ status: 'M', path: 'old.txt' }]);
    assert.equal(await old, false, 'stale commit selection load must not activate');
    assert.equal(h.controller.active, false);
  }

  // Repository/workspace race: the same commit response is stale after root switch.
  {
    const h = harness();
    const release = deferred();
    h.controller.options.loadFiles = async () => release.promise;
    const old = loadFrom(h.controller, A);
    h.state.liveRepo = '/repo-b';
    release.resolve([{ status: 'M', path: 'wrong-repo.txt' }]);
    assert.equal(await old, false, 'stale repository load must not activate');
  }

  // Filter/selection epoch race: response must not cross a filter change.
  {
    const h = harness();
    const release = deferred();
    h.controller.options.loadFiles = async () => release.promise;
    const old = loadFrom(h.controller, A);
    h.state.filterText = 'new-filter';
    h.state.selectionEpoch = 3;
    release.resolve([{ status: 'M', path: 'filtered-out.txt' }]);
    assert.equal(await old, false, 'stale filter load must not publish');
  }

  // Rapid activation race: beginning B invalidates A even when A resolves last.
  {
    const h = harness();
    const releaseA = deferred();
    const releaseB = deferred();
    h.controller.options.loadFiles = async hash => hash === A ? releaseA.promise : releaseB.promise;
    const first = loadFrom(h.controller, A);
    h.state.selectedCommitHash = B;
    h.state.selectionEpoch = 2;
    const second = loadFrom(h.controller, B);
    releaseA.resolve([{ status: 'M', path: 'a.txt' }]);
    assert.equal(await first, false, 'superseded activation must not publish');
    releaseB.resolve([{ status: 'M', path: 'b.txt' }]);
    assert.equal(await second, true, 'latest activation must publish');
    assert.equal(h.controller.commit.hash, B);
  }

  // Active-view race and empty result are both fail-closed.
  {
    const h = harness();
    const release = deferred();
    h.controller.options.loadFiles = async () => release.promise;
    const old = loadFrom(h.controller, A);
    h.state.activeViewPanel = 'files';
    release.resolve([{ status: 'M', path: 'hidden.txt' }]);
    assert.equal(await old, false, 'inactive panel load must not publish');

    const empty = harness();
    empty.controller.options.loadFiles = async () => [];
    assert.equal(await loadFrom(empty.controller, A), false, 'empty file result must not create an active owner');
  }

  // Repository branch/ref drift invalidates an already loaded owner even with shared HEAD.
  {
    const h = harness();
    assert(await loadFrom(h.controller, A));
    const owner = h.controller.owner;
    h.setBranch('refs/heads/shared-history');
    assert.equal(await h.controller.revalidateOwner(owner), false, 'branch/ref drift must invalidate the captured owner');
    assert.equal(h.controller.ownerIsCurrent(owner), true, 'synchronous state remains unchanged until the controller resets it');
  }

  // Repository branch/ref drift during the file read prevents activation even with shared HEAD.
  {
    const h = harness();
    const started = deferred();
    const release = deferred();
    h.controller.options.loadFiles = async () => { started.resolve(); return release.promise; };
    const loading = loadFrom(h.controller, A);
    await started.promise;
    h.setBranch('refs/heads/shared-history');
    release.resolve([{ status: 'M', path: 'drifted.txt' }]);
    assert.equal(await loading, false, 'branch/ref drift during loading must not publish an owner');
    assert.equal(h.controller.active, false);
  }

  // A queued activation carries latest-wins authority through the real controller load.
  {
    const h = harness();
    const started = deferred();
    const releaseA = deferred();
    h.controller.options.loadFiles = async hash => {
      if (hash === A) { started.resolve(); return releaseA.promise; }
      return [{ status: 'M', path: 'b.txt' }];
    };
    const old = h.controller.runActivation(current => h.controller.loadCommit({ hash: A }, current));
    await started.promise;
    h.state.selectedCommitHash = B;
    h.state.selectionEpoch = 2;
    const fresh = h.controller.runActivation(current => h.controller.loadCommit({ hash: B }, current));
    releaseA.resolve([{ status: 'M', path: 'a.txt' }]);
    assert.equal(await old, undefined, 'superseded activation must not install A while B waits');
    assert.equal(await fresh, true);
    assert.equal(h.controller.commit.hash, B);
  }

  // Preview/hunk/capability publication races are isolated from the authoritative owner.
  {
    const h = harness();
    assert(await loadFrom(h.controller, A));
    const oldCapability = h.controller.capabilityForRender();
    const preview = h.controller.beginPreview();
    const hunk = h.controller.beginHunk();
    h.controller.setSelected(0, 2);
    assert.equal(h.controller.previewCurrent(preview), false, 'selection change kills old preview token');
    assert.equal(h.controller.hunkCurrent(hunk), false, 'selection change kills old hunk token');
    assert.equal(commitFilesHostMessageAllowed('commits', h.controller.context(), oldCapability), false, 'rerender/selection cannot reuse an old webview capability');
  }

  // A late HUNK cleanup cannot clear the newer owner or its prepared editor state.
  {
    const shownA = deferred();
    const releaseA = deferred();
    let currentA = true;
    let editorOwner;
    let editorState;
    let publishedPreview;
    let focusedPath;
    let revealedPath;
    const setEditor = async (active, ownerId, prepare) => {
      if (active) { editorOwner = ownerId; prepare?.(); return true; }
      if (editorOwner !== ownerId) return false;
      editorOwner = undefined;
      return true;
    };
    const input = (id, path, isCurrent, showText) => ({
      owner: { repoPath: '/repo-a', branchRef: 'refs/heads/main', head: '1'.repeat(40), commitHash: A, generation: 1, selectionEpoch: 1, selectedRowIdentity: `file:${path}`, sessionId: id },
      file: { status: 'M', path }, selectedFile: { status: 'M', path },
      hunkToken: { sessionId: id, generation: 1, selectionEpoch: 1, repoPath: '/repo-a', commitHash: A, selectedRowIdentity: `file:${path}`, editorModeId: `editor-${id}` },
      isOwnerCurrent: isCurrent, isHunkCurrent: isCurrent, revalidateOwner: async () => isCurrent(),
      showArgs: (...args) => args, runGit: async () => `patch-${path}`, useHunkModeInStagingView: true,
      applyHunkState: (_patch, filePath) => { editorState = filePath; }, setEditorHunkMode: setEditor,
      clearHunkState: () => { editorState = 'cleared'; }, render: () => {}, showText,
      forceEditorFocus: async current => { await Promise.resolve(); if (current()) focusedPath = path; },
      revealEditorHunk: async current => { await Promise.resolve(); if (current()) revealedPath = path; },
    });
    const old = enterCommitFileHunkMode(input('A', 'a.txt', () => currentA, async (_title, _content, _preview, _preserveFocus, current) => { shownA.resolve(); await releaseA.promise; if (current()) publishedPreview = 'a.txt'; }));
    await shownA.promise;
    currentA = false;
    await enterCommitFileHunkMode(input('B', 'b.txt', () => true, async (_title, _content, _preview, _preserveFocus, current) => { if (current()) publishedPreview = 'b.txt'; }));
    releaseA.resolve();
    await old;
    assert.equal(editorOwner, 'editor-B');
    assert.equal(editorState, 'b.txt', 'stale A cleanup must not clear B editor state');
    assert.equal(publishedPreview, 'b.txt', 'stale A cannot publish its editor preview after B');
    assert.equal(focusedPath, 'b.txt', 'stale A cannot restore editor focus after B');
    assert.equal(revealedPath, 'b.txt', 'stale A cannot move the editor cursor after B');
  }

  // The controller gate also proves queued row activation is latest-wins.
  {
    const h = harness();
    const gate = new LatestWinsAsyncGate();
    const release = deferred();
    const effects = [];
    const old = gate.request(async current => { await release.promise; if (current()) effects.push('old'); return current(); });
    const fresh = gate.request(async current => { if (current()) effects.push('new'); return current(); });
    release.resolve();
    assert.equal(await old, undefined);
    assert.equal(await fresh, true);
    assert.deepStrictEqual(effects, ['new']);
    assert(h.controller.runActivation, 'controller owns activation serialization');
  }

  const extension = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  const security = fs.readFileSync(path.join(__dirname, '..', 'src', 'webviewSecurity.ts'), 'utf8');
  assert(security.includes("'activateRow'"), 'atomic row activation must be allowlisted');
  assert(extension.includes("if (type === 'activateRow') await this.activateRow"), 'host must handle row activation atomically');
  assert(extension.includes("vscode.postMessage({type:'activateRow',index:Number(row.dataset.index)})"), 'double click must not emit select then enter');
  assert(extension.includes('private readonly commitFilesController = new CommitFilesController'), 'one controller must be the extension authority');
  assert(!extension.includes('commitFilesSession'), 'split session authority must be gone');

  console.log('commitFileRace tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
