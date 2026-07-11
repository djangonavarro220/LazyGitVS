const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const webviewSecurity = fs.readFileSync(path.join(root, 'src', 'webviewSecurity.ts'), 'utf8');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');
const dogfoodReporting = fs.readFileSync(path.join(root, 'scripts', 'dogfood', 'reporting.js'), 'utf8');
const upstreamAudit = fs.readFileSync(path.join(root, 'docs', 'lazygit-undo-redo-audit.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { parseSimpleYaml } = require('../out/lazygitConfig');

assert(config.includes("undo: 'z', redo: 'Z'"), 'defaults must use upstream lazygit z/Z');
const custom = parseSimpleYaml('keybinding:\n  universal:\n    undo: x\n    redo: X\n');
assert.deepStrictEqual(custom.keybinding.universal, { undo: 'x', redo: 'X' }, 'custom undo/redo keys must survive lazygit config parsing exactly');
assert(extension.includes("if(panel!=='conflicts'&&hit(e,u.undo))"), 'reflog undo must be global on LGVS sidebar panels except Conflicts, where upstream z means conflict-resolution undo');
assert(extension.includes("if(panel!=='conflicts'&&hit(e,u.redo))"), 'reflog redo must be global on LGVS sidebar panels except Conflicts');
assert(extension.includes("label: '$(discard) Undo'"), 'contextual help must expose upstream Undo wording');
assert(extension.includes("label: '$(redo) Redo'"), 'contextual help must expose upstream Redo wording');
assert(extension.includes('The reflog will be used to determine what git command to run to undo the last git command.'), 'Undo tooltip must preserve upstream wording');
assert(extension.includes("if (type === 'reflogUndo') await this.reflogUndo();"), 'webview undo must reach the reflog workflow');
assert(extension.includes("if (type === 'reflogRedo') await this.reflogRedo();"), 'webview redo must reach the reflog workflow');
assert(webviewSecurity.includes("'reflogUndo'") && webviewSecurity.includes("'reflogRedo'"), 'webview message normalization must admit reflog undo/redo events');
assert(extension.includes("showWarningMessage(prompt, { modal: true }, title)"), 'every reflog reset/checkout must have an explicit modal confirmation');
assert(extension.includes('const root = workspaceRoot();') && extension.includes('planAndPerformReflogAction(root, direction'), 'undo/redo must be scoped to the selected repository');
assert(!extension.includes("this.hunkCommandCatalog(viewPanel), ...this.reflogCommandCatalog()"), 'editor HUNK/LINE help must not advertise reflog undo where LGVS does not route it');

for (const command of ['lazygitvs.undoReflog', 'lazygitvs.redoReflog']) {
  assert(pkg.activationEvents.includes(`onCommand:${command}`), `${command} must activate the extension`);
  const contribution = pkg.contributes.commands.find(item => item.command === command);
  assert(contribution, `${command} must be contributed`);
  assert.strictEqual(contribution.enablement, 'lazygitvs.keyboardMode && !lazygitvs.editorHunkMode && lazygitvs.activeView != conflicts', `${command} must stay off Conflicts and editor HUNK/LINE surfaces`);
}
const statusView = pkg.contributes.views.scm.find(item => item.id === 'lazygitvs.statusView');
assert.strictEqual(statusView.type, 'webview', 'Status must use the same runtime lazygit keymap router as every other sidebar panel');
assert(!pkg.contributes.keybindings.some(item => ['lazygitvs.undoReflog', 'lazygitvs.redoReflog'].includes(item.command)), 'static z/Z bindings must not override custom lazygit undo/redo keys');
assert(extension.includes('for (const panel of PANEL_ORDER) context.subscriptions.push(vscode.window.registerWebviewViewProvider'), 'Status must be registered through the shared webview provider');
assert(!pkg.contributes.keybindings.some(item => ['lazygitvs.undoReflog', 'lazygitvs.redoReflog'].includes(item.command) && /editorHunkMode/.test(item.when)), 'reflog undo/redo must stay out of editor HUNK/LINE mode');
assert(dogfood.includes("{ key: 'ctrl+alt+f', command: 'lazygitvs.filesView.focus' }"), 'targeted undo dogfood must use VS Code\'s supported webview focus command before sending configured keys');
assert(dogfood.includes("await chord(Input, 'ctrl+alt+f')"), 'targeted undo dogfood must physically invoke the Files focus command');
assert(!dogfood.includes("dispatchLgvsKey(Runtime, 'x'"), 'targeted undo dogfood must not substitute synthetic DOM keyboard evidence for real input');
assert(dogfood.includes("await key(Input, 'x')"), 'targeted undo dogfood must physically send the configured key into the focused Files webview');
assert(extension.includes("type:'dogfoodBoundary'"), 'the real webview key router must expose bounded dogfood boundary events');
assert(extension.includes("process.env.LGVS_DOGFOOD_BOUNDARY_REPORT"), 'boundary events must be gated by the existing dogfood environment/reporting channel');
assert(dogfood.includes('boundaryEvents'), 'targeted undo dogfood must persist boundary events in its normal report');
assert(dogfood.includes("event === 'reflogUndo'"), 'targeted undo dogfood must assert that physical x emitted reflogUndo');
assert(dogfood.includes("path.join(SHOTS, REPORT_SLUG)"), 'each targeted lane must retain screenshots in its own report-scoped directory');
assert(dogfoodReporting.includes('assertScreenshotEvidence(report)'), 'a passing dogfood report must reject missing screenshot evidence before it is written');
assert(upstreamAudit.includes('146f00491820055f3a6c0d492447d7e2b9da7d83'), 'undo/redo audit must name the reproducible upstream checkout commit');
assert(!upstreamAudit.includes('e59c1d1cb7c4fde83918e72a92897ce76d185c9f'), 'undo/redo audit must not cite the unavailable upstream object');

console.log('undoRedoParity tests passed');
