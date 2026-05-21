const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

const escapeBindings = pkg.contributes.keybindings.filter(binding => binding.key === 'escape');
assert.strictEqual(escapeBindings.length, 1, 'LGVS must contribute exactly one Escape binding');
assert.strictEqual(escapeBindings[0].command, 'lazygitvs.editorHunkExit', 'Escape should only exit LGVS editor hunk/line mode');
assert.strictEqual(escapeBindings[0].when, 'lazygitvs.editorHunkMode && editorTextFocus', 'Escape must be scoped to LGVS editor HUNK/LINE mode only');

assert(!extension.includes("if(hit(e,u.return)||e.key==='Backspace')"), 'Sidebar/webview must not steal Esc globally; only Backspace may clear filters');
assert(!extension.includes('hit(e,u.return)'), 'Sidebar/webview must not bind lazygit universal.return (<esc>) outside editor hunk/line mode');

console.log('escapeScope tests passed');
