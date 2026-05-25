const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const views = pkg.contributes.views.scm;
assert(views.length >= 8, 'LGVS should keep the real multi-panel SCM layout');
for (const view of views) {
  if (view.id === 'lazygitvs.statusView') {
    assert.strictEqual(view.visibility, 'hidden', 'Status should default hidden and materialize only when the user presses 1');
    assert.strictEqual(view.when, 'lazygitvs.statusViewVisible', 'Status should only stay visible while panel 1 owns focus');
  } else {
    assert(!Object.prototype.hasOwnProperty.call(view, 'when'), `SCM view ${view.id} must not be hidden behind activeView context`);
    assert.strictEqual(view.visibility, 'visible', `SCM view ${view.id} should default open for README/product screenshots`);
  }
}

assert(extension.includes('private defaultPanelsRevealed = false;'), 'LGVS should reveal the default-open non-status panels only once on dashboard focus');
assert(extension.includes("PANEL_ORDER.filter((panel): panel is ViewPanel => panel !== 'status')"), 'default focus should open panels 2-8 while leaving 1 Status hidden until numeric jump');
assert(extension.includes('await this.revealDefaultOpenPanels();'), 'openDashboard should reveal default-open panels before focusing Files');
assert(!extension.includes('private async makeRoomForLazyGitViews'), 'do not ship fake room-making helpers for native SCM scrolling');
assert(!extension.includes("executeCommand('workbench.action.decreaseViewSize')"), 'panel jumps must not resize VS Code views');
assert(!extension.includes("executeCommand('list.scrollDown')"), 'panel jumps must not blindly scroll whichever list has focus');
assert(!extension.includes("executeCommand('workbench.action.focusSideBar')"), 'panel jumps must not steal keyboard focus into unrelated sidebar surfaces');
assert(extension.includes('PANEL_ORDER.forEach((panel, index) => {'), 'all panels should be registered through one shared loop');
assert(extension.includes('app.focusNumberPanel(index + 1)'), 'numeric panel commands must share focusNumberPanel/revealPanelView instead of special-casing 7/8');
assert(extension.indexOf('this.renderAll();\n    await this.revealPanelView(panel);') > 0, 'render before native reveal so VS Code can target the contributed view after refresh');
assert(!extension.includes("executeCommand('workbench.action.openView', viewId)"), 'panel reveal must not call Open View: it flashes the Quick Open / command-palette picker on panel jumps');
assert(extension.includes('if (!this.visible()) {\n        try { await vscode.commands.executeCommand(\'workbench.view.scm\'); }'), 'SCM container focus should only run when no LGVS view is already visible, otherwise panel jumps flash VS Code original SCM');
assert(extension.includes('this.views.get(panel)?.show(false);'), 'panel reveal should use WebviewView.show(false) for the contributed view');
assert(extension.includes('`${viewId}.focus`, { preserveFocus: false }'), 'panel reveal should focus the target contributed view');
assert(extension.includes('Date.now() > this.suppressWebviewAutoFocusUntil'), 'webview bootstrap must remain guarded during editor/HUNK transitions');
assert(extension.includes("await this.releaseEditorOwnership();\n    if (filePath) await editPath(filePath);"), 'EDIT handoff must make LGVS disappear before handing the real editor to VS Code/Vim');
assert(extension.includes("await this.releaseEditorOwnership(); await editPath(file);"), 'o/e file open must use the same hard release path as HUNK edit handoff');
const broadKeyboardModeEditorBindings = pkg.contributes.keybindings.filter(binding => String(binding.when) === 'lazygitvs.keyboardMode && editorTextFocus');
assert.deepStrictEqual(broadKeyboardModeEditorBindings, [], 'LGVS must not bind bare editor keys through broad keyboardMode; outside HUNK/LINE/VIEW the editor belongs to VSCodeVim/VS Code');
for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
  const editorBindings = pkg.contributes.keybindings.filter(binding => binding.key === key && String(binding.when).includes('editorTextFocus'));
  assert(editorBindings.every(binding => /lazygitvs\.viewerFocus|lazygitvs\.editorHunkMode|lazygitvs\.panelFocus/.test(binding.when)), `${key} must only jump panels from LGVS-owned focus lanes, never normal editor EDIT mode`);
  assert(editorBindings.some(binding => String(binding.when).includes('lazygitvs.panelFocus && editorTextFocus')), `${key} must still jump panels when a panel-owned preview editor has text focus, e.g. moving through 4 Commits`);
}

console.log('nativePanelFocus tests passed');
