const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const views = pkg.contributes.views.scm;
assert(views.length >= 8, 'LGVS should keep the real multi-panel SCM layout');
for (const view of views) {
  assert(!Object.prototype.hasOwnProperty.call(view, 'when'), `SCM view ${view.id} must not be hidden behind activeView context`);
}

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
assert(extension.includes("executeCommand('setContext', 'lazygitvs.keyboardMode', false);\n    await this.setVimKeyCaptureSuppressed(false);"), 'EDIT mode must release LGVS key capture so Vim/editor typing works normally');
assert(extension.includes("executeCommand('setContext', 'lazygitvs.keyboardMode', true);\n    await this.setVimKeyCaptureSuppressed(true);"), 'returning from EDIT to HUNK mode must restore LGVS HUNK key capture');
const broadKeyboardModeEditorBindings = pkg.contributes.keybindings.filter(binding => String(binding.when) === 'lazygitvs.keyboardMode && editorTextFocus');
assert.deepStrictEqual(broadKeyboardModeEditorBindings, [], 'LGVS must not bind bare editor keys through broad keyboardMode; outside HUNK/LINE/VIEW the editor belongs to VSCodeVim/VS Code');
for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
  const editorBindings = pkg.contributes.keybindings.filter(binding => binding.key === key && String(binding.when).includes('editorTextFocus'));
  assert(editorBindings.every(binding => /lazygitvs\.viewerFocus|lazygitvs\.editorHunkMode/.test(binding.when)), `${key} must only jump panels from LGVS viewer or HUNK/LINE mode, never normal editor EDIT mode`);
}

console.log('nativePanelFocus tests passed');
