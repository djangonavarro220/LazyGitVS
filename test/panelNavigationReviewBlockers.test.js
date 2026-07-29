const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { targetLane, panelNavigationBoundaryMatches } = require('../scripts/dogfood/reporting');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dogfoodSource = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(root, 'scripts', 'dogfood', 'extension-host-bootstrap.js'), 'utf8');
assert(dogfoodSource.includes("if (/-- STATUS · LG --/.test(await pageText(Runtime)))") && dogfoodSource.includes("if (/-- FILES · LG --/.test(await pageText(Runtime)))"), 'panel-navigation retries must reset an already-transitioned panel before requiring a fresh physical ACK');
const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test('configured webview router is the only Status/Files block-navigation authority', () => {
  const staticBlockKeys = new Set(['left', 'right', 'h', 'l', 'tab', 'shift+tab']);
  const staticPanelFallbacks = manifest.contributes.keybindings.filter(binding =>
    staticBlockKeys.has(binding.key)
    && /^lazygitvs\.focusPanel[128]$/.test(binding.command)
    && /focusedView == lazygitvs\.(status|files)View/.test(binding.when || '')
  );
  assert.deepStrictEqual(staticPanelFallbacks, [], 'hardcoded manifest fallbacks survive a reassigned lazygit keymap');
});

test('panel-navigation dogfood requires the exact from/to/activeView triplet', () => {
  const expected = { from: 'files', to: 'status', activeView: 'status' };
  assert.strictEqual(panelNavigationBoundaryMatches({ event: 'panelFocus', ...expected }, expected), true);
  assert.strictEqual(panelNavigationBoundaryMatches({ event: 'panelFocus', from: 'remotes', to: 'status', activeView: 'status' }, expected), false, 'wrong source panel must not pass');
  assert.strictEqual(panelNavigationBoundaryMatches({ event: 'panelFocus', from: 'files', to: 'remotes', activeView: 'status' }, expected), false, 'wrong destination panel must not pass');
  assert.strictEqual(panelNavigationBoundaryMatches({ event: 'panelFocus', from: 'files', to: 'status', activeView: 'files' }, expected), false, 'wrong active view must not pass');
});

test('panel-navigation dogfood proves focused panes per physical transition', () => {
  const block = dogfoodSource.slice(
    dogfoodSource.indexOf('const circularPanelKeys = ['),
    dogfoodSource.indexOf("if (process.env.LGVS_DOGFOOD_PANEL_NAVIGATION)")
  );
  assert(extensionSource.includes("if (type === 'focusArea')"), 'controller must observe a real webview focus acknowledgement');
  assert(extensionSource.includes('pendingPanelFocusTransition'), 'controller must bind the focus acknowledgement to the expected transition');
  assert(extensionSource.includes("event.data.type==='focusBody'"), 'destination webview must accept an explicit post-reveal focus request');
  assert(!/await this\.focusPanel\(next\);\s*recordDogfoodBoundary\('panelFocus'/.test(extensionSource), 'controller state alone must not masquerade as physical webview focus');
  assert(block.includes('waitForPanelNavigationBoundary'), 'dogfood must wait for the controller activeView marker');
  assert(!block.includes('waitForText('), 'global text can match hidden Files/Status webviews');
  assert(block.includes("step: `${family.name}:previous`"), 'missing previous-key evidence per family');
  assert(block.includes("step: `${family.name}:next`"), 'missing next-key evidence per family');
  assert(block.includes('checks.push(...familyChecks)'), 'expected six independent transition checks');
});

test('panel-navigation owns a test-only Extension Host bootstrap with a durable Files focus ACK', () => {
  assert(dogfoodSource.includes("? undoRedoBoundaryReport : path.join(userData, 'lazygit-panel-navigation-boundary.jsonl')"), 'undo lane must share its boundary stream with the navigation preflight');
  assert(dogfoodSource.includes('--extensionTestsPath=${path.join(ROOT, \'scripts\', \'dogfood\', \'extension-host-bootstrap.js\')}'), 'dogfood must load the bootstrap only as Extension Host tests');
  assert(dogfoodSource.includes("LGVS_DOGFOOD_EXTENSION_HOST_BOOTSTRAP: '1'") && dogfoodSource.includes('LGVS_DOGFOOD_BOOTSTRAP_REQUEST: bootstrapRequest') && dogfoodSource.includes('LGVS_DOGFOOD_BOOTSTRAP_RESULT: bootstrapResult') && dogfoodSource.includes('LGVS_DOGFOOD_BOOTSTRAP_DONE: bootstrapDone'), 'bootstrap paths and gate must be explicit in the test-only environment');
  assert(dogfoodSource.indexOf('waitForBootstrapResult') < dogfoodSource.indexOf('cdpConnect()'), 'dogfood must await the Extension Host acknowledgement before CDP input');
  assert(bootstrapSource.includes("executeCommand('lazygitvs.openDashboard')"), 'bootstrap must open the real dashboard command');
  assert(bootstrapSource.includes("record.event === 'panelFocus' && record.activeView === 'files' && record.to === 'files'"), 'bootstrap must require the durable real Files panelFocus boundary record');
  assert(bootstrapSource.indexOf('const observed = await waitForBoundary()') < bootstrapSource.indexOf('publish(resultPath'), 'bootstrap must observe the boundary ACK before publishing its result');
  assert(bootstrapSource.includes('boundary: observed'), 'bootstrap result must preserve the observed boundary evidence');
  assert(!/\b(?:document\.|querySelector|mouse|coordinates?|dispatchKeyEvent|postMessage\s*\(\s*\{\s*(?:event|type)\s*:\s*['\"]panelFocus)/i.test(bootstrapSource), 'bootstrap must not fake ACKs or use root-DOM, mouse, coordinates, or synthetic input');
  assert.strictEqual(targetLane({ LGVS_DOGFOOD_PANEL_NAVIGATION: '1' }), 'panel-navigation');
  assert(dogfoodSource.includes('last-run-${REPORT_SLUG}.json'), 'targeted report filename must include its lane');
  assert(dogfoodSource.includes("expectedTransitionChecks: circularPanelKeys.length * 2"), 'targeted report must record the expected six transition checks');
});