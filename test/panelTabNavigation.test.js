const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { cloneKeymap } = require('../out/lazygitConfig');
const { panelBlockNavigationDelta } = require('../out/panelKeyboardRouter');
const { PANEL_ORDER } = require('../out/panels');

const root = path.join(__dirname, '..');
const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const sourceFile = ts.createSourceFile('extension.ts', extensionSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function controllerMethod(name, globals = {}) {
  let method;
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name?.getText(sourceFile) === name) method = node;
    if (!method) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert(method?.body, `LazyGitVSController.${name} must exist`);
  const parameters = method.parameters.map(parameter => parameter.name.getText(sourceFile));
  const body = method.body.statements.map(statement => statement.getText(sourceFile)).join('\n');
  const globalNames = Object.keys(globals);
  return Function(...globalNames, `return async function(${parameters.join(',')}) { ${body} }`)(...globalNames.map(key => globals[key]));
}

const moveBlock = controllerMethod('moveBlock', { PANEL_ORDER, recordDogfoodBoundary() {} });
const renderFocusedPanels = controllerMethod('renderFocusedPanels');
const renderActivePanel = controllerMethod('renderActivePanel');
const universal = cloneKeymap().universal;
const keyFamilies = [
  { name: 'arrows', previous: universal.prevBlock, next: universal.nextBlock },
  { name: 'h/l', previous: universal.prevBlockAlt, next: universal.nextBlockAlt },
  { name: 'Shift+Tab/Tab', previous: universal.prevBlockAlt2, next: universal.nextBlockAlt2 }
];

for (const family of keyFamilies) {
  assert.strictEqual(panelBlockNavigationDelta(family.previous, universal), -1, `${family.name}: production keyboard router must route previous`);
  assert.strictEqual(panelBlockNavigationDelta(family.next, universal), 1, `${family.name}: production keyboard router must route next`);
}
assert.strictEqual(panelBlockNavigationDelta('j', universal), undefined, 'production keyboard router must leave unrelated keys unchanged');

const customUniversal = { ...universal, prevBlock: 'x', prevBlockAlt: '<disabled>', prevBlockAlt2: '<disabled>', nextBlock: 'y', nextBlockAlt: '<disabled>', nextBlockAlt2: '<disabled>' };
assert.strictEqual(panelBlockNavigationDelta('x', customUniversal), -1, 'custom previous-block binding must route dynamically');
assert.strictEqual(panelBlockNavigationDelta('y', customUniversal), 1, 'custom next-block binding must route dynamically');
for (const staleDefault of ['<left>', '<right>', 'h', 'l', '<backtab>', '<tab>']) {
  assert.strictEqual(panelBlockNavigationDelta(staleDefault, customUniversal), undefined, `reassigned keymap must not retain default ${staleDefault}`);
}

function blockDelta(binding) {
  if ([universal.prevBlock, universal.prevBlockAlt, universal.prevBlockAlt2].includes(binding)) return -1;
  if ([universal.nextBlock, universal.nextBlockAlt, universal.nextBlockAlt2].includes(binding)) return 1;
  throw new Error(`not a block-navigation binding: ${binding}`);
}

function navigationHarness(initialPanel) {
  const rendered = [];
  const harness = {
    active: initialPanel,
    ownsModeStatus: false,
    statusTreeProvider: { refresh() {} },
    activeViewPanel() { return this.active; },
    persistNavigationState() {},
    render(panel) { rendered.push(panel); },
    async focusPanel(next) {
      const previous = this.active;
      this.active = next;
      await renderFocusedPanels.call(this, previous, next);
      await renderActivePanel.call(this, next);
    }
  };
  return { harness, rendered };
}

(async () => {
  for (const family of keyFamilies) {
    const { harness, rendered } = navigationHarness('files');

    await moveBlock.call(harness, 'files', blockDelta(family.previous));
    assert.strictEqual(harness.active, 'status', `${family.name}: Files previous must reach Status`);
    assert(rendered.includes('status'), `${family.name}: focusing Status must render/arm its real webview keyboard router`);

    rendered.length = 0;
    await moveBlock.call(harness, 'status', blockDelta(family.next));
    assert.strictEqual(harness.active, 'files', `${family.name}: Status next must return to Files`);
    assert(rendered.includes('files'), `${family.name}: returning to Files must render the destination panel`);
  }

  const { harness: wrapHarness, rendered: wrapRendered } = navigationHarness('status');
  await moveBlock.call(wrapHarness, 'status', -1);
  assert.strictEqual(wrapHarness.active, 'remotes', 'Previous from Status must wrap to Remotes');
  assert(wrapRendered.includes('remotes'), 'wrapped destination must render');
  await moveBlock.call(wrapHarness, 'remotes', 1);
  assert.strictEqual(wrapHarness.active, 'status', 'Next from Remotes must wrap to Status');
  assert(wrapRendered.includes('status'), 'wrapped Status destination must render/arm its keyboard router');

  console.log('panel circular navigation tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
