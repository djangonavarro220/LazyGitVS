const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const dogfoodFixtures = fs.readFileSync(path.join(root, 'scripts', 'dogfood', 'fixtures.js'), 'utf8');
const dogfoodReporting = fs.readFileSync(path.join(root, 'scripts', 'dogfood', 'reporting.js'), 'utf8');
const { writeNativeScreenshot, writeScreenshot } = require(path.join(root, 'scripts', 'dogfood', 'screenshots.js'));
const dogfoodSource = `${dogfood}\n${dogfoodFixtures}\n${dogfoodReporting}`;
const testingDoc = fs.readFileSync(path.join(root, 'docs', 'testing-and-verification.md'), 'utf8');
const knownBugsDoc = fs.readFileSync(path.join(root, 'docs', 'known-bugs.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ciWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const publishWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish.yml'), 'utf8');

const pendingTests = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingTests.push(result.then(() => console.log(`ok - ${name}`), error => {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
      }));
    } else {
      console.log(`ok - ${name}`);
    }
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

process.on('beforeExit', async () => { await Promise.all(pendingTests); });

function requireDogfoodInvariant(name, pattern) {
  assert(pattern.test(dogfoodSource), `dogfood sources must cover: ${name}`);
}

test('dogfood script keeps the full matrix and targeted lanes documented in the playbook', () => {
  requireDogfoodInvariant('matrix runner', /runMatrixIfNeeded/);
  requireDogfoodInvariant('no-vim lane', /name: 'no-vim'/);
  requireDogfoodInvariant('vim lane', /name: 'vim'/);
  requireDogfoodInvariant('preview-tabs targeted lane', /LGVS_DOGFOOD_FAST_PREVIEW_TABS/);
  requireDogfoodInvariant('vim-escape targeted lane', /LGVS_DOGFOOD_FAST_VIM_ESCAPE/);
  requireDogfoodInvariant('reset-state targeted lane', /LGVS_DOGFOOD_FAST_RESET_STATE/);
  requireDogfoodInvariant('deep-tree targeted lane', /LGVS_DOGFOOD_DEEP_TREE/);
  requireDogfoodInvariant('cramped-sidebar honest targeted lane', /LGVS_DOGFOOD_CRAMPED_SIDEBAR/);
  assert(pkg.scripts['dogfood:ui:deep-tree'], 'package.json must expose a deep-tree dogfood lane');
  assert(pkg.scripts['dogfood:ui:cramped'], 'package.json must expose a cramped-sidebar dogfood lane');
  assert(/LGVS_DOGFOOD_CRAMPED_SIDEBAR=1/.test(pkg.scripts['dogfood:ui:cramped']), 'cramped-sidebar dogfood lane must run the honest cramped guardrail, not only a full matrix with a small window');
  assert(pkg.scripts['dogfood:ui:edge-files'], 'package.json must expose a deleted/renamed/conflict dogfood lane');
  requireDogfoodInvariant('cramped-sidebar window override', /LGVS_DOGFOOD_WINDOW_SIZE/);
  requireDogfoodInvariant('edge-file targeted lane', /LGVS_DOGFOOD_EDGE_FILES/);
  requireDogfoodInvariant('theme override', /LGVS_DOGFOOD_THEME/);
});

