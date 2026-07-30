const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const operation = fs.readFileSync(path.join(root, 'src', 'statusGitOperation.ts'), 'utf8');
const gitService = fs.readFileSync(path.join(root, 'src', 'gitService.ts'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');
const pkg = require(path.join(root, 'package.json'));
const parity = fs.readFileSync(path.join(root, 'docs', 'lazygit-parity-gap-report.md'), 'utf8');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');

assert(extension.includes("`${repo.operation ? `(${repo.operation.label}) ` : ''}${repo.name} → ${repo.branch}`"), 'Status rows must render upstream operation text as `(operation) repo → branch`');
assert(operation.includes("state.actions.map(action => ({\n    key: action.key,\n    label: action.label"), 'm options must preserve upstream c/a/s keys and labels from detected state');
assert(operation.includes("git(action.args, repoPath, { GIT_EDITOR: 'true' })"), 'operation continue must suppress an unavailable terminal editor while preserving the existing commit message');
assert(operation.includes("detectGitOperationState(repoPath)"), 'operation actions must re-read Git state instead of trusting a stale Status row');
assert(operation.includes("current.identity !== openedState.identity") && operation.includes("afterConfirmation.identity !== current.identity"), 'operation actions must reject a replaced same-kind operation before and after confirmation');
assert(operation.includes("if (!isAvailable())"), 'operation actions must reject a repository that disappeared while the menu was open');
assert(gitService.includes('env: { ...process.env, ...envOverrides }'), 'Git execution must merge operation-only environment overrides without losing PATH or the host environment');
assert(config.includes("createRebaseOptionsMenu: 'm'"), 'default operation options key must match lazygit createRebaseOptionsMenu=m');

const operationBinding = pkg.contributes.keybindings.find(binding => binding.command === 'lazygitvs.openOperationOptions');
assert.deepStrictEqual(operationBinding, {
  key: 'm',
  command: 'lazygitvs.openOperationOptions',
  when: 'focusedView == lazygitvs.statusView && lazygitvs.statusViewVisible && !editorTextFocus'
}, 'm must be scoped to the visible native Status view and never steal editor input');
assert(extension.includes('hit(e,u.createRebaseOptionsMenu)') && extension.includes("type:'operationOptions'"), 'webview panels must route the configured global lazygit operation-options key');
assert(extension.includes("explicitRepoPath ?? (typeof selected?.id === 'string' ? selected.id : getActiveWorkspaceRoot())"), 'operation options must use an explicit target, selected Status repo, or active repo, never an implicit first repo');
assert(operation.includes('if (!isAvailable())') && operation.includes('detectGitOperationState(repoPath)'), 'operation execution must revalidate both repository target and operation state');
assert(operation.includes('Deliberately do not stage anything'), 'operation actions must not invent implicit conflict staging');

assert(parity.includes('- [x] Show merge/rebase/cherry-pick state in Status as `(operation) repo → branch`.'), 'parity tracker must record the completed Status-row behavior');
assert(parity.includes('- [x] Open operation options with `m`: `c` continue, `a` abort, and `s` skip where applicable.'), 'parity tracker must record the completed operation actions');
assert(parity.includes('[x] Commits `viewBisectOptions`') && parity.includes('Bisect remains intentionally outside Status'), 'parity tracker must record the closed Commits bisect workflow while keeping it out of Status');
assert(parity.includes('- [x] Detect revert operation status and expose `c` continue, `a` abort, and `s` skip options.'), 'parity tracker must record completed upstream revert operation status/options');

assert(dogfood.includes("name: 'Status operation row and m options match lazygit'"), 'real UI dogfood must cover the Status operation label and m options menu');
assert(dogfood.includes("name: 'Status operation abort exposes a native confirmation before mutation'"), 'real UI dogfood must prove abort cannot mutate Git before modal confirmation');
assert(dogfood.includes("name: 'Confirmed abort clears only the selected repository operation'"), 'real UI dogfood must prove abort leaves the selected repository operation-free without mutating another repo');
assert(dogfood.includes("'12-status-operation-options', { force: true }") && dogfood.includes("nativeScreenshot('13-status-operation-abort-confirmation')") && dogfood.includes("'14-status-operation-aborted-selected-repo', { force: true }"), 'operation menu, native destructive confirmation, and selected-repo result must keep fresh screenshot evidence even on passing runs');
assert(pkg.scripts['dogfood:ui:operation-status'] === 'node scripts/run-operation-dogfood.js', 'package.json must expose the dedicated operation-status lane');
assert(dogfood.includes("name: 'Cancelling operation abort causes no repository mutation'") && dogfood.includes("name: 'Confirmed abort clears only the selected repository operation'"), 'targeted dogfood must prove cancellation and selected-repository isolation with real Git state');
assert(dogfood.includes('await selectOtherRepoStatusFixture();') && dogfood.includes("await chord(Input, 'ctrl+alt+1');") && dogfood.includes("await key(Input, 'Home');") && dogfood.includes("await key(Input, 'ArrowDown');") && dogfood.includes("await key(Input, 'Enter');"), 'operation Status selection must use the deterministic keyboard fixture path, not a dynamic operation label, DOM coordinate selector, or geometric row index');
const operationSelection = dogfood.indexOf('await selectOtherRepoStatusFixture();');
assert(operationSelection >= 0 && dogfood.indexOf("'other-repo current status selection'", operationSelection) > operationSelection && dogfood.indexOf("'Status Enter switches from the current repository row to other-repo'", operationSelection) > operationSelection, 'operation flow must verify the keyboard-selected secondary repository through its current-status and selected-repository product-state assertions');
assert(!dogfood.includes('clickWorkbenchPaneRow') && !/Input\.dispatchMouseEvent/.test(dogfood), 'operation Status selection must not regress to DOM-coordinate or mouse-event interaction');

console.log('operationStatusParity tests passed');
