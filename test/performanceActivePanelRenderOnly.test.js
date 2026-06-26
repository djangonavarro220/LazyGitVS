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

console.log('performanceActivePanelRenderOnly tests passed');