test('dogfood creates a realistic two-repository Git fixture', () => {
  requireDogfoodInvariant('primary fixture repo init', /git\(dir, 'init'\)/);
  requireDogfoodInvariant('secondary fixture repo init', /git\(secondaryRepo, 'init'\)/);
  requireDogfoodInvariant('branch metadata', /git\(dir, 'branch', 'feature\/dogfood'\)/);
  requireDogfoodInvariant('tag metadata', /git\(dir, 'tag', 'v0\.0\.1'\)/);
  requireDogfoodInvariant('remote metadata', /git\(dir, 'remote', 'add', 'origin'/);
  requireDogfoodInvariant('stash metadata', /git\(dir, 'stash', 'push'/);
  requireDogfoodInvariant('staged plus unstaged same file fixture', /git\(dir, 'add', 'settings\.json'\)[\s\S]*write\(path\.join\(dir, 'settings\.json'\)/);
  requireDogfoodInvariant('secondary repo sentinel', /OTHER_REPO_SENTINEL\.md/);
});

test('dogfood asserts the documented visible UI smoke path', () => {
  requireDogfoodInvariant('Command Palette opens LGVS', /LazyGitVS: Focus SCM Sidebar/);
  requireDogfoodInvariant('all default panels are present', /2 FILES[\s\S]*3 BRANCHES[\s\S]*4 COMMITS[\s\S]*5 STASH[\s\S]*6 CONFLICTS[\s\S]*7 TAGS[\s\S]*8 REMOTES/);
  requireDogfoodInvariant('panel jumps 1..8', /\['1', 'Status'\][\s\S]*\['8', 'Remotes'\]/);
  requireDogfoodInvariant('Status panel ownership assertion', /Focus 1 keeps LGVS ownership or reveals Status panel/);
  requireDogfoodInvariant('Tags reveal assertion', /Focus 7 reveals Tags/);
  requireDogfoodInvariant('Remotes reveal assertion', /Focus 8 reveals Remotes/);
  requireDogfoodInvariant('cramped Tags honest state assertion', /Cramped sidebar numeric 7 updates LGVS Tags state without claiming native scroll reveal/);
  requireDogfoodInvariant('cramped Remotes honest state assertion', /Cramped sidebar numeric 8 updates LGVS Remotes state without claiming native scroll reveal/);
  requireDogfoodInvariant('cramped limitation evidence', /nativeScmDeepPanelRevealLimitation/);
  requireDogfoodInvariant('Escape stays on normal panels', /Escape on \$\{panelKey\} \$\{panelName\} keeps the current panel/);
  requireDogfoodInvariant('commit files detail is reachable', /Commit Enter loads the tree before navigation reaches the nested target preview/);
  requireDogfoodInvariant('contextual help focus return is covered', /Contextual help return keeps LGVS focus after active-panel lazy rendering/);
  assert(dogfood.includes("process.env.LGVS_DOGFOOD_FAST_PREVIEW_TABS && panelKey === '4'"), 'targeted preview dogfood must deliberately stabilize commit selection before requiring rich-preview reuse evidence');
  assert(dogfood.includes("runCommandPalette(Input, 'LazyGitVS: Open Operation Options')"), 'full dogfood must retry operation options through the qualified command when the physical m key is lost');
  assert((dogfood.match(/runCommandPalette\(Input, 'LazyGitVS: Focus SCM Sidebar'\)/g) || []).length >= 2 && dogfood.includes('clickFirstCommit().catch'), 'targeted preview dogfood must focus the sidebar and retry primary-repo selection before failing');
  assert(dogfood.includes("clickWorkbenchPaneRow(Runtime, Input, '2 FILES', 1)") && dogfood.includes('settings HUNK mode after primary-repo file click'), 'broad dogfood must restore the primary repo and physically click settings.json before HUNK entry');
  assert(dogfood.includes("clickWorkbenchPaneRow(Runtime, Input, '4 COMMITS', 0)") && dogfood.includes("clickWorkbenchPaneRow(Runtime, Input, '4 COMMITS', 1)"), 'targeted preview dogfood must physically click two distinct visible commit rows');
  assert(dogfood.includes("clickWorkbenchPaneRow(Runtime, Input, '5 STASH', 0)"), 'targeted preview dogfood must physically click the visible stash row');
  assert(dogfood.includes('richPreviewSnapshots.length === 3') && dogfood.includes('one rich-preview tab after the stash'), 'targeted preview dogfood must physically keep one rich tab across two commits and one stash');
  assert(dogfood.includes('env: { ...process.env, DISPLAY: NATIVE_DISPLAY, XAUTHORITY: nativeXauthority }'), 'native keyboard input must inherit the owning Xvfb display and authorization');
  assert(dogfood.includes('process.env.XAUTHORITY ||'), 'native screenshot capture must inherit the owning Xvfb authorization file');
  for (const workflow of [ciWorkflow, publishWorkflow]) {
    assert(workflow.includes('sudo apt-get install -y imagemagick'), 'CI and publish workflows must install the native screenshot dependency used by broad dogfood');
    assert(workflow.includes('npm run dogfood:ui:preview-tabs'), 'CI and publish workflows must run the targeted rich-preview gate separately from broad dogfood');
  }
});

test('dogfood proves the complete nested commit-file tree drilldown in full and targeted lanes', () => {
  assert.match(pkg.scripts['dogfood:ui:commit-file-tree'], /LGVS_DOGFOOD_FAST_COMMIT_FILE_TREE=1/, 'package.json must expose a targeted commit-file-tree lane');
  requireDogfoodInvariant('nested commit fixture', /commit-tree\/routes\/api\/target\.ts/);
  requireDogfoodInvariant('stable focus command', /ctrl\+alt\+4/);
  requireDogfoodInvariant('stable enter command', /LazyGitVS: Enter Selected Item/);
  requireDogfoodInvariant('loaded tree navigation proof', /Commit Enter loads the tree before navigation reaches the nested target preview/);
  requireDogfoodInvariant('readonly hunk proof', /Commit nested file Enter opens read-only HUNK\/LINE mode/);
  requireDogfoodInvariant('escape context proof', /Esc from commit-file HUNK returns to the commit-file tree/);
  assert(dogfood.includes('if (process.env.LGVS_DOGFOOD_FAST_COMMIT_FILE_TREE)'), 'targeted commit-file-tree lane must execute the real drilldown');
  assert(dogfood.includes('await exerciseCommitFileTree();'), 'the targeted lane must execute the real commit-file tree drilldown');
});

test('dogfood asserts editor HUNK and LINE flows with real Git state', () => {
  requireDogfoodInvariant('Files enter editor HUNK mode evidence', /files-enter-editor-hunk/);
  requireDogfoodInvariant('HUNK to LINE toggle evidence', /toggle-line-mode/);
  requireDogfoodInvariant('Space stages selected LINE', /Space in LINE mode stages the selected line change/);
  requireDogfoodInvariant('Tab switches to staged side', /tab-staged-side/);
  requireDogfoodInvariant('Space unstages selected LINE from staged side', /Space on staged LINE side unstages the selected README change/);
  requireDogfoodInvariant('Git cached diff assertion', /diffCachedNames\(fixture\)/);
  requireDogfoodInvariant('Git working diff assertion', /diffNames\(fixture\)/);
  requireDogfoodInvariant('nearby hunks stay separate', /Nearby staged settings edits stay separate zero-context hunks/);
  requireDogfoodInvariant('HUNK navigation changes visible selection', /HUNK navigation moves between changed areas/);
  requireDogfoodInvariant('HUNK j/k wraps', /HUNK j\/k wraps between first and last changed areas/);
  requireDogfoodInvariant('HUNK decorations changed-lines scoped', /HUNK decorations stay scoped to changed lines/);
});

test('dogfood asserts focus, Vim ownership, modal, preview and failure-only screenshot evidence', () => {
  requireDogfoodInvariant('right chat stays closed', /Right chat \/ secondary side bar stays closed/);
  requireDogfoodInvariant('Command Palette stays open from LGVS focus', /Command Palette stays open when invoked from LGVS sidebar focus/);
  requireDogfoodInvariant('discard modal restores focus', /Files d-discard modal restores keyboard focus/);
  requireDogfoodInvariant('modal sentinel key does not leak into editor', /Post-modal physical sentinel key does not leak into the active editor/);
  requireDogfoodInvariant('EDIT handoff to VSCodeVim', /VSCodeVim physical Esc returns Normal/);
  requireDogfoodInvariant('Vim :6 does not jump to LGVS panel 6', /VSCodeVim :6 keeps the digit in Vim command-line/);
  requireDogfoodInvariant('virtual previews not Untitled', /Generated previews use named virtual documents, not Untitled buffers/);
  requireDogfoodInvariant('screenshots are opt-in for passing runs', /LGVS_DOGFOOD_SCREENSHOTS/);
  requireDogfoodInvariant('failure screenshot is captured automatically', /failureScreenshot/);
});

test('dogfood playbook documents screenshots only for failures by default', () => {
  assert(testingDoc.includes('screenshots only for failures by default'), 'playbook must document failure-only screenshots');
  assert(testingDoc.includes('passing runs stay text/JSON-only'), 'playbook must document passing runs do not emit screenshot spam');
});

test('dogfood Status reaches the real focusPanel1 command through its stable dogfood keybinding', () => {
  assert(/key: `ctrl\+alt\+\$\{i \+ 1\}`, command: `lazygitvs\.focusPanel\$\{i \+ 1\}`/.test(dogfood), 'dogfood-only panel keybindings must target the real focusPanel commands');
  assert(/await chord\(Input, 'ctrl\+alt\+1'\)/.test(dogfood), 'Status setup must use the stable dogfood-only focusPanel1 keybinding');
  const statusSetup = dogfood.slice(dogfood.indexOf("await chord(Input, 'ctrl+alt+1')"), dogfood.indexOf("status-requires-explicit-repo-selection"));
  assert(!/dispatchLgvsDomKey/.test(statusSetup), 'Status setup must not fall back to synthetic DOM keyboard events');
});

test('forced failure screenshots are written when passing screenshots are disabled', async () => {
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-dogfood-shots-'));
  try {
    const file = await writeScreenshot({
      Page: { captureScreenshot: async () => ({ data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4aQAAAABJRU5ErkJggg==' }) },
      name: 'failure',
      force: true,
      screenshots: undefined,
      shots,
      variant: 'no-vim',
      variantName: 'no-vim',
      sleep: async () => {}
    });
    assert(file && fs.existsSync(file), 'forced failure screenshot must be written even without screenshots=all');
    assert.deepStrictEqual(fs.readFileSync(file).subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'forced screenshot must be a valid PNG, not an arbitrary CDP buffer');
    await assert.rejects(() => writeScreenshot({
      Page: { captureScreenshot: async () => ({ data: Buffer.from('not a PNG').toString('base64') }) },
      name: 'invalid-failure',
      force: true,
      screenshots: undefined,
      shots,
      sleep: async () => {}
    }), /valid PNG/, 'invalid CDP screenshot data must not be written as PNG evidence');
  } finally {
    fs.rmSync(shots, { recursive: true, force: true });
  }
});

test('native modal screenshots are captured from the owning X display and retained as PNG evidence', async () => {
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-native-modal-shots-'));
  try {
    const file = await writeNativeScreenshot({
      name: 'native-modal',
      shots,
      display: ':9347',
      sleep: async () => {},
      capture: ({ display, file }) => {
        assert.strictEqual(display, ':9347');
        fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4aQAAAABJRU5ErkJggg==', 'base64'));
      }
    });
    assert(file && fs.existsSync(file), 'native modal screenshot must be retained');
  } finally {
    fs.rmSync(shots, { recursive: true, force: true });
  }
});

test('deep SCM panel reveal limitation stays honest and guarded against fake fixes', () => {
  assert(knownBugsDoc.includes('VS Code does not expose a reliable public API to scroll a collapsed/deep contributed SCM view'), 'known-bugs must document the native deep-panel reveal API limitation');
  assert(knownBugsDoc.includes('Do not claim visual deep-panel reveal is fixed unless the dogfood screenshot proves it'), 'known-bugs must warn future agents not to claim fake visual reveal fixes');
  assert(!/workbench\.action\.(increaseViewSize|decreaseViewSize)|list\.scrollDown|focusSideBar/.test(extension), 'extension source must not add fake SCM view resize/scroll/focus hacks for deep panel reveal');
});

test('large repo refresh contract coalesces refresh storms and preserves file selection by path', () => {
  assert(/if \(this\.refreshTimer\) clearTimeout\(this\.refreshTimer\)/.test(extension), 'scheduled refreshes must debounce file watcher bursts');
  assert(extension.includes('this.refreshCoordinator.request(updatePreview'), 'in-flight refreshes must use the awaitable coalescing coordinator');
  assert(/previousPath = this\.currentFile\(\)\?\.path/.test(extension), 'refresh must snapshot the active file path before reloading Git state');
  assert(/findIndex\(row => row\.kind === 'file' && row\.file\.path === previousPath\)/.test(extension), 'refresh must restore the active file row by path when the selection did not move');
  assert(/virtualRows\(fileRows, this\.selected/.test(extension), 'large Files panels must render through the virtualized row window');
});

test('documented dogfood expected coverage is protected by this static contract', () => {
  const documentedBullets = [
    'Command Palette can run',
    'panels `1..8` are reachable',
    '`4 Commits` + `Enter` opens the selected commit details',
    '`?` opens contextual help and returns focus',
    'deep-tree and cramped-sidebar lanes exist',
    'deleted/renamed/conflict dogfood lane exists',
    'Files `Enter` opens a real editor',
    'HUNK navigation works',
    'HUNK navigation works and wraps',
    '`a` toggles HUNK/LINE mode',
    '`Space` stages',
    '`Tab` switches',
    '`Space` unstages',
    '`e` hands keyboard ownership',
    '`Esc` exits LGVS HUNK/LINE mode',
    'generated previews are named virtual documents',
    'failure screenshots are written'
  ];
  for (const bullet of documentedBullets) {
    assert(testingDoc.includes(bullet), `playbook missing expected coverage bullet: ${bullet}`);
  }
});
