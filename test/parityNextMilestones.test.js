const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = [
  'extension.ts',
  'panels.ts',
  'panelRows.ts'
].map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runner = fs.readFileSync(path.join(root, 'scripts', 'run-tests.js'), 'utf8');

assert(extension.includes('private commandRegistry(viewPanel: ViewPanel): GitMenuItem[]'), 'Help, QuickPick and key dispatch must share one command registry, not hand-written per-surface options');
assert(extension.includes('this.commandRegistry(viewPanel)'), 'Help menu must read the shared command registry');
assert(extension.includes('findMenuItemByKey(this.commandRegistry(viewPanel), typed)'), 'Typed panel actions must route through the shared command registry');
assert(!extension.includes('private panelCommandCatalog(viewPanel: ViewPanel): GitMenuItem[]'), 'Old panelCommandCatalog wrapper should be gone; it encouraged split-brain menu/help routing');

assert(extension.includes('export type FileTreeRow ='), 'Files panel needs real tree rows, not path text with slashes replaced by arrows');
assert(extension.includes('private collapsedFileDirs = new Set<string>();'), 'Files tree must track collapsed directories');
assert(extension.includes('private fileTreeRows(): FileTreeRow[]'), 'Files panel must render directory and file rows from a tree row model');
assert(extension.includes('toggleCurrentFileTreeNode()'), 'Enter on a directory must collapse/expand that node');
assert(extension.includes('collapseAllFileTree()') && extension.includes('expandAllFileTree()'), 'Files -/= must collapse and expand all tree directories');
assert(!extension.includes("filePath.replace(/\\//g, ' › ')"), 'Fake tree text replacement is not a file tree');

assert(extension.includes('private async diffingMenu()'), 'Global W/<ctrl-e> diffing menu must exist');
assert(extension.includes('toggleWhitespaceInDiffView'), 'Diffing menu must include whitespace toggle');
assert(extension.includes('increaseContextInDiffView') && extension.includes('decreaseContextInDiffView'), 'Diffing menu must include diff context size +/- actions');
assert(extension.includes('increaseRenameSimilarityThreshold') && extension.includes('decreaseRenameSimilarityThreshold'), 'Diffing menu must include rename similarity +/- actions');
assert(extension.includes("vscode.postMessage({type:'diffingMenu'})"), 'Webview key routing must send W/<ctrl-e> to diffing menu');

assert(extension.includes('role="listbox"'), 'Rows container must expose listbox role');
assert(extension.includes('role="option"'), 'Rows must expose option role');
assert(extension.includes('aria-selected="${sel ? \'true\' : \'false\'}"'), 'Rows must expose selected state');
assert(extension.includes('private virtualRows'), 'Large lists must be virtualized before rendering webview HTML');
assert(extension.includes('data-virtual-offset'), 'Virtualized rows need an offset marker for index mapping/debugging');

assert.strictEqual(pkg.scripts.test, 'npm run compile && node scripts/run-tests.js', 'npm test must use the deterministic runner');
assert(runner.includes("file.endsWith('.test.js')"), 'runner must discover parity milestone tests automatically');

console.log('parityNextMilestones tests passed');
