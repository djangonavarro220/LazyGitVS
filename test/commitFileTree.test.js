const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
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

assert(extension.includes('private collapsedCommitFileDirs = new Set<string>();'), 'Commit file tree needs its own collapsed-directory state');
assert.match(extension, /private fileTreeRows\(\): FileTreeRow\[\] \{ return this\.treeRowsFor\(this\.filteredFiles\(\), this\.collapsedFileDirs\); \}/, 'Files tree must use only Files collapse state');
assert.match(extension, /private commitFileTreeRows\(\): TreeRow<ChangedFile & CommitFile>\[\] \{ return this\.treeRowsFor\(this\.commitFileItems\.map\(file => this\.commitFileAsChangedFile\(file\)\), this\.collapsedCommitFileDirs\); \}/, 'Commit tree must use only commit-file collapse state');
assert.match(extension, /if \(panel === 'status' \|\| this\.activeLength\(panel\) === 0\) await this\.refresh\(false\)/, 'Focusing an empty lazily rendered panel must refresh real repository data before navigation');
assert.match(extension, /private async toggleCurrentCommitFileTreeNode\(\)[\s\S]*this\.collapsedCommitFileDirs\.has\(row\.path\)[\s\S]*this\.collapsedCommitFileDirs\.add\(row\.path\)/, 'Enter on a commit directory must toggle only commit-file collapse state');
assert.match(extension, /if \(await this\.toggleCurrentCommitFileTreeNode\(\)\) return;[\s\S]*const f = this\.currentCommitFile\(\);[\s\S]*if \(f\) return this\.enterCommitFileHunkMode\(f\);/, 'Enter toggles a directory and enters HUNK mode only for the selected file row');

console.log('commitFileTree tests passed');
