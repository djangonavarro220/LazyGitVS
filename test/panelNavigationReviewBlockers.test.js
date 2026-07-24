const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { targetLane, panelNavigationBoundaryMatches } = require('../scripts/dogfood/reporting');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dogfoodSource = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');
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

test('panel-navigation owns a stable report lane and six transition checks', () => {
  assert(dogfoodSource.includes("? undoRedoBoundaryReport : path.join(userData, 'lazygit-panel-navigation-boundary.jsonl')"), 'undo lane must share its boundary stream with the navigation preflight');
  assert(dogfoodSource.includes(": { ...process.env, LGVS_DOGFOOD_BOUNDARY_REPORT: panelNavigationBoundaryReport }"), 'full dogfood must enable panel-focus boundary evidence too');
  assert.strictEqual(targetLane({ LGVS_DOGFOOD_PANEL_NAVIGATION: '1' }), 'panel-navigation');
  assert(dogfoodSource.includes('last-run-${REPORT_SLUG}.json'), 'targeted report filename must include its lane');
  assert(dogfoodSource.includes("expectedTransitionChecks: circularPanelKeys.length * 2"), 'targeted report must record the expected six transition checks');
});