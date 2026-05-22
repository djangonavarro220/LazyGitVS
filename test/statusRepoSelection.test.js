const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const lazygitConfig = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');
const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

assert(lazygitConfig.includes("recentRepos: '<enter>'") || extension.includes("key: '<enter>', label: '$(repo) Switch to workspace repository'"), 'Status repo switching must preserve lazygit Status recentRepos=<enter> behavior');
assert(extension.includes('async function discoverWorkspaceRepositories(): Promise<WorkspaceRepository[]>'), 'LGVS must discover available Git repositories inside the VS Code workspace');
assert(extension.includes("repoRootFor(folder.uri.fsPath)"), 'Workspace folder Git roots must be included in the Status repository selector');
assert(extension.includes("findFiles('**/.git/HEAD'"), 'Nested workspace repositories must be discovered without shelling out through find/grep');
assert(extension.includes("if (panel === 'status') return this.recentReposMenu();"), 'Enter on 1 Status must open the repository selector, matching lazygit original recent repos behavior');
assert(extension.includes('class StatusTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>'), '1 Status should use a native compact TreeView instead of a tall webview');
assert(extension.includes("vscode.window.createTreeView(VIEW_IDS.status, { treeDataProvider: statusProvider })"), '1 Status must be registered as a native TreeView');
assert(!extension.includes("registerWebviewViewProvider(VIEW_IDS.status"), '1 Status must not be registered as a webview; webviews keep too much empty vertical space');
assert(pkg.includes('"when": "lazygitvs.statusViewVisible"'), '1 Status should be hidden when inactive so it does not reserve a huge empty SCM pane');
assert(extension.includes("setContext', 'lazygitvs.statusViewVisible', viewPanel === 'status'"), 'Status view visibility must track active panel');
assert(extension.includes("item.command = { command: 'lazygitvs.statusRecentRepos', title: 'Switch to workspace repository' };"), 'Status row Enter/click must open the recent repository selector');
assert(extension.includes("title: 'Recent repositories'"), 'Repository selector title should mirror lazygit original wording');
assert(extension.includes("if (!activeWorkspaceRoot || !roots.has(activeWorkspaceRoot)) activeWorkspaceRoot = roots.keys().next().value"), 'Active repo must reset when the workspace repo set changes, not cling to a stale previous root');
assert(extension.includes('activeWorkspaceRoot = picked.repo.path'), 'Selecting a repository must switch the active Git root used by LGVS commands');
assert(extension.indexOf('this.workspaceRepos = await discoverWorkspaceRepositories().catch(() => []);') < extension.indexOf('this.files = await changedFiles(this.lazygitGit);'), 'Refresh must discover workspace repos before Git status so nested/non-root repos can become the active root');
assert(extension.includes("const item = new vscode.TreeItem('enter', vscode.TreeItemCollapsibleState.None);"), '1 Status must remain one compact row: enter + repo name');
assert(extension.includes('item.description = path.basename(workspaceRoot());'), '1 Status must show the current repo name as compact row description');
assert(!extension.includes('<div class="lg-logo">lazygit</div>'), '1 Status must not render a large dashboard/logo in the sidebar');
assert(!extension.includes('All branches log'), '1 Status sidebar must not advertise a/A all-branches actions; lazygit original does not show those on-screen in Status');
assert(!extension.includes("row(false, staged ? 'staged' : '', 'staged', String(staged))"), '1 Status must not show invented staged/changed/new metrics');
assert(!extension.includes("row(false, '', 'gui'"), '1 Status must not dump internal gui config rows');

console.log('statusRepoSelection tests passed');
