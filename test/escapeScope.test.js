const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

const escapeBindings = pkg.contributes.keybindings.filter(binding => binding.key === 'escape');
const hunkExit = escapeBindings.find(binding => binding.command === 'lazygitvs.editorHunkExit');
const vimEditEscape = escapeBindings.find(binding => binding.command === 'lazygitvs.editorEditEscape');

assert.strictEqual(escapeBindings.length, 2, 'LGVS must contribute only the HUNK exit and EDIT-mode Vim Escape handoff bindings');
assert(hunkExit, 'Escape should exit LGVS editor hunk/line mode');
assert.strictEqual(hunkExit.when, 'lazygitvs.editorHunkMode && editorTextFocus', 'HUNK Escape must be scoped to LGVS editor HUNK/LINE mode only');
assert(vimEditEscape, 'Escape should route through LGVS EDIT-mode handoff before calling VSCodeVim');
assert.strictEqual(vimEditEscape.when, 'lazygitvs.editorEditMode && editorTextFocus', 'Vim Escape handoff must be scoped to LGVS EDIT mode only');
assert(extension.includes("vscode.commands.registerCommand('lazygitvs.editorEditEscape'"), 'LGVS must register the EDIT Escape handoff command so activation/routing is under our control');
assert(extension.includes("executeCommand('extension.vim_escape')"), 'EDIT Escape handoff must explicitly invoke VSCodeVim Escape');

assert(!extension.includes("if(hit(e,u.return)||e.key==='Backspace')"), 'Do not conflate Esc/back with Backspace clear-filter behavior');
assert(extension.includes("if(hit(e,u.return)){e.preventDefault();vscode.postMessage({type:'back'});return;}"), 'Sidebar webviews must honor lazygit universal.return (<esc>) as Back, e.g. leaving commit-file view');
assert(extension.includes("if(e.key==='Backspace'){e.preventDefault();vscode.postMessage({type:'clearFilter'});return;}"), 'Backspace should remain the clear-filter/back fallback for keyboard layouts that do not want Esc');
assert(!extension.includes("await this.focusPanel('files');\n  }\n  private async focusMainView"), 'Esc on normal panels like 3/4/5 must not fall back to Files');
assert(extension.includes('await this.focusPanel(viewPanel);'), 'Esc on a normal panel should keep focus on the current panel');

console.log('escapeScope tests passed');
