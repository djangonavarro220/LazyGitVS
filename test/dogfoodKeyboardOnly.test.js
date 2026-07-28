const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');

assert(!dogfood.includes('Input.dispatchMouseEvent'), 'broad dogfood must not dispatch mouse events');
assert(!/getBoundingClientRect\(\)[\s\S]{0,240}\b[xy]\s*:/.test(dogfood), 'broad dogfood must not derive interaction coordinates from DOM rectangles');
assert(!dogfood.includes('workbench-pane-row'), 'broad dogfood must not import or reference the deleted pane-row coordinate resolver');

for (const required of [
  "await key(Input, 'Home')",
  "await key(Input, 'ArrowDown')",
  "await key(Input, 'Enter')",
  "const panelChord = /^ctrl\\+alt\\+([1-8])$/.exec(keys);",
  'selectPrimaryStatusFixture',
  'selectFirstCommitFixture',
  'selectSecondCommitFixture',
  'selectFirstStashFixture',
  'selectMasterBranchFixture',
  'selectSettingsJsonFixture',
  'selectOtherRepoStatusFixture'
]) {
  assert(dogfood.includes(required), `keyboard-only fixture navigation must retain ${required}`);
}

for (const required of [
  'Branches Enter shows commits for the selected branch',
  'Files selection reaches HUNK for settings.json',
  'Status Enter switches from the current repository row to other-repo',
  'Files panel shows the selected repository changes after Status Enter',
  'previewTabs multiple still keeps one transient rich preview while navigating commits and stash'
]) {
  assert(dogfood.includes(required), `keyboard-only dogfood must retain product result assertion: ${required}`);
}

assert(dogfood.includes("if (keys === 'ctrl+alt+g') return key(Input, 'g', { ctrl: true, alt: true });"), 'telemetry sidebar focus must use the physical Ctrl+Alt+G chord');
const telemetrySidebarFocus = dogfood.match(/writeTelemetryPhase\('telemetry\/sidebar-focus'\)[\s\S]{0,300}waitForText\(Runtime, \/2 FILES\|1 STATUS\//)?.[0] || '';
assert(telemetrySidebarFocus.includes('await focusTelemetrySidebar(Input);') && !/runCommandPalette|Input\.dispatchMouseEvent|\b[xy]\s*:|dispatchEvent/.test(telemetrySidebarFocus), 'bounded telemetry sidebar-focus block must use only direct keyboard focus and the sidebar product-state wait');

console.log('dogfoodKeyboardOnly tests passed');
