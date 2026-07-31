const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const { activeDescendantId, row, fileRow, branchRow, commitRow } = require(path.join(root, 'out', 'panelRows.js'));

assert.match(row(true, 'plain', '', 'selected', '', 3), /id="lgvs-row-3"/);
assert.match(fileRow(true, '', { xy: ' M', path: 'a.txt', staged: false, untracked: false }, 'a.txt', 4), /id="lgvs-row-4"/);
assert.match(branchRow(true, { name: 'main', label: 'main', current: true, kind: 'local', upstream: '', ahead: 0, behind: 0 }, 5), /id="lgvs-row-5"/);
assert.match(commitRow(true, { hash: 'abc', subject: 'subject', refs: '', author: 'A', relativeDate: 'now', graph: '' }, 6), /id="lgvs-row-6"/);
assert.strictEqual(activeDescendantId(true, 0, 0), '', 'empty lists never expose a dangling active descendant');
assert.strictEqual(activeDescendantId(false, 0, 1), '', 'unfocused lists do not claim an active descendant');
assert.strictEqual(activeDescendantId(true, 2, 3), 'lgvs-row-2');
assert.strictEqual(activeDescendantId(true, 3, 3), '', 'out-of-range selections fail closed');

assert.match(extension, /<body tabindex="0" role="listbox" aria-label="\$\{escapeHtml\(title\)\}"/);
assert.match(extension, /activeRowId \? ` aria-activedescendant="\$\{activeRowId\}"` : ''/);
assert.match(extension, /const selectedRowId = activeDescendantId\(true, panel === 'status' \? 0 : this\.activeIndex\(panel\), panel === 'status' \? 1 : this\.activeLength\(panel\)\), activeRowId = showPanelSelection \? selectedRowId : ''/);
assert.doesNotMatch(extension, /type === 'focusArea'[^{]+\{[^\n]+await this\.focusPanel\(panel\)/, 'focus must not rerender the clicked document before click or dblclick posts');
assert.match(extension, /const previousViewPanel = this\.activeViewPanel\(\)[\s\S]+?this\.activePanel = panel[\s\S]+?if \(previousViewPanel !== panel\) this\.render\(previousViewPanel\)/);
assert.match(extension, /function syncPanelSelection\(\)[\s\S]+?document\.getElementById\(selectedRowId\)[\s\S]+?aria-activedescendant[\s\S]+?function markPanelFocus\(\)\{keyboardEnabled=true;syncPanelSelection\(\);vscode\.postMessage/);

console.log('active descendant accessibility tests passed');