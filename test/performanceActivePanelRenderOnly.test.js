const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

assert.match(extension, /private renderActivePanel\(viewPanel: ViewPanel\) \{[^\n]*this\.render\(viewPanel\);[^\n]*\}/, 'Pure webview navigation should have a narrow active-panel render helper');

for (const method of ['select', 'move', 'moveTo']) {
  const methodSource = extension.match(new RegExp(`private async ${method}\\(viewPanel: ViewPanel[\\s\\S]*?\\n  }`));
  assert(methodSource, `${method} method must exist`);
  assert(methodSource[0].includes('this.renderActivePanel(viewPanel);'), `${method} should repaint only the active webview panel for selection-only navigation`);
  assert(!methodSource[0].includes('this.renderAll();'), `${method} must not rebuild every LGVS panel/webview during selection-only navigation`);
}

const renderAllSource = extension.match(/private renderAll\(\) \{[\s\S]*?\n  \}/);
assert(renderAllSource, 'Full render helper must remain available for refreshes and structural UI changes');
assert(renderAllSource[0].includes('this.statusTreeProvider?.refresh();'), 'Full renders must continue refreshing the Status tree');
assert(renderAllSource[0].includes('for (const panel of PANEL_ORDER) this.render(panel);'), 'Full renders must continue rebuilding all webview panels when needed');

const focusPanelSource = extension.slice(extension.indexOf('  private async focusPanel('), extension.indexOf('  private async restorePanelFocusAfterModal('));
assert(focusPanelSource.includes('const previousViewPanel = this.activeViewPanel();'), 'Panel switches must retain the previously active view so its focus styling can be cleared without rebuilding every panel');
assert(focusPanelSource.includes('this.renderFocusedPanels(previousViewPanel, panel);'), 'Panel switches must repaint only the previous and newly focused panels');
assert(!focusPanelSource.includes('this.renderAll();'), 'Panel switches must not rebuild every LGVS webview while telemetry is waiting for the dispatched panel');

const focusedPanelsSource = extension.match(/private renderFocusedPanels\(previousViewPanel: ViewPanel, activeViewPanel: ViewPanel\) \{[^\n]*\}/);
assert(focusedPanelsSource, 'Focused panel renderer must exist');
assert(focusedPanelsSource[0].includes('this.render(previousViewPanel);'), 'Focused panel renderer must clear the previous panel selection');
assert(focusedPanelsSource[0].includes('this.render(activeViewPanel);'), 'Focused panel renderer must render the dispatched panel');
assert(!focusedPanelsSource[0].includes('PANEL_ORDER'), 'Focused panel renderer must not fan out across every panel');

console.log('performanceActivePanelRenderOnly tests passed');
