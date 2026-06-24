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
  assert(!String(binding.when).includes('vim.mode'), `${binding.command} / ${binding.key} must not depend on Vim mode; LGVS HUNK/LINE ownership is scoped only by LGVS contexts`);
  assert(!String(binding.when).includes('vim.active'), `${binding.command} / ${binding.key} must not route through Vim; LGVS must not integrate with Vim contexts`);
}

for (const command of ['lazygitvs.editorHunkToggleMode', 'lazygitvs.editorHunkToggleSide', 'lazygitvs.editorHunkDiscard']) {
  assert(pkg.activationEvents.includes(`onCommand:${command}`), `${command} must activate the extension when invoked directly`);
}

assert(!keybindings.some(binding => binding.command === 'lazygitvs.editorHunkReturn'), 'No keyboard shortcut may jump from Vim/editor mode back into HUNK/LINE; re-enter via LGVS panels only');
assert(!keybindings.some(binding => binding.command === 'lazygitvs.editorEditEscape'), 'Escape belongs to Vim/VS Code once LGVS has handed off to editor mode');

assert(pkg.activationEvents.includes('onCommand:lazygitvs.enterSelected'), 'Enter selected command must activate LGVS when native/webview focus misses the embedded keydown handler');
assert(pkg.contributes.commands.some(command => command.command === 'lazygitvs.enterSelected'), 'Enter selected command must be contributed for direct command/keybinding routing');
assert(extension.includes("registerCommand('lazygitvs.enterSelected', () => app.enterSelected())"), 'Enter selected command must route to the controller enter path');
assert(extension.includes('async enterSelected()'), 'Controller must expose a narrow enterSelected command for focused LGVS panels');
for (const viewId of ['lazygitvs.filesView', 'lazygitvs.branchesView', 'lazygitvs.commitsView', 'lazygitvs.stashView', 'lazygitvs.conflictsView', 'lazygitvs.tagsView', 'lazygitvs.remotesView']) {
  assert(keybindings.some(binding => binding.key === 'enter' && binding.command === 'lazygitvs.enterSelected' && binding.when === `focusedView == ${viewId} && !editorTextFocus`), `Enter must route through LGVS only when ${viewId} is the focused view, never from real editors`);
}
assert(!keybindings.some(binding => binding.command === 'lazygitvs.enterSelected' && /editorTextFocus/.test(binding.when) && !/!editorTextFocus/.test(binding.when)), 'Enter selected must never bind inside real editor text focus');

const editorOwnedKeys = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'tab', 'shift+tab', 'escape', 'o', 'e']);
for (const binding of keybindings.filter(binding => editorOwnedKeys.has(binding.key))) {
  if (binding.when === hunkWhen) continue;
  assert(
    String(binding.when).includes('!editorTextFocus'),
    `${binding.command} / ${binding.key} must not be active during normal editor text focus; LGVS owns these keys only in explicit HUNK/LINE mode or non-editor panels`
  );
}

assert(extension.includes("setContext', 'vim.active', active ? false : true"), 'HUNK/LINE must temporarily disable VSCodeVim so LGVS hunk keys win, then restore Vim on exit without brittle detection');
assert(extension.includes("setContext', 'vim.active', true"), 'releaseEditorOwnership must restore Vim context so Esc leaves Insert after LGVS disappears');
assert(extension.includes("private async releaseEditorOwnership()"), 'normal open/edit must have one hard release path that makes LGVS disappear from the editor');
assert(extension.includes("this.modeStatusBarItem.hide();"), 'normal open/edit must hide the LGVS mode status bar instead of showing EDIT/LG state');
assert(extension.includes("await this.releaseEditorOwnership();\n    if (filePath) await editPath(filePath);"), 'e from HUNK must release all LGVS editor ownership before opening the real file editor');
assert(extension.includes("await this.releaseEditorOwnership(); await editPath(file);"), 'o/e from Files must also release LGVS instead of leaving viewer/status ownership behind');
const hunkExitBody = extension.match(/async exitEditorHunkMode\(\) \{([\s\S]*?)\n  \}\n  private selectNearestLineToEditorLine/)[1];
assert(hunkExitBody.includes("this.activePanel = 'files';"), 'Esc from editor HUNK/LINE must return workflow context to 2 Files');
assert(extension.includes('private selectFilePathInFilesPanel(filePath: string | undefined)'), 'Files selection restore must use the opened editor file path, not a stale row index');
assert(hunkExitBody.includes('const filePath = this.editorModeFilePath ?? this.currentFile()?.path;'), 'Esc must capture the editor HUNK file before setEditorHunkMode clears editorModeFilePath');
assert(hunkExitBody.includes('this.selectFilePathInFilesPanel(filePath);'), 'Esc must visually reselect the file that entered HUNK/LINE mode');
assert(hunkExitBody.includes('this.ownsModeStatus = true;'), 'Esc from editor HUNK/LINE must make LGVS own panel selection again');
assert(hunkExitBody.includes("this.setFocusArea('panel');"), 'Esc from editor HUNK/LINE must repaint the Files selected row as active');
assert(hunkExitBody.indexOf('this.ownsModeStatus = true;') < hunkExitBody.indexOf('await this.setEditorHunkMode(false);'), 'Esc must restore panel ownership before clearing HUNK mode so setEditorHunkMode does not mark focus as viewer');
assert(hunkExitBody.includes('await this.revealPanelView(\'files\');'), 'Esc from editor HUNK/LINE must reveal/refocus the Files panel after repainting selection');
assert(fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8').includes('hunk-escape-files-selection-restore'), 'Dogfood must cover Esc from editor HUNK/LINE repainting 2 Files panel ownership');

const editHandoffBody = extension.match(/async enterEditorEditMode\(\) \{([\s\S]*?)\n  \}\n  async editorHunkNoop/)[1];
assert(!editHandoffBody.includes('setVimKeyCaptureSuppressed'), 'e handoff must not detect or manipulate VSCodeVim; after release the editor belongs to VS Code/Vim');
assert(!editHandoffBody.includes("setContext', 'vim.active'"), 'e handoff must not set vim.active; LGVS should be invisible after normal edit handoff');
assert(!editHandoffBody.includes('extension.vim_escape'), 'e handoff must not call Vim commands; Esc belongs to VSCodeVim naturally');
assert(!editHandoffBody.includes('editorEditMode = true'), 'there is no LGVS EDIT mode after handoff; it is just the normal editor');

const noopLetters = 'bcfghilmnoprstuvwxyz'.split('');
for (const letter of noopLetters) {
  assert(keybindings.some(binding => binding.key === letter && binding.command === 'lazygitvs.editorHunkNoop' && binding.when === hunkWhen), `HUNK mode must swallow unassigned printable key ${letter}`);
  assert(keybindings.some(binding => binding.key === `shift+${letter}` && binding.command === 'lazygitvs.editorHunkNoop' && binding.when === hunkWhen), `HUNK mode must swallow unassigned printable key shift+${letter}`);
}
assert(extension.includes("registerCommand('lazygitvs.editorHunkNoop'"), 'editor hunk no-op command must be registered so unassigned keys do not type into files');

assert(extension.includes("registerCommand('lazygitvs.editorHunkHelp'"), 'editor hunk help command must be registered');
assert(extension.includes('async editorHunkHelp()'), 'controller must expose editorHunkHelp');
assert(extension.includes("await pickGitAction('HUNK/LINE commands'"), 'editor hunk help should use the same contextual QuickPick pattern');

console.log('hunkModeBindings tests passed');
