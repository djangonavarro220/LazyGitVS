const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert(config.includes("undo: 'z', redo: 'Z'"), 'defaults must use upstream lazygit z/Z');
assert(extension.includes("if(panel!=='conflicts'&&hit(e,u.undo))"), 'reflog undo must be global on LGVS sidebar panels except Conflicts, where upstream z means conflict-resolution undo');
assert(extension.includes("if(panel!=='conflicts'&&hit(e,u.redo))"), 'reflog redo must be global on LGVS sidebar panels except Conflicts');
assert(extension.includes("label: '$(discard) Undo'"), 'contextual help must expose upstream Undo wording');
assert(extension.includes("label: '$(redo) Redo'"), 'contextual help must expose upstream Redo wording');
assert(extension.includes('The reflog will be used to determine what git command to run to undo the last git command.'), 'Undo tooltip must preserve upstream wording');
assert(extension.includes("if (type === 'reflogUndo') await this.reflogUndo();"), 'webview undo must reach the reflog workflow');
assert(extension.includes("if (type === 'reflogRedo') await this.reflogRedo();"), 'webview redo must reach the reflog workflow');
assert(extension.includes("showWarningMessage(prompt, { modal: true }, title)"), 'every reflog reset/checkout must have an explicit modal confirmation');
assert(extension.includes("planAndPerformReflogAction(workspaceRoot(), direction"), 'undo/redo must be scoped to the selected repository');
assert(!extension.includes("this.hunkCommandCatalog(viewPanel), ...this.reflogCommandCatalog()"), 'editor HUNK/LINE help must not advertise reflog undo where LGVS does not route it');

for (const command of ['lazygitvs.undoReflog', 'lazygitvs.redoReflog']) {
  assert(pkg.activationEvents.includes(`onCommand:${command}`), `${command} must activate the extension`);
  const contribution = pkg.contributes.commands.find(item => item.command === command);
  assert(contribution, `${command} must be contributed`);
  assert.strictEqual(contribution.enablement, 'lazygitvs.keyboardMode && !lazygitvs.editorHunkMode && lazygitvs.activeView != conflicts', `${command} must stay off Conflicts and editor HUNK/LINE surfaces`);
}
for (const [key, command] of [['z', 'lazygitvs.undoReflog'], ['shift+z', 'lazygitvs.redoReflog']]) {
  const binding = pkg.contributes.keybindings.find(item => item.key === key && item.command === command);
  assert(binding, `${key} must route ${command} from the native Status tree`);
  assert.strictEqual(binding.when, "focusedView == lazygitvs.statusView && !editorTextFocus", `${key} must not leak beyond upstream-equivalent LGVS scope`);
}
assert(!pkg.contributes.keybindings.some(item => ['lazygitvs.undoReflog', 'lazygitvs.redoReflog'].includes(item.command) && /editorHunkMode/.test(item.when)), 'reflog undo/redo must stay out of editor HUNK/LINE mode');

console.log('undoRedoParity tests passed');
