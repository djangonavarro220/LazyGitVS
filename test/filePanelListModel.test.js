const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FilePanelListModel } = require('../out/panels');

const files = [{ path: 'src/a.ts', xy: ' M', staged: false, untracked: false }];
const model = new FilePanelListModel();
const base = { files, selection: 0, projectionKey: 'all', treeKey: 'expanded', project: rows => [...rows], options: { showFileTree: true, fileTreeSortOrder: 'foldersFirst', fileTreeSortCaseSensitive: true }, collapsedDirs: new Set() };
const first = model.read(base);
const moved = model.read({ ...base, selection: 1 });
assert.strictEqual(moved, first, 'production selection reads reuse the published rows');
files[0].path = 'caller-mutated.ts';
assert.strictEqual(first[1].file.path, 'src/a.ts', 'production transfer owns nested file values');
assert(Object.isFrozen(first[1].file));
const changed = model.read({ ...base, treeKey: 'collapsed', collapsedDirs: new Set(['src']) });
assert.notStrictEqual(changed, first, 'tree semantics invalidate production rows');

const identityFixture = [
  { path: 'src/a.ts', xy: ' M', staged: false, untracked: false },
  { path: 'src/nested/b.ts', xy: ' M', staged: false, untracked: false }
];
const identityRows = model.read({ ...base, files: identityFixture, projectionKey: 'identity-paths', treeKey: 'identity-tree', project: rows => [...rows] });
assert.strictEqual(new Set(identityRows.map(row => row.path)).size, identityRows.length, 'tree paths are deterministic unique identities across directory and file rows');

const extension = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
assert(extension.includes('private readonly filePanelListModel = new FilePanelListModel()'), 'the production controller owns the cache seam');
assert(extension.includes('return this.filePanelListModel.read({'), 'Files panel access must use the production cache, not benchmark-only opt-in');
const panels = fs.readFileSync(path.join(__dirname, '..', 'src', 'panels.ts'), 'utf8');
assert(panels.includes('LGVS-005 must replace this local generation'), 'the LGVS-005 publication dependency stays explicit');
assert(panels.includes("projectedRows: 'transfer', identity: row => row.path"), 'production rows must reuse path identity without per-row prefix allocation');

console.log('filePanelListModel tests passed');