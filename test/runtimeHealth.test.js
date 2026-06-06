const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');

assert(pkg.activationEvents.includes('onCommand:lazygitvs.resetState'), 'Reset command must activate LGVS even when called from a weird/stale state');
assert(pkg.contributes.commands.some(command => command.command === 'lazygitvs.resetState' && /Reset state/.test(command.title)), 'Reset command must be visible from Command Palette');
assert(extension.includes("registerCommand('lazygitvs.resetState', () => app.resetState())"), 'Reset command must route to the controller reset path');
assert(extension.includes('async resetState()'), 'Controller must expose a resetState method');
assert(pkg.activationEvents.includes('onCommand:lazygitvs.dumpHealth'), 'Dump health command must activate LGVS for stale-state inspection');
assert(pkg.contributes.commands.some(command => command.command === 'lazygitvs.dumpHealth' && /Dump health/.test(command.title)), 'Dump health command must be visible from Command Palette');
assert(extension.includes("registerCommand('lazygitvs.dumpHealth', () => app.dumpHealth())"), 'Dump health command must route to controller health snapshot');
assert(extension.includes('async dumpHealth()'), 'Controller must expose a dumpHealth method');
assert(extension.includes('private healthSnapshot()'), 'Health snapshot must be centralized and testable by source contract');
assert(extension.includes("showText('LazyGitVS Health"), 'Dump health must use named virtual preview docs, not Untitled buffers');
assert(extension.includes('this.clearRuntimeTimers();'), 'resetState must cancel refresh/interval timers instead of leaving CPU loops alive');
assert(extension.includes('private clearRuntimeTimers()'), 'Timer cleanup must be centralized and reusable');
assert(extension.includes('if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = undefined; }'), 'Reset must clear pending refresh timeout');
assert(extension.includes('if (this.intervalTimer) { clearInterval(this.intervalTimer); this.intervalTimer = undefined; }'), 'Reset must clear periodic refresh interval');
assert(extension.includes("await vscode.commands.executeCommand('setContext', 'lazygitvs.panelFocus', false)"), 'Reset must clear panel focus context');
assert(extension.includes("await vscode.commands.executeCommand('setContext', 'lazygitvs.viewerFocus', false)"), 'Reset must clear viewer focus context');
assert(extension.includes("await vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', false)"), 'Reset must clear LGVS keyboard mode');
assert(extension.includes("await vscode.commands.executeCommand('setContext', 'vim.active', true)"), 'Reset must hand keyboard ownership back to Vim/VS Code');
assert(extension.includes('this.modeStatusBarItem.hide();'), 'Reset must hide LGVS mode status');
assert(extension.includes('this.clearEditorHunkDecorations();'), 'Reset must remove editor decorations/gutter markers');
assert(extension.includes("vscode.window.showInformationMessage('LazyGitVS: state reset.')"), 'Reset should give a short human confirmation');
assert(dogfood.includes('LGVS_DOGFOOD_FAST_RESET_STATE'), 'Dogfood needs a fast reset-state lane');
assert(dogfood.includes('Reset clears LGVS mode/status ownership'), 'Dogfood must assert reset removes LGVS visible ownership');
assert(dogfood.includes('performance.now()'), 'Dogfood reset lane should measure latency without guessing from sleeps');

console.log('runtimeHealth tests passed');
