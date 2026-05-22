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
assert(dogfood.includes("step: 'files-discard-modal-focus-restore'"), 'UI dogfood must exercise d-discard modal focus restoration from the Files panel');
assert(dogfood.includes("Dogfood Modal Sentinel"), 'UI dogfood modal focus check must prove post-modal keyboard input returns to the Files panel, not the editor');

console.log('modalFocus tests passed');
