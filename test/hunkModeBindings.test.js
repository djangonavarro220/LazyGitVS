const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

const keybindings = pkg.contributes.keybindings;
const hunkWhen = 'lazygitvs.editorHunkMode && editorTextFocus';
const hunkCommands = new Set([
  'lazygitvs.editorHunkNext',
  'lazygitvs.editorHunkPrev',
  'lazygitvs.editorHunkToggle',
  'lazygitvs.editorHunkToggleMode',
  'lazygitvs.editorHunkToggleSide',
  'lazygitvs.editorHunkDiscard',
  'lazygitvs.editorHunkHelp',
  'lazygitvs.editorHunkEdit',
  'lazygitvs.editorHunkExit'
]);

const hunkHelpBindings = keybindings.filter(binding => binding.command === 'lazygitvs.editorHunkHelp' && binding.when === hunkWhen).map(binding => binding.key).sort();
assert.deepStrictEqual(hunkHelpBindings, ["shift+'", 'shift+/'], '? must use valid VS Code keybinding chords for common Spanish/US layouts, not literal "?"');

const lineMode = keybindings.find(binding => binding.command === 'lazygitvs.editorHunkToggleMode' && binding.when === hunkWhen);
assert(lineMode, 'HUNK/LINE mode toggle must be bound only in editor HUNK mode');
assert.strictEqual(lineMode.key, 'a', 'LazyGit uses a to toggle hunk/line selection mode');

const editMode = keybindings.find(binding => binding.command === 'lazygitvs.editorHunkEdit' && binding.when === hunkWhen);
assert(editMode, 'HUNK edit handoff must be bound only in editor HUNK mode');
assert.strictEqual(editMode.key, 'e', 'LazyGitVS uses e to hand the real editor back to Vim/typing');

const sideToggleKeys = keybindings.filter(binding => binding.command === 'lazygitvs.editorHunkToggleSide' && binding.when === hunkWhen).map(binding => binding.key).sort();
assert.deepStrictEqual(sideToggleKeys, ['ctrl+i', 'tab'], 'LazyGit uses tab to toggle staged/unstaged; ctrl+i covers keyboards that deliver Tab as ^I');

for (const binding of keybindings.filter(binding => hunkCommands.has(binding.command))) {
  assert.strictEqual(binding.when, hunkWhen, `${binding.command} / ${binding.key} must only be active while LGVS owns HUNK/LINE mode`);
  assert(!String(binding.when).includes('vim.mode'), `${binding.command} / ${binding.key} must not depend on Vim mode; LGVS suppresses Vim while it owns HUNK/LINE`);
  assert(!String(binding.when).includes('vim.active'), `${binding.command} / ${binding.key} must not route through Vim; LGVS suppresses Vim while it owns HUNK/LINE`);
}

for (const command of ['lazygitvs.editorHunkToggleMode', 'lazygitvs.editorHunkToggleSide', 'lazygitvs.editorHunkDiscard']) {
  assert(pkg.activationEvents.includes(`onCommand:${command}`), `${command} must activate the extension when invoked directly`);
}

assert(!keybindings.some(binding => binding.command === 'lazygitvs.editorHunkReturn'), 'No keyboard shortcut may jump from Vim/editor mode back into HUNK/LINE; re-enter via LGVS panels only');
assert(!keybindings.some(binding => binding.command === 'lazygitvs.editorEditEscape'), 'Escape belongs to Vim/VS Code once LGVS has handed off to editor mode');

assert(extension.includes("await this.setVimKeyCaptureSuppressed(active);"), 'editor HUNK mode must suppress VSCodeVim key capture so keys reach LGVS');
assert(extension.includes("setContext', 'vim.active', suppressed ? false"), 'LGVS must clear vim.active while it owns editor HUNK mode');
assert(extension.includes("this.editorHunkMode = false;"), 'entering edit/Vim mode must clear LGVS HUNK ownership');
assert(extension.includes("this.statusLine = 'EDIT mode: Vim/VS Code owns the keyboard. Re-enter HUNK/LINE from the LGVS panel.';"), 'edit/Vim mode status must not advertise LGVS hunk shortcuts');

assert(extension.includes("registerCommand('lazygitvs.editorHunkHelp'"), 'editor hunk help command must be registered');
assert(extension.includes('async editorHunkHelp()'), 'controller must expose editorHunkHelp');
assert(extension.includes("await pickGitAction('HUNK/LINE commands'"), 'editor hunk help should use the same contextual QuickPick pattern');

console.log('hunkModeBindings tests passed');
