const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const gitService = fs.readFileSync(path.join(root, 'src', 'gitService.ts'), 'utf8');
const lazygitConfig = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');
const dogfoodUi = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');
const parityGapReport = fs.readFileSync(path.join(root, 'docs', 'lazygit-parity-gap-report.md'), 'utf8');
const parityAudit = fs.readFileSync(path.join(root, 'docs', 'lazygit-parity-audit.md'), 'utf8');

assert(gitService.includes("'diff-tree', '--root', '--no-commit-id', '--name-status', '-r', hash"), 'Commit file list must include root commits too; otherwise Enter on the first commit never opens the lazygit-style file subview');
assert(gitService.includes("'stash', 'show', '--name-status', '--find-renames', ref"), 'Stash file list must keep real paths/renames for diff-editor preview, not display-only joined paths');
assert(gitService.includes('export type StashFile = { status: string; path: string; oldPath?: string };'), 'StashFile must preserve oldPath for renamed stash entries');

assert(extension.includes("else if (panel === 'branches') { const b = this.currentBranch(); if (b) await showText(`LazyGitVS Branch ${b.name}`, await git(branchLogArgs(this.lazygitGit, b.name)), preserveFocus, preserveFocus); }"), 'Branches navigation must render the selected branch log in the right/main pane, like lazygit localBranches GetOnRenderToMain');
assert(extension.includes("if (panel === 'branches') return this.enterBranchCommits();"), 'Branches Enter must switch to the commits panel scoped to the selected branch, matching lazygit View commits for selected branch');
assert(extension.includes('private async enterBranchCommits()'), 'Branch Enter needs an explicit branch-scoped commits entry path');
assert(extension.includes('this.commitListForBranch = b;'), 'Branch-scoped commits must retain the selected branch context');
assert(extension.includes("await commits(b.name)"), 'Branch-scoped commits should load git log for the selected branch, not the global commit list');
assert(lazygitConfig.includes("focusMainView: '0'"), 'LazyGitVS must preserve lazygit universal.focusMainView=0 for focusing the right/main preview pane');
assert(extension.includes("if(hit(e,u.focusMainView)){e.preventDefault();vscode.postMessage({type:'focusMainView'});return;}"), 'Webview key handling must route lazygit focusMainView to the right/main preview instead of overloading Enter');
assert(extension.includes("else if (panel === 'commits') {\n      if (this.commitFilesFor)"), 'Commits panel must distinguish commit list vs commit-files subview');
assert(extension.includes('if (c) await showCommitPreview(c, this.lazygitGit, preserveFocus);'), 'Commit navigation must render a rich semantic stat+patch preview for the selected commit, not a raw git show text buffer');
assert(extension.includes("await this.openCurrent('commits', true);"), 'Commit Enter must push into commit files and immediately preview the first file diff');
assert(extension.includes('previewCommitFileDiff(this.commitFilesFor, f, preserveFocus)'), 'Moving through files inside a commit must use the same VS Code diff-editor preview UX as Files panel, not a passive text patch');
assert(extension.includes('previewStashFileDiff(this.stashFilesFor, f, preserveFocus)'), 'Moving through files inside a stash must use the same VS Code diff-editor preview UX as Files panel, not a stale preview or text patch');
assert(extension.includes("if (f && this.stashFilesFor) await previewStashFileDiff(this.stashFilesFor, f, false);"), 'Enter on a stash file must focus the VS Code diff editor instead of opening a passive text patch');
assert(extension.includes("await this.openCurrent('stash', true);"), 'Entering stash files must immediately preview the first file diff, like commit-files');
assert(extension.includes("if (viewPanel === 'stash' && this.stashFilesFor) { this.stashFilesFor = undefined; this.stashFileItems = []; this.stashFileSelected = 0; this.renderAll(); await this.openCurrent('stash', true).catch(() => undefined); return; }"), 'Esc/Back from stash files must return to stash list and restore selected stash patch preview');
assert(!extension.includes("showText(`LazyGitVS ${this.stashFilesFor.ref}:${f.path}`"), 'Stash-file navigation must not regress to readonly text patch buffers');
assert(!gitService.includes("rest.join(' → ')"), 'Stash files must not collapse rename columns into a display-only path');
assert(!extension.includes("showText(`LazyGitVS ${this.commitFilesFor.hash}:${f.path}`"), 'Commit-file navigation must not regress to readonly text patch buffers');
assert(extension.includes("if (f) return this.enterCommitFileHunkMode(f);"), 'Commit-file Enter must open the selected commit file in HUNK/LINE mode, not just a passive patch preview');
assert(extension.includes('private async enterCommitFileHunkMode(file: CommitFile)'), 'Commit file HUNK/LINE mode must have an explicit read-only entry path');
assert(extension.includes("this.allHunks = parseDiffHunks(patch, false);"), 'Commit file HUNK/LINE mode must parse hunks from the selected commit-file patch');
assert(extension.includes('this.readOnlyHunkMode = true;'), 'Commit file HUNK/LINE mode must be read-only: no stage/unstage mutations on historical commits');
assert(extension.includes("if (this.readOnlyHunkMode) { this.statusLine = 'Commit diff is read-only: j/k move · a line · Esc back';"), 'Read-only commit hunk mode must block stage/unstage toggles');
assert(extension.includes("if (this.readOnlyHunkMode && this.commitFilesFor) { this.activePanel = 'commits';"), 'Esc from read-only commit-file HUNK mode must return to the commit-files subview, not jump to Files');
assert(extension.includes("await this.revealPanelView('commits');"), 'Commit-file HUNK mode Esc should restore Commits webview focus for commit-file navigation parity');
assert(extension.includes("if (viewPanel === 'commits' && this.commitFilesFor) { this.commitFilesFor = undefined; this.commitFileItems = []; this.commitFileSelected = 0; this.renderAll(); await this.openCurrent('commits', true).catch(() => undefined); return; }"), 'Esc/Back from commit files must return to commits and restore selected commit patch preview');
assert(extension.includes("if(e.key==='Backspace'){e.preventDefault();vscode.postMessage({type:'clearFilter'});return;}"), 'Backspace must clear filters or return from commit files');
assert(extension.includes("if(hit(e,u.return)){e.preventDefault();vscode.postMessage({type:'back'});return;}"), 'Esc must honor lazygit universal.return and return from commit files to the commit list when the LGVS webview owns focus');
assert(dogfoodUi.includes("branches-enter-shows-selected-branch-commits"), 'Dogfood must exercise Branches Enter -> branch-scoped commits');
assert(dogfoodUi.includes("commit-file-enter-readonly-hunk-mode"), 'Dogfood must exercise commit-file Enter -> read-only HUNK/LINE mode');
assert(dogfoodUi.includes("commit-file-escape-returns-to-files-subview"), 'Dogfood must exercise Esc from read-only commit-file HUNK/LINE mode back to commit-files subview');
assert(parityAudit.includes('Story 5 Enter re-audit'), 'Parity audit must record the Story 5 upstream lazygit Enter re-audit source notes');
assert(parityGapReport.includes('Branches `<enter>` views commits for the selected branch; re-audited against lazygit keybinding docs/source extract') && !parityGapReport.includes('Branches` `<enter>` semantics are suspect') && !parityGapReport.includes('commit-file `<enter>` should feel like'), 'Parity gap report must clear the stale Enter suspect notes and document the VS Code-native commit-file difference');

