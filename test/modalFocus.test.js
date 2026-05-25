const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');

assert(extension.includes('private async restorePanelFocusAfterModal(viewPanel: ViewPanel)'), 'modal/QuickPick actions must restore LGVS panel focus after dismissal or execution');
assert(extension.includes("await this.restorePanelFocusAfterModal(viewPanel);"), 'discard/file modal path must refocus the originating panel');
assert(extension.includes("await this.runMenu(showPullMenu, panel)"), 'message handlers must pass the originating panel into generic modal menus');
assert(extension.includes("await this.runMenu(showStashCreateMenu, panel)"), 'stash modal menus must restore focus to the originating panel');
assert(extension.includes("this.suppressWebviewAutoFocusUntil = 0;"), 'panel focus restoration must allow webview bootstrap autofocus after modal closes');
assert(extension.includes('private pendingWebviewAutoFocus = false;'), 'webview autofocus must be a one-shot explicit focus token, not every active-panel render');
assert(extension.includes('const shouldFocus = this.consumeWebviewAutoFocus(viewPanel);'), 'rendering active panels must not steal Command Palette/QuickPick focus during later refreshes');
assert(extension.includes("msg.type === 'commandPalette'"), 'LGVS webviews must explicitly hand Ctrl/Cmd+Shift+P and F1 to VS Code Command Palette');
assert(extension.includes("workbench.action.showCommands"), 'Command Palette handoff must use VS Code native command picker, not a custom LGVS picker');
assert(extension.includes("this.refresh(false).catch(err => vscode.window.showErrorMessage(err.message));"), 'webview attach/visibility refresh must not auto-open previews that steal Command Palette focus');
assert(dogfood.includes("LGVS_DOGFOOD_FAST_COMMAND_PALETTE"), 'UI dogfood must cover Command Palette staying open from LGVS sidebar focus');
assert(dogfood.includes("Command Palette stays open when invoked from LGVS sidebar focus"), 'UI dogfood must assert command palette survives webview refresh/autofocus races');
assert(dogfood.includes("step: 'files-discard-modal-focus-restore'"), 'UI dogfood must exercise d-discard modal focus restoration from the Files panel');
assert(dogfood.includes("Dogfood Modal Sentinel"), 'UI dogfood modal focus check must prove post-modal keyboard input returns to the Files panel, not the editor');

console.log('modalFocus tests passed');
