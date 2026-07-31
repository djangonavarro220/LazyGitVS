const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'src', 'commitFilesController.ts'), 'utf8');
const { buildTreeRows } = require('../out/panels');

const tree = { showFileTree: true, fileTreeSortOrder: 'foldersFirst', fileTreeSortCaseSensitive: false };
const flat = { ...tree, showFileTree: false };
const files = [
  { path: 'z.txt', id: 'z' },
  { path: 'src/Zeta.ts', id: 'Zeta' },
  { path: 'src/alpha.ts', id: 'alpha' },
  { path: 'docs/guides/setup.md', id: 'setup' },
  { path: 'docs/guides/usage.md', id: 'usage' },
  { path: 'README.md', id: 'readme' }
];

assert.deepStrictEqual(
  buildTreeRows(files, flat, new Set()).map(row => [row.kind, row.path, row.label, row.depth]),
  files.map(file => ['file', file.path, file.path, 0]),
  'flat mode keeps one full-path file row per input in input order'
);

assert.deepStrictEqual(
  buildTreeRows(files, tree, new Set()).map(row => [row.kind, row.path, row.label, row.depth]),
  [
    ['dir', 'docs/guides', 'docs/guides', 0],
    ['file', 'docs/guides/setup.md', 'setup.md', 1],
    ['file', 'docs/guides/usage.md', 'usage.md', 1],
    ['dir', 'src', 'src', 0],
    ['file', 'src/alpha.ts', 'alpha.ts', 1],
    ['file', 'src/Zeta.ts', 'Zeta.ts', 1],
    ['file', 'README.md', 'README.md', 0],
    ['file', 'z.txt', 'z.txt', 0]
  ],
  'tree mode compresses single-child directory chains and sorts folders before files case-insensitively'
);

assert.deepStrictEqual(
  buildTreeRows(files, { ...tree, fileTreeSortOrder: 'filesFirst' }, new Set()).map(row => row.path),
  ['README.md', 'z.txt', 'docs/guides', 'docs/guides/setup.md', 'docs/guides/usage.md', 'src', 'src/alpha.ts', 'src/Zeta.ts'],
  'filesFirst puts root files before directories while preserving sorted children'
);

const mixedCase = [
  { path: 'case/zeta.ts', id: 'lower-zeta' },
  { path: 'case/Alpha.ts', id: 'upper-alpha' },
  { path: 'case/alpha.ts', id: 'lower-alpha' },
  { path: 'Beta/root.ts', id: 'upper-beta-dir' },
  { path: 'beta/root.ts', id: 'lower-beta-dir' }
];
assert.deepStrictEqual(
  buildTreeRows(mixedCase, tree, new Set()).map(row => row.path),
  ['Beta', 'Beta/root.ts', 'beta', 'beta/root.ts', 'case', 'case/Alpha.ts', 'case/alpha.ts', 'case/zeta.ts'],
  'precomputed case-insensitive sort keys must preserve stable localeCompare ordering'
);
const localeNames = ['Éclair.ts', 'école.ts', 'Ångstrom.ts', 'zebra.ts', 'Alpha.ts'].map(path => ({ path }));
assert.deepStrictEqual(
  buildTreeRows(localeNames, tree, new Set()).map(row => row.path),
  [...localeNames].sort((a, b) => a.path.toLocaleLowerCase().localeCompare(b.path.toLocaleLowerCase())).map(file => file.path),
  'ASCII fast-path sort keys must preserve locale-aware ordering for non-ASCII names'
);

const leadingSlashFile = { path: '/../A/a_b/ß', id: 'leading-slash' };
assert.deepStrictEqual(
  buildTreeRows([leadingSlashFile], tree, new Set()).map(row => [row.kind, row.path, row.label, row.depth, row.kind === 'dir' && row.collapsed]),
  [
    ['dir', '/../A/a_b', '/../A/a_b', 0, false],
    ['file', '/../A/a_b/ß', 'ß', 1, false]
  ],
  'leading slash and empty first segment remain part of row identities and compressed labels'
);
assert.deepStrictEqual(
  buildTreeRows([leadingSlashFile], tree, new Set(['/../A/a_b'])).map(row => [row.kind, row.path, row.label, row.depth, row.kind === 'dir' && row.collapsed]),
  [['dir', '/../A/a_b', '/../A/a_b', 0, true]],
  'leading-slash directory identity remains the exact collapse key'
);

function referenceBuildTreeRows(input, options, collapsedDirs) {
  if (!options.showFileTree) return input.map(file => ({ kind: 'file', path: file.path, label: file.path, depth: 0, file }));
  const root = { path: '', part: '', children: [] };
  const child = (parent, part, pathValue) => {
    let node = parent.children.find(candidate => candidate.part === part);
    if (!node) { node = { path: pathValue, part, children: [] }; parent.children.push(node); }
    return node;
  };
  for (const file of input) {
    let node = root;
    const parts = file.path.split('/');
    parts.forEach((part, index) => {
      node = child(node, part, parts.slice(0, index + 1).join('/'));
      if (index === parts.length - 1) node.file = file;
    });
  }
  const normalize = value => options.fileTreeSortCaseSensitive ? value : value.toLocaleLowerCase();
  const compare = (a, b) => {
    if (options.fileTreeSortOrder === 'foldersFirst' && Boolean(a.file) !== Boolean(b.file)) return a.file ? 1 : -1;
    if (options.fileTreeSortOrder === 'filesFirst' && Boolean(a.file) !== Boolean(b.file)) return a.file ? -1 : 1;
    return normalize(a.path).localeCompare(normalize(b.path));
  };
  const sort = node => { node.children.sort(compare); node.children.forEach(sort); };
  sort(root);
  const rows = [];
  const labelFromDepth = (node, treeDepth) => node.path.split('/').slice(treeDepth).join('/');
  const render = (node, treeDepth, visualDepth) => {
    if (node.file) { rows.push({ kind: 'file', path: node.path, label: labelFromDepth(node, treeDepth), depth: visualDepth, file: node.file }); return; }
    let visible = node;
    let compressedDepth = treeDepth;
    while (visible.children.length === 1 && !visible.children[0].file) { visible = visible.children[0]; compressedDepth++; }
    const collapsed = collapsedDirs.has(visible.path);
    rows.push({ kind: 'dir', path: visible.path, label: labelFromDepth(visible, treeDepth), depth: visualDepth, collapsed });
    if (!collapsed) visible.children.forEach(childNode => render(childNode, compressedDepth + 1, visualDepth + 1));
  };
  root.children.forEach(node => render(node, 0, 0));
  return rows;
}