assert(extension.includes('private cherryPickCommitHashes: string[] = [];'), 'Commit C must copy commits into a cherry-pick buffer, not cherry-pick immediately');
assert(extension.includes("label: '$(copy) Copy commit for cherry-pick'"), 'Commit C label must reflect lazygit copy-for-later semantics');
assert(extension.includes('this.cherryPickCommitHashes = [c.hash];'), 'Commit C must store the selected commit hash for later paste');
assert(extension.includes("key(k.pasteCommits) || 'V'"), 'Commit V must paste/cherry-pick previously copied commits');
assert(!extension.includes("{ key: key(k.cherryPickCopy) || 'C', label: '$(copy) Cherry-pick commit', description: c.hash, args: ['cherry-pick', c.hash] }"), 'Commit C must not directly run git cherry-pick; that is fake lazygit parity');

assert(extension.includes('private branchSortMode'), 'Branches need a real sort mode for lazygit branch sortOrder, not a missing key');
assert(extension.includes('private async branchSortMenu()'), 'Branch sortOrder should open a sort menu instead of being unimplemented');
assert(extension.includes('private async toggleFileTree()'), 'Files - should toggle the file tree display instead of being unimplemented');
assert(extension.includes('private async fileSortMenu()'), 'Files = should expose a sort menu instead of leaving tree/sort parity missing');

function sh(command, cwd, input) {
  return cp.execFileSync(command[0], command.slice(1), { cwd, input, encoding: 'utf8', stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
}
function git(cwd, ...args) { return sh(['git', ...args], cwd); }
function withRepo(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lgvs-${name}-`));
  try {
    git(dir, 'init');
    git(dir, 'config', 'user.email', 'lgvs@example.test');
    git(dir, 'config', 'user.name', 'LazyGitVS Test');
    fn(dir);
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stderr || error.stdout || error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withRepo('branch log preview command matches lazygit default shape', dir => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');
  git(dir, 'checkout', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  git(dir, 'commit', '-am', 'feature change');
  const out = git(dir, 'log', '--graph', '--abbrev-commit', '--decorate', '--date=relative', '--pretty=medium', 'feature', '--');
  assert.match(out, /feature change/);
  assert.match(out, /commit /);
});

withRepo('commit Enter workflow can list files then render selected file patch', dir => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  git(dir, 'commit', '-am', 'second');
  const hash = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  const files = git(dir, 'diff-tree', '--no-commit-id', '--name-status', '-r', hash);
  assert.match(files, /^M\ta.txt/m);
  const patch = git(dir, 'show', '--stat', '--patch', hash, '--', 'a.txt');
  assert.match(patch, /second/);
  assert.match(patch, /-one/);
  assert.match(patch, /\+two/);
});

withRepo('stash Enter workflow can list files and preserve rename paths for diff preview', dir => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'base');
  git(dir, 'mv', 'a.txt', 'b.txt');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'one\ntwo\n');
  git(dir, 'stash', 'push', '-m', 'rename stash');
  const files = git(dir, 'stash', 'show', '--name-status', '--find-renames', 'stash@{0}');
  assert.match(files, /^R\d*\ta.txt\tb.txt/m);
  const parts = files.trim().split('\t');
  assert.strictEqual(parts[1], 'a.txt');
  assert.strictEqual(parts[2], 'b.txt');
});

console.log('branchCommitWorkflow tests passed');
