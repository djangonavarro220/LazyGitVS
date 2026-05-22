const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

const escapeBindings = pkg.contributes.keybindings.filter(binding => binding.key === 'escape');
const hunkExit = escapeBindings.find(binding => binding.command === 'lazygitvs.editorHunkExit');
const vimEditEscape = escapeBindings.find(binding => binding.command === 'extension.vim_escape');

assert.strictEqual(escapeBindings.length, 2, 'LGVS must contribute only the HUNK exit and EDIT-mode Vim Escape bindings');
assert(hunkExit, 'Escape should exit LGVS editor hunk/line mode');
assert.strictEqual(hunkExit.when, 'lazygitvs.editorHunkMode && editorTextFocus', 'HUNK Escape must be scoped to LGVS editor HUNK/LINE mode only');
assert(vimEditEscape, 'Escape should be handed back to VSCodeVim while LGVS EDIT mode is active');
assert.strictEqual(vimEditEscape.when, 'lazygitvs.editorEditMode && editorTextFocus', 'Vim Escape handoff must be scoped to LGVS EDIT mode only');

assert(!extension.includes("if(hit(e,u.return)||e.key==='Backspace')"), 'Sidebar/webview must not steal Esc globally; only Backspace may clear filters');
assert(!extension.includes('hit(e,u.return)'), 'Sidebar/webview must not bind lazygit universal.return (<esc>) outside editor hunk/line mode');

console.log('escapeScope tests passed');