let randomState = 0x8badf00d;
const random = () => (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0);
const pathParts = ['', '', '.', '..', 'A', 'a_b', 'ß', 'É', 'é', 'z', '00'];
const boundaryPaths = ['', '/', '//', '///', '/a', 'a/', 'a//b', '/../A/a_b/ß', 'A', 'A/b', 'a', 'a/b/c'];
const optionMatrix = ['foldersFirst', 'filesFirst', 'mixed'].flatMap(fileTreeSortOrder => [false, true].map(fileTreeSortCaseSensitive => ({ showFileTree: true, fileTreeSortOrder, fileTreeSortCaseSensitive })));
for (let fixtureIndex = 0; fixtureIndex < 250; fixtureIndex++) {
  const generated = boundaryPaths.map((path, index) => ({ path, id: `fixed-${fixtureIndex}-${index}` }));
  const generatedCount = 4 + (random() % 20);
  for (let index = 0; index < generatedCount; index++) {
    const partCount = 1 + (random() % 6);
    const parts = Array.from({ length: partCount }, () => pathParts[random() % pathParts.length]);
    generated.push({ path: parts.join('/'), id: `random-${fixtureIndex}-${index}` });
  }
  const collapseCandidates = new Set(generated.filter((_, index) => index % 3 === 0).map(file => file.path.slice(0, file.path.lastIndexOf('/'))));
  for (const options of optionMatrix) {
    assert.deepStrictEqual(
      buildTreeRows(generated, options, collapseCandidates),
      referenceBuildTreeRows(generated, options, collapseCandidates),
      `optimized tree must exactly match the reference for differential fixture ${fixtureIndex}, ${options.fileTreeSortOrder}, caseSensitive=${options.fileTreeSortCaseSensitive}`
    );
  }
}

const commitCollapsedDirs = new Set(['docs/guides']);
const collapsed = buildTreeRows(files, tree, commitCollapsedDirs);
assert.deepStrictEqual(
  collapsed.map(row => [row.kind, row.path, row.kind === 'dir' ? row.collapsed : false]),
  [
    ['dir', 'docs/guides', true],
    ['dir', 'src', false],
    ['file', 'src/alpha.ts', false],
    ['file', 'src/Zeta.ts', false],
    ['file', 'README.md', false],
    ['file', 'z.txt', false]
  ],
  'collapsing a compressed directory hides only its descendants'
);

const filesCollapsedRows = buildTreeRows(files, tree, new Set(['src']));
const commitExpandedRows = buildTreeRows(files, tree, new Set());
assert(!filesCollapsedRows.some(row => row.kind === 'file' && row.path === 'src/alpha.ts'), 'Files collapse state hides Files descendants');
const selectedCommitFile = commitExpandedRows.find(row => row.kind === 'file' && row.path === 'src/alpha.ts');
assert(selectedCommitFile && selectedCommitFile.file.id === 'alpha', 'Commit navigation resolves Enter on the visible selected file row to that exact file');
assert(commitExpandedRows.some(row => row.kind === 'file' && row.path === 'src/alpha.ts'), 'Files collapse state cannot hide the same directory in Commits');

assert(controller.includes('private collapsedDirsValue = new Set<string>();'), 'Commit file tree needs its own collapsed-directory state inside the controller');
assert(extension.includes('private fileTreeRows(): readonly Readonly<FileTreeRow>[] { return this.filePanelListModel.read({'), 'Files tree must use the production cache seam');
assert(extension.includes('collapsedDirs: this.collapsedFileDirs }); }'), 'Files tree must use only Files collapse state');
const commitFileCheckout = fs.readFileSync(path.join(root, 'src', 'commitFileCheckout.ts'), 'utf8');
assert.match(commitFileCheckout, /export function projectCommitFileTreeRows\(/, 'Commit tree projection must live with Commit-files checkout safety helpers');
assert(extension.includes('const commitFileRows = this.commitFilesController.rows(this.lazygitGui);'), 'Commit tree must read only controller-owned commit-file collapse state through the extracted projection');
assert.match(extension, /if \(panel === 'status' \|\| this\.activeLength\(panel\) === 0\) await this\.refresh\(false\)/, 'Focusing an empty lazily rendered panel must refresh real repository data before navigation');
assert(controller.includes('toggledCommitFileCollapsedDirs') && extension.includes('this.commitFilesController.toggleDirectory'), 'Enter on a commit directory must toggle only controller-owned commit-file collapse state');
assert.match(extension, /if \(await this\.toggleCurrentCommitFileTreeNode\(\)\) return;[\s\S]*const f = this\.commitFilesController\.currentFile\(this\.lazygitGui\);[\s\S]*if \(f\) return this\.enterCommitFileHunkMode\(f\);/, 'Enter toggles a directory and enters HUNK mode only for the controller-selected file row');

console.log('commitFileTree tests passed');
