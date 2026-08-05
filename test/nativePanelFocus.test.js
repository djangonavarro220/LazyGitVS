const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const previewDocuments = fs.readFileSync(path.join(root, 'src', 'previewDocuments.ts'), 'utf8');
const workspaceActions = fs.readFileSync(path.join(root, 'src', 'workspaceActions.ts'), 'utf8');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');
const source = `${extension}\n${previewDocuments}\n${workspaceActions}`;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const views = pkg.contributes.views.scm;
assert(views.length >= 8, 'LGVS should keep the real multi-panel SCM layout');
for (const view of views) {
  if (view.id === 'lazygitvs.statusView') {
    assert.strictEqual(view.visibility, 'hidden', 'Status should default hidden and materialize only when the user presses 1');
    assert.strictEqual(view.when, 'lazygitvs.statusViewVisible', 'Status should only stay visible while panel 1 owns focus');
  } else {
    assert(!Object.prototype.hasOwnProperty.call(view, 'when'), `SCM view ${view.id} must not be hidden behind activeView context`);
    assert.strictEqual(view.visibility, 'visible', `SCM view ${view.id} should default open for normal multi-panel LGVS visibility`);
  }
}

assert(extension.includes('private defaultPanelsRevealed = false;'), 'LGVS should reveal the default-open non-status panels on dashboard focus');
assert(extension.includes("PANEL_ORDER.filter((panel): panel is ViewPanel => panel !== 'status')"), 'default focus should open panels 2-8 while leaving 1 Status hidden until numeric jump');
assert(extension.includes('await this.revealDefaultOpenPanels();'), 'openDashboard should reveal default-open panels before focusing Files');
assert(!extension.includes('private async makeRoomForLazyGitViews'), 'do not ship fake room-making helpers for native SCM scrolling');
assert(!extension.includes("executeCommand('workbench.action.decreaseViewSize')"), 'panel jumps must not resize VS Code views');
assert(!extension.includes("executeCommand('list.scrollDown')"), 'panel jumps must not blindly scroll whichever list has focus');
assert(!extension.includes("executeCommand('workbench.action.focusSideBar')"), 'panel jumps must not steal keyboard focus into unrelated sidebar surfaces');
assert(extension.includes('PANEL_ORDER.forEach((panel, index) => {'), 'all panels should be registered through one shared loop');
assert(extension.includes('app.focusNumberPanel(index + 1)'), 'numeric panel commands must share focusNumberPanel/revealPanelView instead of special-casing 7/8');
assert(extension.indexOf('this.renderFocusedPanels(previousViewPanel, panel);\n    await this.revealPanelView(panel);') > 0, 'render the previous and dispatched panels before native reveal so VS Code can target the contributed view without rebuilding the whole sidebar');
assert(!extension.includes("executeCommand('workbench.action.openView', viewId)"), 'panel reveal must not call Open View: it flashes the Quick Open / command-palette picker on panel jumps');
assert(extension.includes('if (!this.visible()) {\n        try { await vscode.commands.executeCommand(\'workbench.view.scm\'); }'), 'SCM container focus should only run when no LGVS view is already visible, otherwise panel jumps flash VS Code original SCM');
assert(extension.includes('this.views.get(panel)?.show(false);'), 'panel reveal should use WebviewView.show(false) for the contributed view');
assert(extension.includes('`${viewId}.focus`, { preserveFocus: false }'), 'panel reveal should focus the target contributed view');
assert(extension.includes('Date.now() <= this.suppressWebviewAutoFocusUntil'), 'webview bootstrap must remain guarded during editor/HUNK transitions');
assert(!extension.includes('setTimeout(() => { void reveal(); }'), 'panel reveal must not schedule delayed focus retries that close Command Palette/QuickPick after it opens');
assert(extension.includes("await this.releaseEditorOwnership();\n    if (filePath) await editPath(filePath);"), 'EDIT handoff must make LGVS disappear before handing the real editor to VS Code/Vim');
assert(extension.includes("await this.releaseEditorOwnership(); const editor = await editPath(file); await focusOpenedEditor(editor"), 'o/e file open must release LGVS and explicitly move keyboard focus into the already-open editor');
assert(workspaceActions.includes('export async function focusOpenedEditor(editor: vscode.TextEditor'), 'normal Files o/e handoff must have a dedicated editor-focus helper');
assert(workspaceActions.includes('for (const delay of [80, 220, 450])'), 'o/e must retry editor focus through the webview/Vim focus race');
assert(workspaceActions.includes("workbench.action.focusActiveEditorGroup"), 'o/e focus helper must explicitly focus the active editor group');
assert(dogfood.includes("for (const openKey of ['o', 'e'])"), 'real VS Code dogfood must exercise both physical Files open/edit keys');
assert(dogfood.includes('Files ${openKey} moves physical keyboard focus into the already-open editor'), 'dogfood must assert physical editor focus, not merely that the file tab is open');
assert(dogfood.includes('LGVS_DOGFOOD_FILES_EDITOR_FOCUS'), 'o/e editor-focus regression must have a bounded targeted dogfood lane');
assert(extension.includes("run: async () => this.editCurrent('conflicts')"), 'Conflicts o must use the same hard editor handoff as Files o/e');
assert(extension.includes("await this.releaseEditorOwnership(); const editor = await vscode.window.showTextDocument"), 'editing lazygit config must release panel ownership before focusing the editor');
assert(extension.includes('await focusActiveEditorGroup(() => !this.ownsModeStatus'), 'merge-editor actions must explicitly transfer physical focus out of LGVS');
assert(extension.includes('restorePanelFocusAfterModal(viewPanel, () => this.ownsModeStatus)'), 'panel commands must not reclaim focus after an editor-opening action releases ownership');
assert(extension.includes('if (this.ownsModeStatus) await this.focusPanel(this.activeViewPanel())'), 'help menus must not reclaim focus after an editor-opening action');
assert(extension.includes('vscode.window.onDidChangeActiveTextEditor(editor => this.handleActiveTextEditorChanged(editor))'), 'active editor changes must re-check LGVS ownership instead of leaving sticky viewer/status state');
assert(extension.includes('private isLGVSOwnedEditor(editor: vscode.TextEditor | undefined): boolean'), 'LGVS must explicitly identify which editors it owns');
assert(extension.includes("this.editorHunkMode || this.focusArea === 'viewer' || this.editorEditMode"), 'normal editor focus while LGVS thinks it owns HUNK/VIEW/EDIT must trigger a hard ownership release');
assert(extension.includes('!this.isLGVSOwnedEditor(editor)'), 'ownership release must happen when the active editor is not a LazyGitVS preview/hunk surface');
assert(source.includes("uri.scheme === 'lazygitvs-preview' || uri.scheme === 'lazygitvs-empty'") || (source.includes('VIRTUAL_PREVIEW_SCHEME') && source.includes('EMPTY_PREVIEW_SCHEME')), 'only LazyGitVS virtual preview schemes count as LGVS-owned generated viewers');
const broadKeyboardModeEditorBindings = pkg.contributes.keybindings.filter(binding => String(binding.when) === 'lazygitvs.keyboardMode && editorTextFocus');
assert.deepStrictEqual(broadKeyboardModeEditorBindings, [], 'LGVS must not bind bare editor keys through broad keyboardMode; outside HUNK/LINE/VIEW the editor belongs to VSCodeVim/VS Code');
for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
  const editorBindings = pkg.contributes.keybindings.filter(binding => binding.key === key && String(binding.when).includes('&& editorTextFocus'));
  assert.deepStrictEqual(editorBindings, [], `${key} must not bind in any normal/editor/HUNK text editor; Vim command-line motions like :6 must keep the digit`);
  const focusedViewBinding = pkg.contributes.keybindings.find(binding => binding.key === key && String(binding.when).includes('focusedView == lazygitvs.statusView'));
  assert(focusedViewBinding && String(focusedViewBinding.when).includes('!editorTextFocus'), `${key} focusedView panel jump must be disabled while a real editor/Vim command line has text focus`);
}

console.log('nativePanelFocus tests passed');
