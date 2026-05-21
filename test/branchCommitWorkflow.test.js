const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const lazygitConfig = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');

assert(extension.includes("else if (panel === 'branches') { const b = this.currentBranch(); if (b) await showText(`LazyGitVS Branch ${b.name}`, await git(branchLogArgs(this.lazygitGit, b.name)), preserveFocus, preserveFocus); }"), 'Branches navigation must render the selected branch log in the right/main pane, like lazygit localBranches GetOnRenderToMain');
assert(extension.includes("if (panel === 'branches') { this.statusLine = 'Branches: Enter is unused in lazygit; Space checks out, 0 focuses the log.'; this.renderAll(); return; }"), 'Branches Enter must do nothing useful: lazygit does not enter branch commits from Branches; Space checks out and 0 focuses the log');
assert(lazygitConfig.includes("focusMainView: '0'"), 'LazyGitVS must preserve lazygit universal.focusMainView=0 for focusing the right/main preview pane');
assert(extension.includes("if(hit(e,u.focusMainView)){e.preventDefault();vscode.postMessage({type:'focusMainView'});return;}"), 'Webview key handling must route lazygit focusMainView to the right/main preview instead of overloading Enter');
assert(extension.includes("else if (panel === 'commits') {\n      if (this.commitFilesFor)"), 'Commits panel must distinguish commit list vs commit-files subview');
assert(extension.includes("await git(this.showArgs('--stat', '--patch', c.hash))"), 'Commit navigation must render git show --stat --patch for the selected commit, like lazygit Patch main pane');
assert(extension.includes("await this.openCurrent('commits', true);"), 'Commit Enter must push into commit files and immediately preview the first file diff');
assert(extension.includes("await git(this.showArgs('--patch', '--stat', this.commitFilesFor.hash, '--', f.path))"), 'Commit-file navigation/Enter must render that file patch, not reopen a generic commit menu');
assert(extension.includes("if (viewPanel === 'commits' && this.commitFilesFor) { this.commitFilesFor = undefined; this.commitFileItems = []; this.commitFileSelected = 0; this.renderAll(); await this.openCurrent('commits', true).catch(() => undefined); return; }"), 'Esc/Back from commit files must return to commits and restore selected commit patch preview');
assert(extension.includes("if(e.key==='Backspace'){e.preventDefault();vscode.postMessage({type:'clearFilter'});return;}"), 'Backspace must clear filters or return from commit files without stealing Escape from VSCodeVim/editor modes');
assert(!extension.includes('hit(e,u.return)'), 'Sidebar must not bind Escape; LGVS uses Backspace for commit-files back because Escape is reserved for editor HUNK mode');

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

console.log('branchCommitWorkflow tests passed');
