const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');
const testingDoc = fs.readFileSync(path.join(root, 'docs', 'testing-and-verification.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

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

function requireDogfoodInvariant(name, pattern) {
  assert(pattern.test(dogfood), `dogfood-ui.js must cover: ${name}`);
}

test('dogfood script keeps the full matrix and targeted lanes documented in the playbook', () => {
  requireDogfoodInvariant('matrix runner', /runMatrixIfNeeded/);
  requireDogfoodInvariant('no-vim lane', /name: 'no-vim'/);
  requireDogfoodInvariant('vim lane', /name: 'vim'/);
  requireDogfoodInvariant('preview-tabs targeted lane', /LGVS_DOGFOOD_FAST_PREVIEW_TABS/);
  requireDogfoodInvariant('vim-escape targeted lane', /LGVS_DOGFOOD_FAST_VIM_ESCAPE/);
  requireDogfoodInvariant('reset-state targeted lane', /LGVS_DOGFOOD_FAST_RESET_STATE/);
  requireDogfoodInvariant('deep-tree targeted lane', /LGVS_DOGFOOD_DEEP_TREE/);
  assert(pkg.scripts['dogfood:ui:deep-tree'], 'package.json must expose a deep-tree dogfood lane');
  assert(pkg.scripts['dogfood:ui:cramped'], 'package.json must expose a cramped-sidebar dogfood lane');
  requireDogfoodInvariant('cramped-sidebar window override', /LGVS_DOGFOOD_WINDOW_SIZE/);
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
  requireDogfoodInvariant('Escape stays on normal panels', /Escape on \$\{panelKey\} \$\{panelName\} keeps the current panel/);
  requireDogfoodInvariant('commit files detail is reachable', /Commit Enter shows changed files for the selected commit/);
  requireDogfoodInvariant('commit files detail returns to commit list', /Esc from commit files returns to the commit list/);
  requireDogfoodInvariant('contextual help opens and returns focus', /Contextual help opens and returns to LGVS focus/);
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

test('documented dogfood expected coverage is protected by this static contract', () => {
  const documentedBullets = [
    'Command Palette can run',
    'panels `1..8` are reachable',
    '`4 Commits` + `Enter` opens the selected commit details',
    '`?` opens contextual help and returns focus',
    'deep-tree and cramped-sidebar lanes exist',
    'Files `Enter` opens a real editor',
    'HUNK navigation works',
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
