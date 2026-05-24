const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

const keybindings = pkg.contributes.keybindings;
const hunkWhen = 'lazygitvs.editorHunkMode && editorTextFocus';
const hunkHelpBindings = keybindings.filter(binding => binding.command === 'lazygitvs.editorHunkHelp' && binding.when === hunkWhen).map(binding => binding.key).sort();
assert.deepStrictEqual(hunkHelpBindings, ["shift+'", 'shift+/'], '? must use valid VS Code keybinding chords for common Spanish/US layouts, not literal "?"');

const lineMode = keybindings.find(binding => binding.command === 'lazygitvs.editorHunkToggleMode' && binding.when === hunkWhen);
assert(lineMode, 'HUNK/LINE mode toggle must be bound in editor HUNK mode');
assert.strictEqual(lineMode.key, 'a', 'LazyGit uses a to toggle hunk/line selection mode');

const editMode = keybindings.find(binding => binding.command === 'lazygitvs.editorHunkEdit' && binding.when === hunkWhen);
assert(editMode, 'HUNK edit mode must be bound in editor HUNK mode');
assert.strictEqual(editMode.key, 'e', 'LazyGitVS uses e to hand the real editor back to Vim/typing');
const vimEditBindings = keybindings.filter(binding => binding.command === 'lazygitvs.editorHunkEdit' && binding.key === 'e' && String(binding.when).includes('vim.mode')).map(binding => binding.when).sort();
assert.deepStrictEqual(vimEditBindings, [
  "editorTextFocus && lazygitvs.editorHunkMode && vim.mode == 'Normal' && !inDebugRepl && !inlineEditIsVisible",
  "editorTextFocus && vim.active && lazygitvs.editorHunkMode && vim.mode != 'Insert' && !inDebugRepl && !inlineEditIsVisible"
], 'e binding must mirror VSCodeVim contexts so HUNK→EDIT beats Vim normal-mode e motion');

const sideToggleKeys = keybindings.filter(binding => binding.command === 'lazygitvs.editorHunkToggleSide' && binding.when === hunkWhen).map(binding => binding.key).sort();
assert.deepStrictEqual(sideToggleKeys, ['ctrl+i', 'tab'], 'LazyGit uses tab to toggle staged/unstaged; ctrl+i covers keyboards that deliver Tab as ^I');
const vimTabBindings = keybindings.filter(binding => binding.command === 'lazygitvs.editorHunkToggleSide' && binding.key === 'tab' && String(binding.when).includes('vim.mode')).map(binding => binding.when).sort();
assert.deepStrictEqual(vimTabBindings, [
  "editorTextFocus && lazygitvs.editorHunkMode && vim.mode == 'Normal' && !inDebugRepl && !inlineEditIsVisible",
  "editorTextFocus && vim.active && lazygitvs.editorHunkMode && vim.mode != 'Insert' && !inDebugRepl && !inlineEditIsVisible"
], 'Tab binding must mirror VSCodeVim extension.vim_tab context plus LGVS mode so it can beat Vim in HUNK mode');
const vimCtrlIBindings = keybindings.filter(binding => binding.command === 'lazygitvs.editorHunkToggleSide' && binding.key === 'ctrl+i' && String(binding.when).includes('vim.use<C-i>')).map(binding => binding.when);
assert.deepStrictEqual(vimCtrlIBindings, ["editorTextFocus && vim.active && lazygitvs.editorHunkMode && vim.use<C-i> && !inDebugRepl"], 'Ctrl+I binding must mirror VSCodeVim ctrl+i context plus LGVS mode');

for (const command of ['lazygitvs.editorHunkToggleMode', 'lazygitvs.editorHunkToggleSide', 'lazygitvs.editorHunkDiscard']) {
  assert(pkg.activationEvents.includes(`onCommand:${command}`), `${command} must activate the extension when invoked directly`);
}

assert(extension.includes("await this.setVimKeyCaptureSuppressed(active);"), 'editor HUNK mode must suppress VSCodeVim key capture so Tab reaches LGVS');
assert(extension.includes("setContext', 'vim.active', suppressed ? false"), 'LGVS must clear vim.active while it owns editor HUNK mode');
assert(extension.includes("registerCommand('extension.vim_tab'"), 'LGVS must provide a shim for stale VSCodeVim Tab keybindings when VSCodeVim is absent');

assert(extension.includes("registerCommand('lazygitvs.editorHunkHelp'"), 'editor hunk help command must be registered');
assert(extension.includes('async editorHunkHelp()'), 'controller must expose editorHunkHelp');
assert(extension.includes("await pickGitAction('HUNK/LINE commands'"), 'editor hunk help should use the same contextual QuickPick pattern');

console.log('hunkModeBindings tests passed');
