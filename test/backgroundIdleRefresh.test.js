const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const panels = fs.readFileSync(path.join(root, 'src', 'panels.ts'), 'utf8');

assert(extension.includes('vscode.window.onDidChangeWindowState(state => this.handleWindowStateChanged(state))'), 'LGVS must listen for VS Code window focus changes so minimized/background windows can stop refresh work');
assert(extension.includes('private windowFocused = vscode.window.state.focused'), 'LGVS must seed background refresh gating from VS Code window state');
assert(extension.includes('private refreshDirtyWhileUnfocused = false'), 'LGVS must remember watcher/timer refresh requests while VS Code is unfocused');
assert(extension.includes('if (!this.windowFocused || !this.visible()) return;'), 'Periodic refresh interval must not start while VS Code is unfocused or no LGVS view is visible');
assert(extension.includes('if (!this.visible()) { this.clearRuntimeTimers(); return; } this.updateModeStatusBar();'), 'File watcher/timer refresh requests must do no status/UI work while LGVS is invisible');
assert(extension.includes('if (!this.windowFocused) { this.refreshDirtyWhileUnfocused = true; return; }'), 'File watcher/timer refresh requests must not schedule Git work while VS Code is unfocused');
assert(extension.includes('private handleWindowStateChanged(state: vscode.WindowState)'), 'Window focus handler must be centralized and testable by source contract');
assert(extension.includes('if (!state.focused) { this.clearRuntimeTimers(); return; }'), 'Losing focus must clear pending refresh timeout and interval');
assert(extension.includes('if (this.visible()) { this.ensureRuntimeInterval(); this.refreshDirtyWhileUnfocused = false; this.scheduleRefresh(0); }'), 'Regaining focus must restart one live interval and run a single catch-up refresh');
assert(extension.includes('this.cancelFilesPreview();'), 'Runtime timer cleanup must cancel pending file preview work too');
assert(extension.includes('this.render(panel);\n    this.scheduleRefresh(0);'), 'Webview attach must route initial refresh through the same background-aware scheduler');
assert(extension.includes('windowFocused: this.windowFocused') && extension.includes('refreshDirtyWhileUnfocused: this.refreshDirtyWhileUnfocused'), 'Dump health must expose background refresh state for real Mac diagnosis');
assert(panels.includes('REFRESH_INTERVAL_MS = 10_000'), 'This guard intentionally covers the 10s background ticker that can burn CPU overnight');

console.log('backgroundIdleRefresh tests passed');
