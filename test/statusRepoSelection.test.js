const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const lazygitConfig = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');

assert(lazygitConfig.includes("recentRepos: '<enter>'") || extension.includes("key: '<enter>', label: '$(repo) Switch to workspace repository'"), 'Status repo switching must preserve lazygit Status recentRepos=<enter> behavior');
assert(extension.includes('async function discoverWorkspaceRepositories(): Promise<WorkspaceRepository[]>'), 'LGVS must discover available Git repositories inside the VS Code workspace');
assert(extension.includes("repoRootFor(folder.uri.fsPath)"), 'Workspace folder Git roots must be included in the Status repository selector');
assert(extension.includes("findFiles('**/.git/HEAD'"), 'Nested workspace repositories must be discovered without shelling out through find/grep');
assert(extension.includes("if (panel === 'status') return this.recentReposMenu();"), 'Enter on 1 Status must open the repository selector, matching lazygit original recent repos behavior');
assert(extension.includes("if(panel==='status'&&hit(e,u.goInto)){e.preventDefault();vscode.postMessage({type:'repoMenu'});return;}"), 'Webview Status Enter must route directly to repoMenu, not the generic Status options menu');
assert(extension.includes("title: 'Recent repositories'"), 'Repository selector title should mirror lazygit original wording');
assert(extension.includes("if (!activeWorkspaceRoot || !roots.has(activeWorkspaceRoot)) activeWorkspaceRoot = roots.keys().next().value"), 'Active repo must reset when the workspace repo set changes, not cling to a stale previous root');
assert(extension.includes('activeWorkspaceRoot = picked.repo.path'), 'Selecting a repository must switch the active Git root used by LGVS commands');
assert(extension.indexOf('this.workspaceRepos = await discoverWorkspaceRepositories().catch(() => []);') < extension.indexOf('this.files = await changedFiles(this.lazygitGit);'), 'Refresh must discover workspace repos before Git status so nested/non-root repos can become the active root');
assert(extension.includes("row(false, 'current', 'repo', repo, workspaceRoot())"), '1 Status must show the active repository so click/Enter target is obvious');

console.log('statusRepoSelection tests passed');
