const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

const escapeBindings = pkg.contributes.keybindings.filter(binding => binding.key === 'escape');
const hunkExit = escapeBindings.find(binding => binding.command === 'lazygitvs.editorHunkExit');
const vimEditEscape = escapeBindings.find(binding => binding.command === 'lazygitvs.editorEditEscape');

assert.strictEqual(escapeBindings.length, 1, 'LGVS must contribute Escape only while it owns HUNK/LINE mode; Vim/VS Code owns Escape elsewhere');
assert(hunkExit, 'Escape should exit LGVS editor hunk/line mode');
assert.strictEqual(hunkExit.when, 'lazygitvs.editorHunkMode && editorTextFocus', 'HUNK Escape must be scoped to LGVS editor HUNK/LINE mode only');
assert(!vimEditEscape, 'EDIT/Vim mode Escape must not be routed through LGVS');
assert(!pkg.contributes.keybindings.some(binding => binding.command === 'lazygitvs.editorEditEscape'), 'No LGVS EDIT-mode Escape keybinding: Vim/VS Code owns the keyboard outside HUNK/LINE');

assert(!extension.includes("if(hit(e,u.return)||e.key==='Backspace')"), 'Do not conflate Esc/back with Backspace clear-filter behavior');
assert(extension.includes("if(hit(e,u.return)){e.preventDefault();vscode.postMessage({type:'back'});return;}"), 'Sidebar webviews must honor lazygit universal.return (<esc>) as Back, e.g. leaving commit-file view');
assert(extension.includes("if(e.key==='Backspace'){e.preventDefault();vscode.postMessage({type:'clearFilter'});return;}"), 'Backspace should remain the clear-filter/back fallback for keyboard layouts that do not want Esc');
assert(!extension.includes("await this.focusPanel('files');\n  }\n  private async focusMainView"), 'Esc on normal panels like 3/4/5 must not fall back to Files');
assert(extension.includes('await this.focusPanel(viewPanel);'), 'Esc on a normal panel should keep focus on the current panel');

console.log('escapeScope tests passed');
