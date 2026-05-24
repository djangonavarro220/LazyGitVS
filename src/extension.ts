import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { cloneGitConfig, cloneGuiConfig, cloneKeymap, readLazyGitConfig } from './lazygitConfig';
import { decorateMenuItems, findMenuItemByKey } from './lazygitMenu';
import { assertPatchableHunk, hunkBodyLines, hunkChangedEditorLine, hunkSelectableLineIndexes, hunkStartLine, parseDiffHunks, singleLinePatch, type Hunk } from './hunkPatch';

type ChangedFile = { xy: string; path: string; staged: boolean; untracked: boolean };
type LazyGitGitRuntimeConfig = ReturnType<typeof cloneGitConfig>;
type Branch = { name: string; label: string; current: boolean; kind: 'local' | 'remote' | 'tag' | 'worktree'; upstream: string };
type Tag = { name: string; date: string; subject: string };
type Remote = { name: string; fetchUrl: string; pushUrl: string };
type Commit = { hash: string; subject: string; refs: string };
type CommitFile = { status: string; path: string; oldPath?: string };
type Stash = { ref: string; message: string };
type StashFile = { status: string; path: string };
type ConflictFile = { xy: string; path: string };
type WorkspaceRepository = { path: string; name: string; branch: string; workspaceFolder: string };
type Panel = 'status' | 'files' | 'hunks' | 'branches' | 'commits' | 'stash' | 'conflicts' | 'tags' | 'remotes';
type ViewPanel = Exclude<Panel, 'hunks'>;
type FocusArea = 'panel' | 'viewer' | 'editor-hunk' | 'editor-edit' | 'none';

const REFRESH_INTERVAL_MS = 10_000;
const STATE_KEY = 'lazygitvs.navigationState';
const VIEW_IDS: Record<ViewPanel, string> = {
  status: 'lazygitvs.statusView',
  files: 'lazygitvs.filesView',
  branches: 'lazygitvs.branchesView',
  tags: 'lazygitvs.tagsView',
  remotes: 'lazygitvs.remotesView',
  commits: 'lazygitvs.commitsView',
  stash: 'lazygitvs.stashView',
  conflicts: 'lazygitvs.conflictsView'
};
const PANEL_ORDER: ViewPanel[] = ['status', 'files', 'branches', 'commits', 'stash', 'conflicts', 'tags', 'remotes'];
let activeWorkspaceRoot: string | undefined;
function gutterBadge(letter: 'S' | 'U', fill: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" rx="3" fill="${fill}"/><text x="8" y="11.5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="10" font-weight="700" fill="#ffffff">${letter}</text></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}
function isViewPanel(value: unknown): value is ViewPanel { return value === 'status' || value === 'files' || value === 'branches' || value === 'commits' || value === 'stash' || value === 'conflicts' || value === 'tags' || value === 'remotes'; }
function isPanel(value: unknown): value is Panel { return isViewPanel(value) || value === 'hunks'; }

function workspaceRoot(): string {
  if (activeWorkspaceRoot) return activeWorkspaceRoot;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Open a Git workspace first.');
  return folder.uri.fsPath;
}
function git(args: string[], cwd = workspaceRoot()): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim())); else resolve(stdout);
    });
  });
}
function gitInput(args: string[], input: string, cwd = workspaceRoot()): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim())); else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}

function gitMaybe(args: string[], cwd: string): Promise<string> {
  return new Promise(resolve => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }, (_err, stdout) => resolve(String(stdout ?? '')));
  });
}
async function repoRootFor(folderPath: string): Promise<string | undefined> {
  const root = (await gitMaybe(['rev-parse', '--show-toplevel'], folderPath)).trim();
  return root || undefined;
}
async function currentBranchForRepo(repoPath: string): Promise<string> {
  const branch = (await gitMaybe(['branch', '--show-current'], repoPath)).trim();
  if (branch) return branch;
  const hash = (await gitMaybe(['rev-parse', '--short', 'HEAD'], repoPath)).trim();
  return hash || '(detached)';
}
async function discoverWorkspaceRepositories(): Promise<WorkspaceRepository[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const roots = new Map<string, string>();
  for (const folder of folders) {
    const root = await repoRootFor(folder.uri.fsPath).catch(() => undefined);
    if (root) roots.set(root, folder.name);
  }
  let gitDirs: vscode.Uri[] = [];
  try { gitDirs = await vscode.workspace.findFiles('**/.git/HEAD', '**/{node_modules,.vscode-test,out,dist,dogfood-output}/**', 80); } catch { gitDirs = []; }
  for (const uri of gitDirs) {
    const candidate = path.dirname(path.dirname(uri.fsPath));
    const root = await repoRootFor(candidate).catch(() => undefined);
    if (root) roots.set(root, vscode.workspace.getWorkspaceFolder(uri)?.name ?? path.basename(root));
  }
  if (!activeWorkspaceRoot || !roots.has(activeWorkspaceRoot)) activeWorkspaceRoot = roots.keys().next().value;
  const repos = await Promise.all(Array.from(roots.entries()).map(async ([repoPath, workspaceFolder]) => ({
    path: repoPath,
    name: path.basename(repoPath),
    branch: await currentBranchForRepo(repoPath),
    workspaceFolder
  })));
  return repos.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

async function changedFiles(gitConfig: LazyGitGitRuntimeConfig = cloneGitConfig()): Promise<ChangedFile[]> {
  const renameThreshold = Number(gitConfig.renameSimilarityThreshold);
  const renameArg = Number.isInteger(renameThreshold) && renameThreshold >= 0 && renameThreshold <= 100 ? `--find-renames=${renameThreshold}%` : '--find-renames=50%';
  const out = await git(['status', '--untracked-files=all', '--porcelain', '-z', renameArg]);
  const parts = out.split('\0').filter(Boolean);
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 3) continue;
    const xy = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++;
    files.push({ xy, path: filePath, staged: xy[0] !== ' ' && xy[0] !== '?', untracked: xy === '??' });
  }
  return files;
}
async function branches(): Promise<Branch[]> {
  const out = await git(['branch', '--all', '--format=%(HEAD)%09%(refname:short)%09%(upstream:short)']);
  const items: Branch[] = out.split('\n').filter(Boolean).map(line => {
    const [head, raw, upstream = ''] = line.split('\t');
    const kind = raw.startsWith('remotes/') ? 'remote' : 'local';
    const name = kind === 'remote' ? raw.replace(/^remotes\//, '') : raw;
    return { name, label: name, current: head.trim() === '*', kind, upstream };
  });
  const worktrees = await git(['worktree', 'list', '--porcelain']).catch(() => '');
  for (const line of worktrees.split('\n')) if (line.startsWith('branch ')) { const name = line.slice(7).replace(/^refs\/heads\//, ''); if (!items.some(b => b.kind === 'worktree' && b.name === name)) items.push({ name, label: name, current: false, kind: 'worktree', upstream: '' }); }
  return items.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    const kindRank = (branch: Branch) => branch.kind === 'local' ? 0 : branch.kind === 'worktree' ? 1 : 2;
    return kindRank(a) - kindRank(b) || a.label.localeCompare(b.label);
  });
}
async function tags(): Promise<Tag[]> {
  const out = await git(['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:short)%09%(subject)', 'refs/tags']);
  return out.split('\n').filter(Boolean).map(line => {
    const [name, date = '', ...subject] = line.split('\t');
    return { name, date, subject: subject.join('\t') };
  });
}
async function remotes(): Promise<Remote[]> {
  const out = await git(['remote', '-v']);
  const map = new Map<string, Remote>();
  for (const line of out.split('\n').filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, kind] = match;
    const item = map.get(name) ?? { name, fetchUrl: '', pushUrl: '' };
    if (kind === 'fetch') item.fetchUrl = url; else item.pushUrl = url;
    map.set(name, item);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}
async function commits(): Promise<Commit[]> {
  const out = await git(['log', '--decorate=short', '--max-count=80', '--pretty=format:%h%x09%D%x09%s']);
  return out.split('\n').filter(Boolean).map(line => {
    const [hash, refs, ...subject] = line.split('\t');
    return { hash, refs, subject: subject.join('\t') };
  });
}
function compactRefs(refs: string): string {
  if (!refs) return '';
  const parts = refs.split(',').map(ref => ref.trim().replace(/^HEAD -> /, '').replace(/^tag: /, '🏷 ')).filter(Boolean);
  const head = parts.find(ref => ref === 'HEAD') ?? parts.find(ref => !ref.includes('/')) ?? parts[0];
  return head ?? '';
}
async function stashes(): Promise<Stash[]> {
  const out = await git(['stash', 'list', '--pretty=format:%gd%x09%s']);
  return out.split('\n').filter(Boolean).map(line => { const [ref, ...msg] = line.split('\t'); return { ref, message: msg.join('\t') }; });
}
async function commitFiles(hash: string): Promise<CommitFile[]> {
  const out = await git(['diff-tree', '--no-commit-id', '--name-status', '-r', hash]);
  return out.split('\n').filter(Boolean).map(line => { const parts = line.split('\t'); return { status: parts[0], oldPath: parts.length > 2 ? parts[1] : undefined, path: parts[parts.length - 1] }; });
}
async function stashFiles(ref: string): Promise<StashFile[]> {
  const out = await git(['stash', 'show', '--name-status', ref]);
  return out.split('\n').filter(Boolean).map(line => { const [status, ...rest] = line.split('\t'); return { status, path: rest.join(' → ') }; });
}
async function conflictFiles(): Promise<ConflictFile[]> {
  return (await changedFiles()).filter(f => f.xy.includes('U') || ['AA', 'DD'].includes(f.xy)).map(f => ({ xy: f.xy, path: f.path }));
}

function shellWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | undefined;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === 'single') { if (ch === "'") quote = undefined; else current += ch; continue; }
    if (quote === 'double') { if (ch === '"') quote = undefined; else if (ch === '\\' && i + 1 < command.length) current += command[++i]; else current += ch; continue; }
    if (ch === "'") { quote = 'single'; continue; }
    if (ch === '"') { quote = 'double'; continue; }
    if (/\s/.test(ch)) { if (current) { words.push(current); current = ''; } continue; }
    if (ch === '\\' && i + 1 < command.length) current += command[++i]; else current += ch;
  }
  if (current) words.push(current);
  return words;
}
function branchLogArgs(gitConfig: LazyGitGitRuntimeConfig, branchName: string): string[] {
  const template = typeof gitConfig.branchLogCmd === 'string' && gitConfig.branchLogCmd.trim()
    ? gitConfig.branchLogCmd
    : cloneGitConfig().branchLogCmd;
  const argv = shellWords(template.replace(/{{\s*branchName\s*}}/g, branchName));
  return argv[0] === 'git' ? argv.slice(1) : argv;
}

async function previewDiff(file: ChangedFile | ConflictFile, preserveFocus = true) {
  const root = workspaceRoot();
  const right = vscode.Uri.file(path.join(root, file.path));
  const untracked = 'untracked' in file && file.untracked;
  const left = untracked ? vscode.Uri.parse(`lazygitvs-empty:${encodeURIComponent(file.path)}`) : right.with({ scheme: 'git', query: JSON.stringify({ path: right.fsPath, ref: 'HEAD' }) });
  await vscode.commands.executeCommand('vscode.diff', left, right, `LazyGitVS: ${file.path}`, { preview: preserveFocus, preserveFocus, viewColumn: vscode.ViewColumn.Active });
}
function revealVisibleEditorLine(filePath: string, line: number) {
  const target = path.join(workspaceRoot(), filePath);
  const reveal = () => {
    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === target);
    if (!editor) return false;
    const clamped = Math.min(Math.max(0, line), Math.max(0, editor.document.lineCount - 1));
    const pos = new vscode.Position(clamped, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return true;
  };
  if (!reveal()) setTimeout(reveal, 80);
}
async function toggleStage(file: ChangedFile) { if (file.staged) { if (file.xy[0] === 'A') await git(['rm', '--cached', '--', file.path]); else await git(['restore', '--staged', '--', file.path]); } else await git(['add', '--', file.path]); }
async function toggleStageAll(files: ChangedFile[]) { if (files.some(f => f.untracked || f.xy[1] !== ' ')) await git(['add', '-A']); else await git(['restore', '--staged', '.']); }
async function editPath(filePath: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspaceRoot(), filePath)));
  return vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
}
async function openPath(filePath: string) { await vscode.env.openExternal(vscode.Uri.file(path.join(workspaceRoot(), filePath))); }
async function copyText(text: string, label = 'Copied') { await vscode.env.clipboard.writeText(text); vscode.window.showInformationMessage(`LazyGitVS: ${label}.`); }
async function appendIgnore(fileName: '.gitignore' | '.git/info/exclude', pattern: string) {
  const filePath = path.join(workspaceRoot(), fileName);
  const edit = new vscode.WorkspaceEdit();
  let existing = '';
  try { existing = (await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))).toString(); } catch { /* create */ }
  const line = existing.endsWith('\n') || !existing ? pattern + '\n' : '\n' + pattern + '\n';
  edit.insert(vscode.Uri.file(filePath), new vscode.Position(existing.split(/\r?\n/).length, 0), line);
  await vscode.workspace.applyEdit(edit);
}

async function commitFlow(requested?: 'commit' | 'body' | 'amend' | 'amendNoEdit' | 'noVerify') {
  const picked = requested ? { id: requested } : await vscode.window.showQuickPick([
    { label: '$(check) Commit staged changes', id: 'commit' },
    { label: '$(shield) Commit without pre-commit hook', id: 'noVerify' },
    { label: '$(edit) Commit with body', id: 'body' },
    { label: '$(history) Amend last commit', id: 'amend' },
    { label: '$(history) Amend without editing message', id: 'amendNoEdit' }
  ], { title: 'LazyGitVS Commit' });
  if (!picked) return;
  const mode = picked.id;
  if (mode === 'amendNoEdit') { await git(['commit', '--amend', '--no-edit']); return; }
  const subject = await vscode.window.showInputBox({ title: mode === 'amend' ? 'Amend commit' : mode === 'noVerify' ? 'Commit without pre-commit hook' : 'Commit', prompt: 'Subject', placeHolder: 'Commit message', ignoreFocusOut: true, validateInput: v => v.trim() ? undefined : 'Commit message required.' });
  if (!subject?.trim()) return;
  if (mode === 'body') {
    const body = await vscode.window.showInputBox({ title: 'Commit body', prompt: 'Optional body', ignoreFocusOut: true });
    const args = body?.trim() ? ['commit', '-m', subject.trim(), '-m', body.trim()] : ['commit', '-m', subject.trim()];
    await git(args);
  } else if (mode === 'amend') await git(['commit', '--amend', '-m', subject.trim()]);
  else if (mode === 'noVerify') await git(['commit', '--no-verify', '-m', subject.trim()]);
  else await git(['commit', '-m', subject.trim()]);
}

async function hunksForFile(file: ChangedFile, gitConfig: LazyGitGitRuntimeConfig = cloneGitConfig()): Promise<Hunk[]> {
  if (file.untracked) return [];
  const hunks: Hunk[] = [];
  const diffArgs = ['diff', '--unified=0', ...gitDiffConfigArgs(gitConfig, false).filter(arg => !arg.startsWith('--unified=')), '--', file.path];
  const cachedDiffArgs = ['diff', '--cached', '--unified=0', ...gitDiffConfigArgs(gitConfig, false).filter(arg => !arg.startsWith('--unified=')), '--', file.path];
  if (file.xy[1] !== ' ') hunks.push(...parseDiffHunks(await git(diffArgs), false));
  if (file.staged) hunks.push(...parseDiffHunks(await git(cachedDiffArgs), true));
  return hunks;
}
function gitDiffConfigArgs(gitConfig: LazyGitGitRuntimeConfig, includeWhitespace: boolean): string[] {
  const args: string[] = [];
  const context = Number(gitConfig.diffContextSize);
  if (Number.isInteger(context) && context >= 0) args.push(`--unified=${context}`);
  if (includeWhitespace && gitConfig.ignoreWhitespaceInDiffView) args.push('--ignore-all-space');
  return args;
}
function zeroContextPatch(patch: string): boolean {
  const lines = patch.split('\n');
  const headerIndex = lines.findIndex(line => line.startsWith('@@ '));
  if (headerIndex < 0) return false;
  const body = lines.slice(headerIndex + 1).filter(line => line !== '');
  return body.length > 0 && body.every(line => line.startsWith('+') || line.startsWith('-'));
}
function gitApplyArgs(base: string[], patch: string, forceUnidiffZero = false): string[] {
  return forceUnidiffZero || zeroContextPatch(patch) || /\n@@ [^\n]*,0 [^\n]*@@|\n@@ [^\n]* [^\n]*,0 @@|^@@ [^\n]*,0 [^\n]*@@|^@@ [^\n]* [^\n]*,0 @@/.test(patch) ? [...base, '--unidiff-zero'] : base;
}
async function applyHunk(hunk: Hunk) { assertPatchableHunk(hunk, hunk.staged ? 'unstage hunk' : 'stage hunk'); const args = hunk.staged ? ['apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount'] : ['apply', '--cached', '--whitespace=nowarn', '--recount']; await gitInput(gitApplyArgs(args, hunk.patch), hunk.patch); }
async function discardUnstagedHunk(hunk: Hunk) { assertPatchableHunk(hunk, 'discard hunk'); if (hunk.staged) throw new Error('Discard only applies to unstaged hunks.'); const args = ['apply', '--reverse', '--whitespace=nowarn', '--recount']; await gitInput(gitApplyArgs(args, hunk.patch), hunk.patch); }

function editorLineRange(editor: vscode.TextEditor, lineIndex: number): vscode.Range {
  const line = Math.min(Math.max(0, lineIndex), Math.max(0, editor.document.lineCount - 1));
  return new vscode.Range(line, 0, line, editor.document.lineAt(line).range.end.character);
}

function hunkChangedEditorRanges(hunk: Hunk, editor: vscode.TextEditor): vscode.Range[] {
  const changed = hunkSelectableLineIndexes(hunk);
  if (!changed.length) return [editorLineRange(editor, hunkStartLine(hunk))];
  const lines = Array.from(new Set(changed.map(index => hunkChangedEditorLine(hunk, index)))).sort((a, b) => a - b);
  return lines.map(line => editorLineRange(editor, line));
}
function rangeLineSet(ranges: vscode.Range[]): Set<number> {
  return new Set(ranges.map(range => range.start.line));
}
function excludeRangeLines(ranges: vscode.Range[], blocked: Set<number>): vscode.Range[] {
  return blocked.size ? ranges.filter(range => !blocked.has(range.start.line)) : ranges;
}
async function applyLine(hunk: Hunk, changedIndex: number) {
  const linePatch = singleLinePatch(hunk, changedIndex);
  const args = hunk.staged ? ['apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount'] : ['apply', '--cached', '--whitespace=nowarn', '--recount'];
  await gitInput(gitApplyArgs(args, linePatch, true), linePatch);
}
async function discardUnstagedLine(hunk: Hunk, changedIndex: number) {
  const linePatch = singleLinePatch(hunk, changedIndex);
  const args = ['apply', '--reverse', '--whitespace=nowarn', '--recount'];
  await gitInput(gitApplyArgs(args, linePatch, true), linePatch);
}
async function upstreamBranch(): Promise<string | undefined> {
  return git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then(out => out.trim()).catch(() => undefined);
}
async function originCommitUrl(hash: string): Promise<string | undefined> {
  const remote = (await git(['config', '--get', 'remote.origin.url']).catch(() => '')).trim();
  if (!remote) return undefined;
  let base = remote;
  const ssh = base.match(/^git@([^:]+):(.+)$/);
  if (ssh) base = `https://${ssh[1]}/${ssh[2]}`;
  base = base.replace(/\.git$/, '');
  if (!/^https?:\/\//.test(base)) return undefined;
  return `${base}/commit/${encodeURIComponent(hash)}`;
}
async function showCommitResetMenu(commit: Commit) {
  await pickGitAction(`Reset to ${commit.hash}`, [
    { key: 's', label: '$(debug-restart) Soft reset to commit', description: 'keep index and working tree', args: ['reset', '--soft', commit.hash], danger: true, confirm: `Soft reset to ${commit.hash}?` },
    { key: 'm', label: '$(debug-restart) Mixed reset to commit', description: 'keep working tree', args: ['reset', '--mixed', commit.hash], danger: true, confirm: `Mixed reset to ${commit.hash}?` },
    { key: 'h', label: '$(warning) Hard reset to commit', description: 'discard index and working tree', args: ['reset', '--hard', commit.hash], danger: true, confirm: `Hard reset to ${commit.hash}? Not undoable here.` }
  ]);
}
async function showCommitCopyMenu(commit: Commit) {
  await pickGitAction(`Copy commit ${commit.hash}`, [
    { key: 'h', label: '$(copy) Copy hash', description: commit.hash, run: async () => copyText(commit.hash, 'commit hash copied') },
    { key: 's', label: '$(copy) Copy subject', description: commit.subject, run: async () => copyText(commit.subject, 'commit subject copied') },
    { key: 'c', label: '$(copy) Copy hash + subject', description: `${commit.hash} ${commit.subject}`, run: async () => copyText(`${commit.hash} ${commit.subject}`, 'commit copied') }
  ]);
}

type GitMenuItem = vscode.QuickPickItem & { key?: string; args?: string[]; danger?: boolean; confirm?: string; run?: () => Promise<void> };
async function runGitAction(title: string, args: string[]) { await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, async () => git(args)); vscode.window.showInformationMessage(`LazyGitVS: ${title} done.`); }
async function executeGitMenuItem(item: GitMenuItem) {
  if (item.danger || item.confirm) { const ok = await vscode.window.showWarningMessage(item.confirm ?? `Run ${item.label}?`, { modal: true }, 'Run'); if (ok !== 'Run') return false; }
  if (item.run) await item.run(); else if (item.args) await runGitAction(item.label.replace(/^([^ ]+\s+)?\$\([^)]*\)\s*/, '').replace(/^[^ ]+\s+/, ''), item.args);
  return true;
}
async function pickGitAction(title: string, items: GitMenuItem[]) {
  const qp = vscode.window.createQuickPick<GitMenuItem>();
  qp.title = title;
  qp.placeholder = 'type the lazygit key or filter options';
  qp.items = decorateMenuItems(items) as GitMenuItem[];
  return await new Promise<boolean>(resolve => {
    let done = false;
    const finish = async (item?: GitMenuItem) => {
      if (done) return;
      done = true;
      qp.hide();
      if (!item || !('args' in item || 'run' in item)) { resolve(false); return; }
      resolve(await executeGitMenuItem(item));
    };
    qp.onDidChangeValue(value => {
      const item = findMenuItemByKey(items, value);
      if (item) void finish(item);
    });
    qp.onDidAccept(() => void finish(qp.selectedItems[0] ?? qp.activeItems[0]));
    qp.onDidHide(() => { if (!done) { done = true; resolve(false); } qp.dispose(); });
    qp.show();
  });
}
async function showPushMenu() { await pickGitAction('Push options', [
  { key: 'p', label: '$(cloud-upload) Push', description: 'git push', args: ['push'] },
  { key: 'P', label: '$(cloud-upload) Push current branch', description: 'git push origin HEAD', args: ['push', 'origin', 'HEAD'] },
  { key: 't', label: '$(tag) Push tags', description: 'git push --tags', args: ['push', '--tags'] },
  { key: 'f', label: '$(warning) Force push with lease', description: 'git push --force-with-lease', args: ['push', '--force-with-lease'], danger: true, confirm: 'Force push with lease? Safer than --force, still remote-changing.' },
  { key: 'u', label: '$(repo-push) Set upstream and push', description: 'git push -u origin HEAD', args: ['push', '-u', 'origin', 'HEAD'] }
]); }
async function showPullMenu() { await pickGitAction('Pull / fetch options', [
  { key: 'p', label: '$(cloud-download) Pull', description: 'git pull', args: ['pull'] },
  { key: 'r', label: '$(git-compare) Pull --rebase', description: 'git pull --rebase', args: ['pull', '--rebase'] },
  { key: 'f', label: '$(sync) Fetch', description: 'git fetch', args: ['fetch'] },
  { key: 'a', label: '$(sync) Fetch all', description: 'git fetch --all --prune', args: ['fetch', '--all', '--prune'] },
  { key: 'P', label: '$(trash) Prune remotes', description: 'git remote prune origin', args: ['remote', 'prune', 'origin'] }
]); }
async function showStashCreateMenu() { await pickGitAction('Stash options', [
  { key: 'a', label: '$(archive) Stash all changes', description: 'git stash push', args: ['stash', 'push'] },
  { key: 'i', label: '$(archive) Stash all changes and keep index', description: 'git stash push --keep-index', args: ['stash', 'push', '--keep-index'] },
  { key: 'U', label: '$(archive) Stash include untracked changes', description: 'git stash push -u', args: ['stash', 'push', '-u'] },
  { key: 's', label: '$(archive) Stash staged changes', description: 'git stash push --staged', args: ['stash', 'push', '--staged'] },
  { key: 'u', label: '$(archive) Stash unstaged changes', description: 'git stash push --keep-index', args: ['stash', 'push', '--keep-index'] }
]); }
async function showResetMenu(onNuke?: () => void | Promise<void>) {
  const upstream = await upstreamBranch();
  const items: GitMenuItem[] = [
    { key: 's', label: '$(debug-restart) Soft reset to previous commit', description: 'keep index and working tree', args: ['reset', '--soft', 'HEAD~1'], danger: true },
    { key: 'm', label: '$(debug-restart) Mixed reset to previous commit', description: 'keep working tree', args: ['reset', '--mixed', 'HEAD~1'], danger: true },
    { key: 'h', label: '$(warning) Hard reset to HEAD', description: 'discard working tree and index', args: ['reset', '--hard', 'HEAD'], danger: true, confirm: 'Hard reset discards local changes. Do it?' },
  ];
  if (upstream) items.push({ key: 'u', label: '$(repo-pull) Reset to upstream', description: upstream, args: ['reset', '--hard', upstream], danger: true, confirm: `Hard reset current branch to ${upstream}?` });
  items.push({ key: 'n', label: '💣 Nuke working tree', description: 'git reset --hard HEAD && git clean -fd', danger: true, confirm: '💣 Nuke working tree? This discards staged, unstaged and untracked changes. Not undoable.', run: async () => { await onNuke?.(); await git(['reset', '--hard', 'HEAD']); await git(['clean', '-fd']); } });
  await pickGitAction('Reset options', items);
}
async function showDiscardFileMenu(file: ChangedFile, confirmKey = 'x') { await pickGitAction(`Discard changes · ${file.path}`, [
  { key: confirmKey, label: '$(warning) Discard all changes', description: 'unstage and restore file', danger: true, confirm: `Discard all staged and unstaged changes in ${file.path}?`, run: async () => { await git(['restore', '--staged', '--', file.path]); await git(['restore', '--', file.path]); } },
  { key: 'u', label: '$(discard) Discard unstaged changes', description: 'git restore -- file', args: ['restore', '--', file.path], danger: true, confirm: `Discard unstaged changes in ${file.path}?` }
]); }
async function showDiscardHunkMenu(hunk: Hunk) { await pickGitAction('Hunk options', hunk.staged ? [
  { key: 'd', label: '$(remove) Unstage hunk', description: 'git apply --cached --reverse', run: () => applyHunk(hunk) }
] : [
  { key: 'd', label: '$(discard) Discard hunk', description: 'git apply --reverse', danger: true, confirm: 'Discard this unstaged hunk from the working tree?', run: () => discardUnstagedHunk(hunk) },
  { key: '<space>', label: '$(add) Stage hunk', description: 'git apply --cached', run: () => applyHunk(hunk) }
]); }

function statusIcon(f: ChangedFile | ConflictFile): string { return f.xy; }
function statusClass(f: ChangedFile): string { if (f.untracked) return 'untracked'; if (f.staged && f.xy[1] !== ' ') return 'mixed'; if (f.staged) return 'staged'; return 'unstaged'; }
function statusKind(ch: string): string { return ch === 'M' ? 'modified' : ch === 'A' ? 'added' : ch === 'D' ? 'deleted' : ch === 'R' ? 'renamed' : ch === 'C' ? 'copied' : ch === 'U' ? 'conflict' : ch === '?' ? 'untracked' : 'clean'; }
function fileStateLabel(f: ChangedFile): string { if (f.untracked) return 'untracked'; if (f.staged && f.xy[1] !== ' ') return 'staged + unstaged'; if (f.staged) return 'staged'; return 'unstaged'; }
function fileStatusHtml(f: ChangedFile): string {
  const [index, worktree] = [f.xy[0] ?? ' ', f.xy[1] ?? ' '];
  const slot = (kind: 'index' | 'worktree', ch: string) => ch === ' '
    ? `<span class="slot empty ${kind}" aria-hidden="true"></span>`
    : `<span class="slot ${kind} ${statusKind(ch)}" title="${kind === 'index' ? 'index/staged' : 'worktree/unstaged'}: ${escapeHtml(ch)}">${escapeHtml(ch)}</span>`;
  return `<span class="status-pair" title="${escapeHtml(f.xy)} · ${escapeHtml(fileStateLabel(f))}">${slot('index', index)}${slot('worktree', worktree)}</span>`;
}
async function showChangedFilesQuickPick() {
  const files = await changedFiles();
  if (!files.length) return vscode.window.showInformationMessage('LazyGitVS: clean working tree.');
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { file: ChangedFile }>();
  qp.title = 'LazyGitVS Changed Files'; qp.placeholder = 'Move to preview diff. Enter opens diff. Use dashboard for space stage/unstage.';
  qp.items = files.map(file => ({ label: `${statusIcon(file)} ${file.path}`, description: file.staged ? 'staged' : 'unstaged', file }));
  qp.onDidChangeActive(items => { if (items[0]) previewDiff(items[0].file, true).catch(err => vscode.window.showErrorMessage(err.message)); });
  qp.onDidAccept(() => { const item = qp.activeItems[0]; if (item) previewDiff(item.file, false); qp.hide(); });
  qp.onDidHide(() => qp.dispose()); qp.show();
}
class EmptyProvider implements vscode.TextDocumentContentProvider { provideTextDocumentContent(): string { return ''; } }
class VirtualPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  set(title: string, content: string): vscode.Uri {
    const cleanTitle = title.replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, ' ').replace(/\s+/g, ' ').trim() || 'LazyGitVS Preview';
    const fileName = `${cleanTitle.slice(0, 120)}.diff`;
    const key = Buffer.from(title).toString('base64url');
    this.contents.set(key, content);
    const uri = vscode.Uri.from({ scheme: 'lazygitvs-preview', path: `/${fileName}`, query: key });
    this.emitter.fire(uri);
    return uri;
  }
  provideTextDocumentContent(uri: vscode.Uri): string { return this.contents.get(uri.query) ?? ''; }
}
const virtualPreviewProvider = new VirtualPreviewProvider();

class PanelViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly app: LazyGitVSController, private readonly panel: ViewPanel) {}
  resolveWebviewView(view: vscode.WebviewView) { this.app.attach(this.panel, view); }
}

class StatusTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onChange.event;

  constructor(private readonly app: LazyGitVSController) {}

  refresh() { this.onChange.fire(); }
  dispose() { this.onChange.dispose(); }
  getTreeItem(item: vscode.TreeItem) { return item; }
  getChildren() { return this.app.statusTreeItems(); }
}

class LazyGitVSController {
  private views = new Map<ViewPanel, vscode.WebviewView>();
  private statusTree?: vscode.TreeView<vscode.TreeItem>;
  private statusTreeProvider?: StatusTreeProvider;
  private files: ChangedFile[] = [];
  private allHunks: Hunk[] = [];
  private hunks: Hunk[] = [];
  private branchItems: Branch[] = [];
  private tagItems: Tag[] = [];
  private remoteItems: Remote[] = [];
  private workspaceRepos: WorkspaceRepository[] = [];
  private commitItems: Commit[] = [];
  private commitFileItems: CommitFile[] = [];
  private commitFilesFor: Commit | undefined;
  private stashItems: Stash[] = [];
  private stashFileItems: StashFile[] = [];
  private stashFilesFor: Stash | undefined;
  private conflictItems: ConflictFile[] = [];
  private selected = 0;
  private fileRangeAnchor: number | undefined;
  private fileRangeSelected = new Set<number>();
  private hunkSelected = 0;
  private branchSelected = 0;
  private tagSelected = 0;
  private remoteSelected = 0;
  private commitSelected = 0;
  private stashSelected = 0;
  private commitFileSelected = 0;
  private stashFileSelected = 0;
  private conflictSelected = 0;
  private filterText = '';
  private fileStatusFilter: 'all' | 'staged' | 'unstaged' | 'tracked' | 'untracked' = 'all';
  private activePanel: Panel = 'files';
  private previousPanel: Panel = 'files';
  private hunkSide: 'unstaged' | 'staged' = 'unstaged';
  private hunkSelectionMode: 'hunk' | 'line' = 'hunk';
  private hunkLineSelected = 0;
  private ownsModeStatus = false;
  private focusArea: FocusArea = 'none';
  private editorHunkMode = false;
  private editorEditMode = false;
  private readOnlyHunkMode = false;
  private editorModeFilePath: string | undefined;
  private refreshTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  private vscodeVimPresent = false;
  private refreshInFlight = false;
  private refreshPending = false;
  private selectionEpoch = 0;
  private explosion = false;
  private statusLine = '';
  private readonly unstagedHunkDecoration: vscode.TextEditorDecorationType;
  private readonly stagedHunkDecoration: vscode.TextEditorDecorationType;
  private readonly activeUnstagedHunkDecoration: vscode.TextEditorDecorationType;
  private readonly activeStagedHunkDecoration: vscode.TextEditorDecorationType;
  private readonly activeUnstagedLineDecoration: vscode.TextEditorDecorationType;
  private readonly activeStagedLineDecoration: vscode.TextEditorDecorationType;
  private readonly unstagedGutterDecoration: vscode.TextEditorDecorationType;
  private readonly stagedGutterDecoration: vscode.TextEditorDecorationType;
  private readonly modeStatusBarItem: vscode.StatusBarItem;
  private lazygitKeymap = cloneKeymap();
  private lazygitGui = cloneGuiConfig();
  private lazygitGit = cloneGitConfig();
  private lazygitConfigFiles: string[] = [];
  private suppressWebviewAutoFocusUntil = 0;
  private defaultPanelsRevealed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.unstagedHunkDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(210, 153, 34, 0.13)', borderWidth: '0 0 0 2px', borderStyle: 'solid', borderColor: '#d29922' });
    this.stagedHunkDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(46, 160, 67, 0.13)', borderWidth: '0 0 0 2px', borderStyle: 'solid', borderColor: '#2ea043' });
    this.activeUnstagedHunkDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(210, 153, 34, 0.22)', overviewRulerColor: '#d29922', overviewRulerLane: vscode.OverviewRulerLane.Right, borderWidth: '1px 1px 1px 4px', borderStyle: 'solid', borderColor: '#d29922' });
    this.activeStagedHunkDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(46, 160, 67, 0.22)', overviewRulerColor: '#2ea043', overviewRulerLane: vscode.OverviewRulerLane.Right, borderWidth: '1px 1px 1px 4px', borderStyle: 'solid', borderColor: '#2ea043' });
    this.activeUnstagedLineDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(210, 153, 34, 0.32)', border: '1px solid #d29922' });
    this.activeStagedLineDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(46, 160, 67, 0.30)', border: '1px solid #2ea043' });
    this.unstagedGutterDecoration = vscode.window.createTextEditorDecorationType({ gutterIconPath: gutterBadge('U', '#d29922'), gutterIconSize: 'contain' });
    this.stagedGutterDecoration = vscode.window.createTextEditorDecorationType({ gutterIconPath: gutterBadge('S', '#2ea043'), gutterIconSize: 'contain' });
    context.subscriptions.push(this.unstagedHunkDecoration, this.stagedHunkDecoration, this.activeUnstagedHunkDecoration, this.activeStagedHunkDecoration, this.activeUnstagedLineDecoration, this.activeStagedLineDecoration, this.unstagedGutterDecoration, this.stagedGutterDecoration);
    this.modeStatusBarItem = vscode.window.createStatusBarItem('primary', vscode.StatusBarAlignment.Left, Number.MIN_SAFE_INTEGER);
    this.modeStatusBarItem.name = 'Vim Command Line';
    context.subscriptions.push(this.modeStatusBarItem);
    this.loadLazyGitConfig();
    this.restoreNavigationState();
    this.updateActiveViewContext();
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    watcher.onDidChange(() => this.scheduleRefresh(), null, context.subscriptions);
    watcher.onDidCreate(() => this.scheduleRefresh(), null, context.subscriptions);
    watcher.onDidDelete(() => this.scheduleRefresh(), null, context.subscriptions);
    context.subscriptions.push(watcher);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('lazygitvs.showStatusBarMode')) this.updateModeStatusBar();
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => this.updateEditorHunkDecorations()));
  }

  private updateActiveViewContext() {
    const viewPanel = this.activeViewPanel();
    void vscode.commands.executeCommand('setContext', 'lazygitvs.activeView', viewPanel);
    void vscode.commands.executeCommand('setContext', 'lazygitvs.statusViewVisible', viewPanel === 'status');
  }

  attach(panel: ViewPanel, view: vscode.WebviewView) {
    this.views.set(panel, view);
    view.webview.options = { enableScripts: true };
    view.onDidChangeVisibility(() => { if (view.visible) this.scheduleRefresh(0); }, null, this.context.subscriptions);
    view.webview.onDidReceiveMessage(async msg => {
      try {
        if (msg.type === 'focusArea') this.setFocusArea(msg.area === 'panel' ? 'panel' : 'none');
        if (msg.type === 'move') await this.move(panel, msg.delta);
        if (msg.type === 'moveTo') await this.moveTo(panel, msg.position);
        if (msg.type === 'rangeToggle') await this.toggleRange(panel);
        if (msg.type === 'rangeMove') await this.rangeMove(panel, msg.delta);
        if (msg.type === 'select') await this.select(panel, Number(msg.index));
        if (msg.type === 'switchPanel') await this.focusPanel(msg.panel);
        if (msg.type === 'toggle') await this.toggle(panel);
        if (msg.type === 'enter') await this.enter(panel);
        if (msg.type === 'openDiff') await this.openCurrent(panel, false);
        if (msg.type === 'openFile') await this.editCurrent(panel);
        if (msg.type === 'editFile') await this.editCurrent(panel);
        if (msg.type === 'copyPath') await this.copyCurrentPath(panel);
        if (msg.type === 'copyInfo') await this.copyCurrentInfo(panel);
        if (msg.type === 'ignoreMenu') await this.ignoreCurrentFile();
        if (msg.type === 'fetch') await this.runMenu(showPullMenu, panel);
        if (msg.type === 'statusMenu') await this.statusMenu();
        if (msg.type === 'repoMenu') await this.recentReposMenu();
        if (msg.type === 'helpMenu') await this.helpMenu(panel);
        if (msg.type === 'commitAction') await this.runCommitCommand(String(msg.key ?? ''));
        if (msg.type === 'panelAction') await this.runPanelCommand(panel, String(msg.key ?? ''));
        if (msg.type === 'moveBlock') await this.moveBlock(panel, msg.delta);
        if (msg.type === 'focusMainView') await this.focusMainView(panel);
        if (msg.type === 'stageAll') await this.stageAll();
        if (msg.type === 'commit') await this.commit();
        if (msg.type === 'commitNoVerify') await this.commit('noVerify');
        if (msg.type === 'amendLastCommit') await this.commit('amendNoEdit');
        if (msg.type === 'commitWithEditor') await this.commit('body');
        if (msg.type === 'pushMenu') await this.runMenu(showPushMenu, panel);
        if (msg.type === 'pullMenu') await this.runMenu(showPullMenu, panel);
        if (msg.type === 'stashAll') await this.stashAll();
        if (msg.type === 'stashMenu') await this.runMenu(showStashCreateMenu, panel);
        if (msg.type === 'discardMenu') await this.discardMenu(panel);
        if (msg.type === 'resetMenu') await this.runMenu(() => showResetMenu(() => this.animateExplosion()), panel);
        if (msg.type === 'search') await this.searchPanel();
        if (msg.type === 'clearFilter') await this.clearFilterOrBack(panel);
        if (msg.type === 'statusFilter') await this.statusFilterMenu();
        if (msg.type === 'refresh') await this.refresh(true);
        if (msg.type === 'close') await this.close();
        if (msg.type === 'back') await this.back(panel);
        if (msg.type === 'togglePanel') await this.toggleHunkPanel();
        if (msg.type === 'toggleHunkSelection') this.showPendingLineMode();
      } catch (e: any) { vscode.window.showErrorMessage(e.message); }
    }, null, this.context.subscriptions);
    if (!this.intervalTimer) {
      this.intervalTimer = setInterval(() => this.scheduleRefresh(0), REFRESH_INTERVAL_MS);
      this.context.subscriptions.push({ dispose: () => { if (this.intervalTimer) clearInterval(this.intervalTimer); } });
    }
    this.render(panel);
    this.refresh(true).catch(err => vscode.window.showErrorMessage(err.message));
  }

  attachStatusTree(provider: StatusTreeProvider, tree: vscode.TreeView<vscode.TreeItem>) {
    this.statusTreeProvider = provider;
    this.statusTree = tree;
    tree.onDidChangeVisibility(() => { if (tree.visible) this.scheduleRefresh(0); }, null, this.context.subscriptions);
    provider.refresh();
  }

  statusTreeItems(): vscode.TreeItem[] {
    const repos = this.workspaceRepos;
    if (!repos.length) {
      const item = new vscode.TreeItem(path.basename(workspaceRoot()), vscode.TreeItemCollapsibleState.None);
      item.tooltip = 'Enter: switch to a workspace repository';
      item.command = { command: 'lazygitvs.statusEnter', title: 'Switch to workspace repository' };
      item.contextValue = 'lazygitvs.statusRepo';
      return [item];
    }
    const current = activeWorkspaceRoot ?? repos[0]?.path;
    return repos.map(repo => {
      const isCurrent = repo.path === current;
      const item = new vscode.TreeItem(repo.name, vscode.TreeItemCollapsibleState.None);
      item.id = repo.path;
      item.description = isCurrent ? `${repo.branch} · current` : repo.branch;
      item.tooltip = repo.path;
      if (isCurrent) item.iconPath = new vscode.ThemeIcon('check');
      item.command = { command: 'lazygitvs.statusEnter', title: 'Select repository', arguments: [repo.path] };
      item.contextValue = isCurrent ? 'lazygitvs.statusRepo.current' : 'lazygitvs.statusRepo';
      return item;
    });
  }

  openRecentRepos() { return this.recentReposMenu(); }

  async statusEnter(repoPath?: string) {
    const selected = this.statusTree?.selection?.[0];
    const selectedRepoPath = repoPath ?? (typeof selected?.id === 'string' ? selected.id : undefined);
    if (selectedRepoPath) return this.selectRepository(selectedRepoPath);
    return this.recentReposMenu();
  }

  private loadLazyGitConfig() {
    const config = readLazyGitConfig();
    this.lazygitKeymap = config.keymap;
    this.lazygitGui = config.gui;
    this.lazygitGit = config.git;
    this.lazygitConfigFiles = config.files;
  }

  private restoreNavigationState() {
    const state = this.context.workspaceState.get<Partial<Record<string, unknown>>>(STATE_KEY, {});
    const panel = state.activePanel;
    if (isPanel(panel)) this.activePanel = panel;
    const previousPanel = state.previousPanel;
    if (isViewPanel(previousPanel)) this.previousPanel = previousPanel;
    this.selected = typeof state.selected === 'number' ? state.selected : this.selected;
    this.hunkSelected = typeof state.hunkSelected === 'number' ? state.hunkSelected : this.hunkSelected;
    this.branchSelected = typeof state.branchSelected === 'number' ? state.branchSelected : this.branchSelected;
    this.tagSelected = typeof state.tagSelected === 'number' ? state.tagSelected : this.tagSelected;
    this.remoteSelected = typeof state.remoteSelected === 'number' ? state.remoteSelected : this.remoteSelected;
    this.commitSelected = typeof state.commitSelected === 'number' ? state.commitSelected : this.commitSelected;
    this.stashSelected = typeof state.stashSelected === 'number' ? state.stashSelected : this.stashSelected;
    this.conflictSelected = typeof state.conflictSelected === 'number' ? state.conflictSelected : this.conflictSelected;
    this.filterText = typeof state.filterText === 'string' ? state.filterText : this.filterText;
    const fileStatusFilter = state.fileStatusFilter;
    if (fileStatusFilter === 'all' || fileStatusFilter === 'staged' || fileStatusFilter === 'unstaged' || fileStatusFilter === 'tracked' || fileStatusFilter === 'untracked') this.fileStatusFilter = fileStatusFilter;
    if (state.hunkSide === 'staged' || state.hunkSide === 'unstaged') this.hunkSide = state.hunkSide;
    if (state.hunkSelectionMode === 'hunk' || state.hunkSelectionMode === 'line') this.hunkSelectionMode = state.hunkSelectionMode;
  }

  private persistNavigationState() {
    void this.context.workspaceState.update(STATE_KEY, {
      activePanel: this.activePanel,
      previousPanel: this.previousPanel,
      selected: this.selected,
      hunkSelected: this.hunkSelected,
      branchSelected: this.branchSelected,
      tagSelected: this.tagSelected,
      remoteSelected: this.remoteSelected,
      commitSelected: this.commitSelected,
      stashSelected: this.stashSelected,
      conflictSelected: this.conflictSelected,
      filterText: this.filterText,
      fileStatusFilter: this.fileStatusFilter,
      hunkSide: this.hunkSide,
      hunkSelectionMode: this.hunkSelectionMode
    });
  }

  async focus() {
    this.loadLazyGitConfig();
    await this.revealDefaultOpenPanels();
    return this.focusPanel(this.activeViewPanel());
  }
  private async revealDefaultOpenPanels() {
    if (this.defaultPanelsRevealed) return;
    this.defaultPanelsRevealed = true;
    for (const panel of PANEL_ORDER.filter((panel): panel is ViewPanel => panel !== 'status')) {
      await this.revealPanelView(panel).catch(() => undefined);
    }
  }
  async focusNumberPanel(index: number) {
    const panel = PANEL_ORDER[index - 1];
    if (!panel) return;
    if (this.editorHunkMode || this.editorEditMode) await this.setEditorHunkMode(false);
    await this.focusPanel(panel);
  }
  async close() {
    await this.setEditorHunkMode(false);
    void vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', false);
    this.ownsModeStatus = false;
    this.setFocusArea('none');
    this.statusLine = '';
    this.activePanel = this.activeViewPanel();
    this.updateModeStatusBar();
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
  }

  private async focusPanel(panel: ViewPanel) {
    this.ownsModeStatus = true;
    this.setFocusArea('panel');
    void vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', true);
    this.activePanel = panel;
    this.updateActiveViewContext();
    this.suppressWebviewAutoFocusUntil = 0;
    this.persistNavigationState();
    this.updateModeStatusBar();
    if (panel === 'status') await this.refresh(false).catch(() => undefined);
    this.renderAll();
    await this.revealPanelView(panel);
    if (panel === 'status') await this.revealCurrentStatusRepo().catch(() => undefined);
    await this.openCurrent(panel, true).catch(() => undefined);
    this.renderAll();
    await this.revealPanelView(panel);
    if (panel === 'status') await this.revealCurrentStatusRepo().catch(() => undefined);
  }

  private async restorePanelFocusAfterModal(viewPanel: ViewPanel) {
    if (this.editorHunkMode || this.editorEditMode) return;
    this.ownsModeStatus = true;
    this.activePanel = this.panelForView(viewPanel);
    this.updateActiveViewContext();
    this.setFocusArea('panel');
    void vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', true);
    this.suppressWebviewAutoFocusUntil = 0;
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.renderAll();
    await this.revealPanelView(this.activeViewPanel());
  }

  private async revealPanelView(panel: ViewPanel) {
    const viewId = VIEW_IDS[panel];
    const reveal = async () => {
      if (!this.visible()) {
        try { await vscode.commands.executeCommand('workbench.view.scm'); } catch { /* ignore */ }
      }
      try { this.views.get(panel)?.show(false); } catch { /* ignore */ }
      try { await vscode.commands.executeCommand(`${viewId}.focus`, { preserveFocus: false }); } catch { /* ignore */ }
    };
    await reveal();
    for (const delay of [80, 180]) setTimeout(() => { void reveal(); }, delay);
    setTimeout(() => { this.suppressWebviewAutoFocusUntil = 0; }, 260);
  }

  private async revealCurrentStatusRepo() {
    this.statusTreeProvider?.refresh();
    const items = this.statusTreeItems();
    const item = items.find(item => item.id === activeWorkspaceRoot) ?? items[0];
    if (item) await this.statusTree?.reveal(item, { select: true, focus: true }).then(undefined, () => undefined);
  }

  private visible() { return Array.from(this.views.values()).some(view => view.visible) || !!this.statusTree?.visible; }
  private scheduleRefresh(delayMs = 250) {
    this.updateModeStatusBar();
    if (!this.visible()) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(false).catch(err => vscode.window.showErrorMessage(err.message)), delayMs);
  }


  private async setEditorHunkMode(active: boolean) {
    this.editorHunkMode = active;
    if (!active) { this.editorEditMode = false; this.readOnlyHunkMode = false; this.editorModeFilePath = undefined; }
    this.setFocusArea(active ? 'editor-hunk' : this.ownsModeStatus ? 'panel' : 'viewer');
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorHunkMode', active);
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorEditMode', false);
    await this.setVimKeyCaptureSuppressed(active);
    if (!active) this.clearEditorHunkDecorations();
    else this.updateEditorHunkDecorations();
    this.updateModeStatusBar();
  }

  setVSCodeVimPresent(present: boolean) { this.vscodeVimPresent = present; }

  private async setVimKeyCaptureSuppressed(suppressed: boolean) {
    await vscode.commands.executeCommand('setContext', 'vim.active', suppressed ? false : this.vscodeVimPresent);
  }

  private setFocusArea(area: FocusArea) {
    this.focusArea = area;
    void vscode.commands.executeCommand('setContext', 'lazygitvs.panelFocus', area === 'panel');
    void vscode.commands.executeCommand('setContext', 'lazygitvs.viewerFocus', area === 'viewer');
    void vscode.commands.executeCommand('setContext', 'lazygitvs.focusArea', area);
    this.updateModeStatusBar();
  }

  private focusLabel(): string {
    if (this.focusArea === 'panel') return 'LG';
    if (this.focusArea === 'viewer') return 'VIEW';
    if (this.focusArea === 'editor-hunk') return 'HUNK';
    if (this.focusArea === 'editor-edit') return 'EDIT';
    return '—';
  }

  private focusHint(): string {
    if (this.focusArea === 'panel') return 'Focus: LG panel';
    if (this.focusArea === 'viewer') return 'Focus: file viewer · press 1–8 to jump back to LG panels';
    if (this.focusArea === 'editor-hunk') return 'Focus: editor HUNK/LINE · 1–8 exits HUNK and jumps panels';
    if (this.focusArea === 'editor-edit') return 'Focus: file editor · Ctrl+Enter returns to HUNK';
    return 'Focus: outside LGVS';
  }

  private updateModeStatusBar() {
    const showConfigured = vscode.workspace.getConfiguration('lazygitvs').get<boolean>('showStatusBarMode', false);
    if (!showConfigured && !this.editorHunkMode && this.focusArea === 'none') { this.modeStatusBarItem.hide(); return; }
    const h = this.hunks[this.hunkSelected];
    const changed = h ? hunkSelectableLineIndexes(h) : [];
    const side = this.hunkSide === 'staged' ? 'S' : 'U';
    const mode = this.editorEditMode ? 'EDIT' : this.editorHunkMode ? `${this.hunkSelectionMode.toUpperCase()} ${side} ${this.hunkSelectionMode === 'line' ? `${Math.min(this.hunkLineSelected + 1, Math.max(1, changed.length))}/${Math.max(1, changed.length)} in ` : ''}${Math.min(this.hunkSelected + 1, Math.max(1, this.hunks.length))}/${Math.max(1, this.hunks.length)}` : `${this.activePanel.toUpperCase()} · ${this.focusLabel()}`;
    this.modeStatusBarItem.text = `-- ${mode} --`;
    this.modeStatusBarItem.tooltip = this.editorHunkMode ? this.focusHint() : `LazyGitVS mode · ${this.focusHint()}`;
    if ((this.visible() && (this.ownsModeStatus || this.focusArea === 'viewer' || this.focusArea === 'panel')) || this.editorHunkMode || this.editorEditMode) this.modeStatusBarItem.show(); else this.modeStatusBarItem.hide();
  }

  private async refresh(updatePreview: boolean) {
    if (this.refreshInFlight) { this.refreshPending = true; return; }
    this.refreshInFlight = true;
    try {
      const refreshSelectionEpoch = this.selectionEpoch;
      const refreshPanel = this.activePanel;
      const refreshEditorMode = this.editorHunkMode || this.editorEditMode;
      const previousPath = this.currentFile()?.path;
      this.workspaceRepos = await discoverWorkspaceRepositories().catch(() => []);
      this.files = await changedFiles(this.lazygitGit);
      this.branchItems = await branches().catch(() => []);
      this.tagItems = await tags().catch(() => []);
      this.remoteItems = await remotes().catch(() => []);
      this.commitItems = await commits().catch(() => []);
      this.stashItems = await stashes().catch(() => []);
      this.conflictItems = await conflictFiles().catch(() => []);
      if (previousPath && this.selectionEpoch === refreshSelectionEpoch) { const i = this.filteredFiles().findIndex(f => f.path === previousPath); if (i >= 0) this.selected = i; }
      this.clampSelections();
      if (this.activePanel === 'hunks' || this.editorHunkMode) await this.loadHunks(false);
      this.updateModeStatusBar();
      this.updateEditorHunkDecorations();
      this.renderAll();
      if (
        updatePreview &&
        this.selectionEpoch === refreshSelectionEpoch &&
        this.activePanel === refreshPanel &&
        !refreshEditorMode &&
        !this.editorHunkMode &&
        !this.editorEditMode
      ) await this.openCurrent(this.activeViewPanel(), true).catch(() => undefined);
    } finally {
      this.refreshInFlight = false;
      if (this.refreshPending) { this.refreshPending = false; this.scheduleRefresh(0); }
    }
  }

  private activeViewPanel(): ViewPanel { return this.activePanel === 'hunks' ? 'files' : this.activePanel; }
  private panelForView(panel: ViewPanel): Panel { return panel === 'files' ? this.activePanel === 'hunks' ? 'hunks' : 'files' : panel; }
  private clampSelections() {
    this.selected = clamp(this.selected, this.filteredFiles().length);
    this.hunkSelected = clamp(this.hunkSelected, this.hunks.length);
    this.branchSelected = clamp(this.branchSelected, this.filteredBranches().length);
    this.tagSelected = clamp(this.tagSelected, this.filteredTags().length);
    this.remoteSelected = clamp(this.remoteSelected, this.filteredRemotes().length);
    this.commitSelected = clamp(this.commitSelected, this.filteredCommits().length);
    this.commitFileSelected = clamp(this.commitFileSelected, this.commitFileItems.length);
    this.stashSelected = clamp(this.stashSelected, this.filteredStashes().length);
    this.stashFileSelected = clamp(this.stashFileSelected, this.stashFileItems.length);
    this.conflictSelected = clamp(this.conflictSelected, this.filteredConflicts().length);
    this.hunkLineSelected = clamp(this.hunkLineSelected, this.hunks[this.hunkSelected] ? hunkSelectableLineIndexes(this.hunks[this.hunkSelected]).length : 0);
  }
  private activeIndex(panel: Panel): number { return panel === 'hunks' ? (this.hunkSelectionMode === 'line' ? this.hunkLineSelected : this.hunkSelected) : panel === 'branches' ? this.branchSelected : panel === 'tags' ? this.tagSelected : panel === 'remotes' ? this.remoteSelected : panel === 'commits' ? (this.commitFilesFor ? this.commitFileSelected : this.commitSelected) : panel === 'stash' ? (this.stashFilesFor ? this.stashFileSelected : this.stashSelected) : panel === 'conflicts' ? this.conflictSelected : this.selected; }
  private setActiveIndex(panel: Panel, value: number) { if (panel === 'hunks') { if (this.hunkSelectionMode === 'line') this.hunkLineSelected = value; else this.hunkSelected = value; } else if (panel === 'branches') this.branchSelected = value; else if (panel === 'tags') this.tagSelected = value; else if (panel === 'remotes') this.remoteSelected = value; else if (panel === 'commits') { if (this.commitFilesFor) this.commitFileSelected = value; else this.commitSelected = value; } else if (panel === 'stash') { if (this.stashFilesFor) this.stashFileSelected = value; else this.stashSelected = value; } else if (panel === 'conflicts') this.conflictSelected = value; else this.selected = value; }
  private activeLength(panel: Panel): number { return panel === 'status' ? 0 : panel === 'hunks' ? (this.hunkSelectionMode === 'line' ? (this.hunks[this.hunkSelected] ? hunkSelectableLineIndexes(this.hunks[this.hunkSelected]).length : 0) : this.hunks.length) : panel === 'branches' ? this.filteredBranches().length : panel === 'tags' ? this.filteredTags().length : panel === 'remotes' ? this.filteredRemotes().length : panel === 'commits' ? (this.commitFilesFor ? this.commitFileItems.length : this.filteredCommits().length) : panel === 'stash' ? (this.stashFilesFor ? this.stashFileItems.length : this.filteredStashes().length) : panel === 'conflicts' ? this.filteredConflicts().length : this.filteredFiles().length; }
  private filteredFiles(): ChangedFile[] {
    let items = this.files;
    if (this.fileStatusFilter === 'staged') items = items.filter(f => f.staged);
    if (this.fileStatusFilter === 'unstaged') items = items.filter(f => f.xy[1] !== ' ' || f.untracked);
    if (this.fileStatusFilter === 'tracked') items = items.filter(f => !f.untracked);
    if (this.fileStatusFilter === 'untracked') items = items.filter(f => f.untracked);
    return this.sortFilesByLazyGitConfig(this.applyTextFilter(items, f => f.path));
  }
  private filteredBranches(): Branch[] { return this.applyTextFilter(this.branchItems, b => b.label); }
  private filteredTags(): Tag[] { return this.applyTextFilter(this.tagItems, t => `${t.name} ${t.subject}`); }
  private filteredRemotes(): Remote[] { return this.applyTextFilter(this.remoteItems, r => `${r.name} ${r.fetchUrl} ${r.pushUrl}`); }
  private filteredCommits(): Commit[] { return this.applyTextFilter(this.commitItems, c => `${c.hash} ${c.subject} ${c.refs}`); }
  private filteredStashes(): Stash[] { return this.applyTextFilter(this.stashItems, s => `${s.ref} ${s.message}`); }
  private filteredConflicts(): ConflictFile[] { return this.applyTextFilter(this.conflictItems, f => f.path); }
  private applyTextFilter<T>(items: T[], text: (item: T) => string): T[] { const q = this.filterText.trim().toLowerCase(); return q ? items.filter(item => text(item).toLowerCase().includes(q)) : items; }
  private sortFilesByLazyGitConfig(items: ChangedFile[]): ChangedFile[] {
    const order = this.lazygitGui.fileTreeSortOrder;
    const normalize = (value: string) => this.lazygitGui.fileTreeSortCaseSensitive ? value : value.toLocaleLowerCase();
    const weight = (filePath: string) => filePath.includes('/') ? 1 : 0;
    return [...items].sort((a, b) => {
      if (order === 'filesFirst' || order === 'foldersFirst') {
        const aw = weight(a.path), bw = weight(b.path);
        if (aw !== bw) return order === 'filesFirst' ? aw - bw : bw - aw;
      }
      return normalize(a.path).localeCompare(normalize(b.path));
    });
  }
  private currentFile(): ChangedFile | undefined { return this.filteredFiles()[this.selected]; }
  private currentBranch(): Branch | undefined { return this.filteredBranches()[this.branchSelected]; }
  private currentTag(): Tag | undefined { return this.filteredTags()[this.tagSelected]; }
  private currentRemote(): Remote | undefined { return this.filteredRemotes()[this.remoteSelected]; }
  private currentCommit(): Commit | undefined { return this.filteredCommits()[this.commitSelected]; }
  private currentStash(): Stash | undefined { return this.filteredStashes()[this.stashSelected]; }
  private currentConflict(): ConflictFile | undefined { return this.filteredConflicts()[this.conflictSelected]; }
  private async select(viewPanel: ViewPanel, index: number) {
    const panel = this.panelForView(viewPanel);
    const len = this.activeLength(panel);
    if (!Number.isFinite(index) || !len) return;
    this.ownsModeStatus = true;
    this.activePanel = panel;
    this.selectionEpoch++;
    this.setActiveIndex(panel, clamp(index, len));
    if (panel === 'files') { this.fileRangeAnchor = undefined; this.fileRangeSelected.clear(); }
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.renderAll();
    await this.openCurrent(viewPanel, true, panel === 'files').catch(() => undefined);
  }
  private async move(viewPanel: ViewPanel, delta: number) {
    this.ownsModeStatus = true;
    const panel = this.panelForView(viewPanel);
    this.activePanel = panel;
    this.updateModeStatusBar();
    const len = this.activeLength(panel);
    if (!len) return;
    this.selectionEpoch++;
    this.setActiveIndex(panel, Math.max(0, Math.min(len - 1, this.activeIndex(panel) + delta)));
    this.persistNavigationState();
    this.renderAll();
    await this.openCurrent(viewPanel, true, panel === 'files').catch(() => undefined);
  }
  private async moveTo(viewPanel: ViewPanel, position: 'top' | 'bottom') {
    const panel = this.panelForView(viewPanel);
    const len = this.activeLength(panel);
    if (!len) return;
    this.ownsModeStatus = true;
    this.activePanel = panel;
    this.selectionEpoch++;
    this.setActiveIndex(panel, position === 'top' ? 0 : len - 1);
    if (panel === 'files') { this.fileRangeAnchor = undefined; this.fileRangeSelected.clear(); }
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.renderAll();
    await this.openCurrent(viewPanel, true, panel === 'files').catch(() => undefined);
  }
  private selectFileRange(anchor: number, head: number) {
    this.fileRangeSelected.clear();
    const [start, end] = [Math.min(anchor, head), Math.max(anchor, head)];
    for (let i = start; i <= end; i++) this.fileRangeSelected.add(i);
  }
  private async toggleRange(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    if (panel !== 'files') return;
    if (this.fileRangeAnchor === undefined) { this.fileRangeAnchor = this.selected; this.fileRangeSelected.add(this.selected); }
    else { this.fileRangeAnchor = undefined; this.fileRangeSelected.clear(); }
    this.renderAll();
  }
  private async rangeMove(viewPanel: ViewPanel, delta: number) {
    const panel = this.panelForView(viewPanel);
    if (panel !== 'files') return this.move(viewPanel, delta);
    if (this.fileRangeAnchor === undefined) this.fileRangeAnchor = this.selected;
    await this.move(viewPanel, delta);
    this.selectFileRange(this.fileRangeAnchor, this.selected);
    this.renderAll();
  }
  private async moveBlock(viewPanel: ViewPanel, delta: number) {
    const current = this.activeViewPanel() || viewPanel;
    const currentIndex = PANEL_ORDER.indexOf(current);
    const next = PANEL_ORDER[((currentIndex >= 0 ? currentIndex : 0) + delta + PANEL_ORDER.length) % PANEL_ORDER.length];
    this.ownsModeStatus = true;
    await this.focusPanel(next);
  }
  private async toggle(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    this.activePanel = panel;
    this.updateModeStatusBar();
    if (panel === 'hunks') { const h = this.hunks[this.hunkSelected]; if (!h) return; if (this.hunkSelectionMode === 'line') { const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected]; if (line === undefined) return; await applyLine(h, line); } else await applyHunk(h); await this.loadHunks(false); await this.refresh(true); return; }
    if (panel === 'files') {
      const visible = this.filteredFiles();
      const ranged = Array.from(this.fileRangeSelected).map(i => visible[i]).filter(Boolean);
      if (ranged.length > 1) { await toggleStageAll(ranged); this.fileRangeAnchor = undefined; this.fileRangeSelected.clear(); await this.refresh(true); return; }
      const f = this.currentFile(); if (!f) return; await toggleStage(f); await this.refresh(true);
    }
    else await this.enter(viewPanel);
  }
  private async enter(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    this.activePanel = panel;
    this.updateModeStatusBar();
    if (panel === 'status') return this.recentReposMenu();
    if (panel === 'files') return this.enterHunks();
    if (panel === 'hunks') return this.openCurrent('files', false);
    if (panel === 'branches') { this.statusLine = 'Branches: Enter is unused in lazygit; Space checks out, 0 focuses the log.'; this.renderAll(); return; }
    if (panel === 'tags') return this.tagMenu();
    if (panel === 'remotes') return this.remoteMenu();
    if (panel === 'commits') return this.enterCommit();

    if (panel === 'stash') return this.enterStash();
    if (panel === 'conflicts') return this.conflictMenu();
  }
  private async back(viewPanel: ViewPanel) {
    if (viewPanel === 'files' && this.activePanel === 'hunks') { this.activePanel = 'files'; this.updateModeStatusBar(); this.renderAll(); return; }
    if (viewPanel === 'commits' && this.commitFilesFor) { this.commitFilesFor = undefined; this.commitFileItems = []; this.commitFileSelected = 0; this.renderAll(); await this.openCurrent('commits', true).catch(() => undefined); return; }
    if (viewPanel === 'stash' && this.stashFilesFor) { this.stashFilesFor = undefined; this.stashFileItems = []; this.stashFileSelected = 0; this.renderAll(); return; }
    await this.focusPanel(viewPanel);
  }
  private async focusMainView(viewPanel: ViewPanel) {
    this.ownsModeStatus = false;
    this.setFocusArea('viewer');
    this.renderAll();
    await this.openCurrent(viewPanel, false);
  }
  private async editCurrent(viewPanel: ViewPanel) { const file = this.currentFilePath(viewPanel); if (file) { this.ownsModeStatus = false; this.setFocusArea('viewer'); this.renderAll(); await editPath(file); } }
  private currentFilePath(viewPanel: ViewPanel): string | undefined { if (viewPanel === 'conflicts') return this.conflictItems[this.conflictSelected]?.path; return this.currentFile()?.path; }
  private async copyCurrentPath(viewPanel: ViewPanel) { const file = this.currentFilePath(viewPanel); if (file) await copyText(file, 'path copied'); }
  private async copyCurrentInfo(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    if (panel === 'files' || panel === 'hunks') { const f = this.currentFile(); if (f) await copyText(`${f.xy} ${f.path}`, 'file info copied'); }
    else if (panel === 'branches') { const b = this.currentBranch(); if (b) await copyText(b.name, 'branch copied'); }
    else if (panel === 'tags') { const t = this.currentTag(); if (t) await copyText(t.name, 'tag copied'); }
    else if (panel === 'remotes') { const r = this.currentRemote(); if (r) await copyText(r.name, 'remote copied'); }
    else if (panel === 'commits') { const c = this.currentCommit(); if (c) await copyText(`${c.hash} ${c.subject}`, 'commit copied'); }
   
    if (panel === 'stash') { const st = this.currentStash(); if (st) await copyText(`${st.ref} ${st.message}`, 'stash copied'); }
  }
  private async ignoreCurrentFile() {
    const f = this.currentFile(); if (!f) return;
    await pickGitAction(`Ignore / exclude · ${f.path}`, [
      { key: 'i', label: '$(file) Ignore file', description: '.gitignore', run: async () => appendIgnore('.gitignore', f.path) },
      { key: 'e', label: '$(eye-closed) Exclude file locally', description: '.git/info/exclude', run: async () => appendIgnore('.git/info/exclude', f.path) }
    ]);
    await this.refresh(true);
  }
  private statusCommandCatalog(): GitMenuItem[] {
    return [
      { key: 'o', label: '$(go-to-file) Open lazygit config', description: this.lazygitConfigFiles[0] ?? 'No config loaded', run: async () => { const cfg = this.lazygitConfigFiles[0]; if (cfg) await vscode.env.openExternal(vscode.Uri.file(cfg)); else vscode.window.showInformationMessage('LazyGitVS: lazygit config not found; using defaults.'); } },
      { key: 'e', label: '$(edit) Edit lazygit config', description: this.lazygitConfigFiles[0] ?? 'No config loaded', run: async () => { const cfg = this.lazygitConfigFiles[0]; if (cfg) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(cfg)), { preview: false }); else vscode.window.showInformationMessage('LazyGitVS: lazygit config not found; using defaults.'); } },
      { key: 'a', label: '$(git-commit) Show all branch log', description: 'git log --all --graph', run: async () => showText('LazyGitVS All Branch Log', await git(['log', '--all', '--graph', '--decorate=short', '--oneline', '--max-count=200'])) },
      { key: 'A', label: '$(git-commit) Show all branch log reversed', description: 'git log --all --graph --reverse', run: async () => showText('LazyGitVS All Branch Log', await git(['log', '--all', '--graph', '--decorate=short', '--oneline', '--reverse', '--max-count=200'])) },
      { key: 'u', label: '$(cloud-download) Check for updates', description: 'Use VS Code extension updates', run: async () => { await vscode.window.showInformationMessage('LazyGitVS updates are handled by VS Code / Marketplace.'); } },
      { key: '<enter>', label: '$(repo) Switch to workspace repository', description: this.workspaceRepos.length ? `${this.workspaceRepos.length} repos available` : 'No repos discovered', run: async () => this.recentReposMenu() },
    ];
  }
  private async recentReposMenu() {
    const repos = await discoverWorkspaceRepositories();
    this.workspaceRepos = repos;
    if (!repos.length) { vscode.window.showInformationMessage('LazyGitVS: no Git repositories found in this workspace.'); return; }
    const current = workspaceRoot();
    const items = repos.map(repo => ({
      label: `${repo.path === current ? '$(check) ' : ''}${repo.name}`,
      description: repo.branch,
      detail: repo.path,
      repo
    }));
    const qp = vscode.window.createQuickPick<typeof items[number]>();
    qp.title = 'Recent repositories';
    qp.placeholder = 'Switch to a workspace repository';
    qp.items = items;
    qp.activeItems = items.filter(item => item.repo.path === current).slice(0, 1);
    const picked = await new Promise<typeof items[number] | undefined>(resolve => {
      let settled = false;
      qp.onDidAccept(() => { settled = true; resolve(qp.activeItems[0]); qp.hide(); });
      qp.onDidHide(() => { if (!settled) resolve(undefined); qp.dispose(); });
      qp.show();
    });
    if (!picked) return;
    await this.selectRepository(picked.repo.path);
  }
  private async selectRepository(repoPath: string) {
    const repos = this.workspaceRepos.length ? this.workspaceRepos : await discoverWorkspaceRepositories();
    const repo = repos.find(repo => repo.path === repoPath);
    if (!repo) return this.recentReposMenu();
    activeWorkspaceRoot = repo.path;
    this.workspaceRepos = repos;
    this.statusLine = `Repository: ${repo.name}`;
    await this.refresh(true);
    await this.focusPanel('status');
  }
  private async statusMenu() {
    await pickGitAction('Status options', this.statusCommandCatalog());
  }
  private keyLabel(value: string | string[] | undefined): string { return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''); }
  private filesCommandCatalog(viewPanel: ViewPanel): GitMenuItem[] {
    const u = this.lazygitKeymap.universal, f = this.lazygitKeymap.files;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    return [
      { key: key(f.openStatusFilter) || 'F', label: '$(filter) File status filter', run: async () => this.statusFilterMenu() },
      { key: key(u.pushFiles) || key(u.push) || 'P', label: '$(cloud-upload) Push', run: async () => this.runMenu(showPushMenu, viewPanel) },
      { key: key(u.pullFiles) || key(u.pull) || 'p', label: '$(cloud-download) Pull', run: async () => this.runMenu(showPullMenu, viewPanel) },
      { key: key(f.toggleStagedAll) || 'a', label: '$(check-all) Toggle stage all files', run: async () => this.stageAll() },
      { key: key(f.commitChanges) || 'c', label: '$(git-commit) Commit', run: async () => this.commit() },
      { key: key(f.commitChangesWithoutHook) || 'w', label: '$(shield) Commit without pre-commit hook', run: async () => this.commit('noVerify') },
      { key: key(f.amendLastCommit) || 'A', label: '$(history) Amend last commit', run: async () => this.commit('amendNoEdit') },
      { key: key(f.commitChangesWithEditor) || 'C', label: '$(edit) Commit with body', run: async () => this.commit('body') },
      { key: key(f.stashAllChanges) || 's', label: '$(archive) Stash all changes', run: async () => this.stashAll() },
      { key: key(f.viewStashOptions) || 'S', label: '$(archive) Stash options', run: async () => this.runMenu(showStashCreateMenu, viewPanel) },
      { key: key(u.remove) || 'd', label: '$(trash) Discard menu', run: async () => this.discardMenu(viewPanel) },
      { key: key(f.viewResetOptions) || 'D', label: '$(debug-restart) Reset / nuke menu', run: async () => this.runMenu(() => showResetMenu(() => this.animateExplosion()), viewPanel) },
    ];
  }
  private hunkCommandCatalog(viewPanel: ViewPanel): GitMenuItem[] {
    const u = this.lazygitKeymap.universal, m = this.lazygitKeymap.main;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    return [
      { key: key(u.select) || '<space>', label: '$(add) Stage/unstage selected hunk or line', run: async () => this.toggle(viewPanel) },
      { key: key(u.togglePanel) || '<tab>', label: '$(split-horizontal) Toggle staged/unstaged', run: async () => this.toggleHunkPanel() },
      { key: key(m.toggleSelectHunk) || 'a', label: '$(list-selection) Toggle hunk/line mode', run: async () => this.showPendingLineMode() },
      { key: key(u.remove) || 'd', label: '$(trash) Discard/unstage selected hunk', run: async () => this.discardMenu(viewPanel) }
    ];
  }
  private branchCommandCatalog(): GitMenuItem[] {
    const b = this.currentBranch();
    const k = this.lazygitKeymap.branches, u = this.lazygitKeymap.universal;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    const items: GitMenuItem[] = [];
    if (b) items.push({ key: key(u.select) || '<space>', label: '$(git-branch) Checkout branch', description: b.name, run: async () => { await git(['checkout', b.name]); } });
    items.push({ key: key(k.checkoutBranchByName) || 'c', label: '$(symbol-key) Checkout by name', description: "enter '-' for previous branch", run: async () => { const name = await vscode.window.showInputBox({ title: 'Checkout branch by name', placeHolder: "branch name or '-'" }); if (name?.trim()) await git(['checkout', name.trim()]); } });
    items.push({ key: key(k.checkoutPreviousBranch) || '-', label: '$(history) Checkout previous branch', description: 'git checkout -', args: ['checkout', '-'] });
    items.push({ key: key(u.new) || 'n', label: '$(add) New branch', description: 'git checkout -b <name>', run: async () => { const name = await vscode.window.showInputBox({ title: 'New branch', validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['checkout', '-b', name.trim()]); } });
    if (b && b.kind === 'local') items.push({ key: key(k.renameBranch) || 'R', label: '$(edit) Rename branch', description: b.name, run: async () => { const name = await vscode.window.showInputBox({ title: `Rename ${b.name}`, value: b.name, validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['branch', '-m', b.name, name.trim()]); } });
    if (b && !b.current) items.push({ key: key(k.mergeIntoCurrentBranch) || 'M', label: '$(git-merge) Merge into current branch', description: b.name, danger: true, confirm: `Merge ${b.name} into current branch?`, args: ['merge', b.name] });
    if (b && !b.current) items.push({ key: key(k.rebaseBranch) || 'r', label: '$(debug-restart) Rebase current branch onto selected', description: b.name, danger: true, confirm: `Rebase current branch onto ${b.name}?`, args: ['rebase', b.name] });
    if (b && !b.current) items.push({ key: key(k.forceCheckoutBranch) || 'F', label: '$(warning) Force checkout branch', description: b.name, danger: true, confirm: `Force checkout ${b.name} and discard local changes?`, args: ['checkout', '-f', b.name] });
    if (b && b.kind === 'local') items.push({ key: key(k.setUpstream) || 'u', label: '$(repo-push) Set upstream', description: `origin/${b.name}`, args: ['branch', '--set-upstream-to', `origin/${b.name}`, b.name] });
    if (b && b.kind === 'local') items.push({ key: key(k.fastForward) || 'f', label: '$(repo-pull) Fast-forward from upstream', description: b.name, args: ['merge', '--ff-only', `origin/${b.name}`] });
    if (b) items.push({ key: key(k.createTag) || 'T', label: '$(tag) Create tag here', description: b.name, run: async () => { const tag = await vscode.window.showInputBox({ title: `Create tag at ${b.name}`, validateInput: v => v.trim() ? undefined : 'Tag name required.' }); if (tag?.trim()) await git(['tag', tag.trim(), b.name]); } });
    if (b && !b.current) items.push({ key: key(u.remove) || 'd', label: '$(trash) Delete branch', description: b.name, danger: true, confirm: `Delete branch ${b.name}?`, run: async () => { await git(['branch', b.kind === 'remote' ? '-dr' : '-d', b.name]); } });
    return items;
  }
  private tagCommandCatalog(): GitMenuItem[] {
    const t = this.currentTag();
    const k = this.lazygitKeymap.branches, u = this.lazygitKeymap.universal;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    const items: GitMenuItem[] = [
      { key: key(k.createTag) || 'T', label: '$(tag) Create tag at HEAD', description: 'git tag <name>', run: async () => { const name = await vscode.window.showInputBox({ title: 'Create tag at HEAD', validateInput: v => v.trim() ? undefined : 'Tag name required.' }); if (name?.trim()) await git(['tag', name.trim()]); } }
    ];
    if (!t) return items;
    items.unshift({ key: key(u.select) || '<space>', label: '$(debug-step-over) Checkout tag detached', description: t.name, danger: true, confirm: `Checkout ${t.name} as detached HEAD?`, args: ['checkout', t.name] });
    items.push(
      { key: key(u.new) || 'n', label: '$(git-branch) New branch from tag', description: t.name, run: async () => { const name = await vscode.window.showInputBox({ title: `New branch from ${t.name}`, validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['checkout', '-b', name.trim(), t.name]); } },
      { key: key(k.pushTag) || 'P', label: '$(repo-push) Push tag', description: t.name, args: ['push', 'origin', t.name] },
      { key: key(u.remove) || 'd', label: '$(trash) Delete tag', description: t.name, danger: true, confirm: `Delete tag ${t.name}?`, args: ['tag', '-d', t.name] }
    );
    return items;
  }
  private remoteCommandCatalog(): GitMenuItem[] {
    const r = this.currentRemote();
    const k = this.lazygitKeymap.branches, u = this.lazygitKeymap.universal;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    const items: GitMenuItem[] = [
      { key: key(u.new) || 'n', label: '$(add) Add remote', description: 'git remote add <name> <url>', run: async () => { const name = await vscode.window.showInputBox({ title: 'Add remote name', validateInput: v => v.trim() ? undefined : 'Remote name required.' }); if (!name?.trim()) return; const url = await vscode.window.showInputBox({ title: `URL for remote ${name.trim()}`, validateInput: v => v.trim() ? undefined : 'Remote URL required.' }); if (url?.trim()) await git(['remote', 'add', name.trim(), url.trim()]); } }
    ];
    if (!r) return items;
    items.unshift({ key: key(k.fetchRemote) || 'f', label: '$(sync) Fetch remote', description: r.name, args: ['fetch', r.name] });
    items.push(
      { key: key(u.edit) || 'e', label: '$(edit) Edit remote URL', description: r.fetchUrl || r.pushUrl, run: async () => { const url = await vscode.window.showInputBox({ title: `Set URL for ${r.name}`, value: r.fetchUrl || r.pushUrl, validateInput: v => v.trim() ? undefined : 'Remote URL required.' }); if (url?.trim()) await git(['remote', 'set-url', r.name, url.trim()]); } },
      { key: key(k.addForkRemote) || 'F', label: '$(repo-forked) Add fork remote', description: 'git remote add <name> <url>', run: async () => { const name = await vscode.window.showInputBox({ title: 'Fork remote name', placeHolder: 'fork', validateInput: v => v.trim() ? undefined : 'Remote name required.' }); if (!name?.trim()) return; const url = await vscode.window.showInputBox({ title: `URL for fork remote ${name.trim()}`, validateInput: v => v.trim() ? undefined : 'Remote URL required.' }); if (url?.trim()) await git(['remote', 'add', name.trim(), url.trim()]); } },
      { key: key(u.remove) || 'd', label: '$(trash) Remove remote', description: r.name, danger: true, confirm: `Remove remote ${r.name}?`, args: ['remote', 'remove', r.name] }
    );
    return items;
  }
  private commitCommandCatalog(): GitMenuItem[] {
    const u = this.lazygitKeymap.universal, k = this.lazygitKeymap.commits;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    const c = this.currentCommit();
    if (!c) return [];
    return [
      { key: key(u.goInto) || '<enter>', label: '$(list-unordered) View files in commit', description: c.subject, run: async () => this.enterCommit() },
      { key: key(k.copyCommitAttributeToClipboard) || key(u.copyToClipboard) || 'y', label: '$(copy) Copy commit attribute', description: 'hash / subject / both', run: async () => showCommitCopyMenu(c) },
      { key: key(k.checkoutCommit) || '<space>', label: '$(debug-step-over) Checkout commit detached', description: c.hash, danger: true, confirm: `Checkout ${c.hash} as detached HEAD?`, args: ['checkout', c.hash] },
      { key: key(k.newBranch) || 'n', label: '$(git-branch) New branch off commit', description: c.hash, run: async () => { const name = await vscode.window.showInputBox({ title: `New branch at ${c.hash}`, validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['checkout', '-b', name.trim(), c.hash]); } },
      { key: key(k.renameCommit) || 'r', label: '$(edit) Reword HEAD commit', description: 'git commit --amend', run: async () => { const msg = await vscode.window.showInputBox({ title: 'Reword HEAD commit', value: c.subject, validateInput: v => v.trim() ? undefined : 'Commit message required.' }); if (msg?.trim()) await git(['commit', '--amend', '-m', msg.trim()]); } },
      { key: key(k.amendToCommit) || 'A', label: '$(history) Amend HEAD with staged changes', description: 'git commit --amend --no-edit', danger: true, confirm: 'Amend HEAD with staged changes?', args: ['commit', '--amend', '--no-edit'] },
      { key: key(k.createFixupCommit) || 'F', label: '$(tools) Create fixup commit', description: c.hash, args: ['commit', '--fixup', c.hash] },
      { key: key(k.markCommitAsFixup) || 'f', label: '$(tools) Mark commit as fixup target', description: 'copy fixup target', run: async () => copyText(c.hash, 'fixup target copied') },
      { key: key(k.cherryPickCopy) || 'C', label: '$(copy) Cherry-pick commit', description: c.hash, args: ['cherry-pick', c.hash] },
      { key: key(k.revertCommit) || 't', label: '$(reply) Revert commit', description: c.hash, danger: true, confirm: `Create a revert commit for ${c.hash}?`, args: ['revert', c.hash] },
      { key: key(k.createTag) || key(k.tagCommit) || 'T', label: '$(tag) Tag commit', description: c.hash, run: async () => { const tag = await vscode.window.showInputBox({ title: `Tag ${c.hash}`, validateInput: v => v.trim() ? undefined : 'Tag name required.' }); if (tag?.trim()) await git(['tag', tag.trim(), c.hash]); } },
      { key: key(k.viewResetOptions) || 'g', label: '$(debug-restart) Reset options', description: c.hash, run: async () => showCommitResetMenu(c) },
      { key: key(k.openInBrowser) || 'o', label: '$(globe) Open commit in browser', description: 'origin remote URL', run: async () => { const url = await originCommitUrl(c.hash); if (url) await vscode.env.openExternal(vscode.Uri.parse(url)); else vscode.window.showInformationMessage('LazyGitVS: no browser URL for origin remote.'); } },
      { key: key(k.openLogMenu) || '<ctrl+l>', label: '$(git-commit) Commit log patch', description: 'show --stat --patch', run: async () => showText(`LazyGitVS Commit ${c.hash}`, await git(this.showArgs('--stat', '--patch', c.hash))) }
    ];
  }
  private stashCommandCatalog(): GitMenuItem[] {
    const s = this.currentStash();
    if (!s) return [{ key: 'a', label: '$(archive) Stash all changes', description: 'git stash push', args: ['stash', 'push'] }];
    const k = this.lazygitKeymap.stash;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    return [
      { key: '<enter>', label: '$(eye) Show stash', description: s.message, run: async () => showText(`LazyGitVS ${s.ref}`, await git(['stash', 'show', ...gitDiffConfigArgs(this.lazygitGit, true), '--stat', '--patch', s.ref])) },
      { key: key(k.apply) || '<space>', label: '$(archive) Apply stash', description: s.ref, args: ['stash', 'apply', s.ref] },
      { key: key(k.popStash) || 'g', label: '$(archive) Pop stash', description: s.ref, args: ['stash', 'pop', s.ref] },
      { key: key(k.newBranch) || 'n', label: '$(git-branch) New branch from stash', description: s.ref, run: async () => { const name = await vscode.window.showInputBox({ title: `New branch from ${s.ref}`, validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['stash', 'branch', name.trim(), s.ref]); } },
      { key: key(k.renameStash) || 'r', label: '$(edit) Rename stash', description: 'store new message and drop old ref', run: async () => { const msg = await vscode.window.showInputBox({ title: `Rename ${s.ref}`, value: s.message, validateInput: v => v.trim() ? undefined : 'Stash message required.' }); if (!msg?.trim()) return; const sha = (await git(['rev-parse', s.ref])).trim(); await git(['stash', 'store', '-m', msg.trim(), sha]); await git(['stash', 'drop', s.ref]); } },
      { key: 'd', label: '$(trash) Drop stash', description: s.ref, danger: true, confirm: `Drop ${s.ref}?`, args: ['stash', 'drop', s.ref] }
    ];
  }
  private conflictCommandCatalog(): GitMenuItem[] {
    const f = this.currentConflict();
    if (!f) return [];
    return [
      { key: '<enter>', label: '$(merge) Open merge editor', description: f.path, run: async () => { await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(workspaceRoot(), f.path)), 'mergeEditor'); } },
      { key: 'o', label: '$(file) Open file', description: f.path, run: async () => { await editPath(f.path); } },
      { key: '1', label: '$(arrow-left) Choose ours', description: 'git checkout --ours', danger: true, confirm: `Accept ours for ${f.path}?`, args: ['checkout', '--ours', '--', f.path] },
      { key: '2', label: '$(arrow-right) Choose theirs', description: 'git checkout --theirs', danger: true, confirm: `Accept theirs for ${f.path}?`, args: ['checkout', '--theirs', '--', f.path] },
      { key: 'b', label: '$(split-horizontal) Keep both / manual merge', description: 'open merge editor for both sides', run: async () => { await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(workspaceRoot(), f.path)), 'mergeEditor'); } },
      { key: 'm', label: '$(check) Mark resolved', description: 'git add', args: ['add', '--', f.path] }
    ];
  }
  private panelCommandCatalog(viewPanel: ViewPanel): GitMenuItem[] {
    const panel = this.panelForView(viewPanel);
    if (panel === 'status') return this.statusCommandCatalog();
    if (panel === 'files') return this.filesCommandCatalog(viewPanel);
    if (panel === 'hunks') return this.hunkCommandCatalog(viewPanel);
    if (panel === 'branches') return this.branchCommandCatalog();
    if (panel === 'tags') return this.tagCommandCatalog();
    if (panel === 'remotes') return this.remoteCommandCatalog();
    if (panel === 'commits') return this.commitCommandCatalog();
    if (panel === 'stash') return this.stashCommandCatalog();
    if (panel === 'conflicts') return this.conflictCommandCatalog();
    return [];
  }


  private async helpMenu(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    const items = this.panelCommandCatalog(viewPanel);

    if (!items.length) {
      vscode.window.showInformationMessage(`LazyGitVS: ${this.title(panel)} has no extra contextual commands.`);
      await this.focusPanel(this.activeViewPanel()).catch(() => undefined);
      return;
    }
    await pickGitAction(`${this.title(panel)} commands`, items.filter(item => item.key));
    await this.focusPanel(this.activeViewPanel()).catch(() => undefined);
  }
  private async stageAll() { if (!this.files.length) return; await toggleStageAll(this.files); await this.refresh(true); }
  private async commit(mode?: 'commit' | 'body' | 'amend' | 'amendNoEdit' | 'noVerify') { await commitFlow(mode); await this.refresh(true); }
  private async runCommitCommand(typed: string) {
    const item = findMenuItemByKey(this.commitCommandCatalog(), typed);
    if (!item) return;
    try {
      await executeGitMenuItem(item);
      await this.refresh(false);
    } finally {
      await this.restorePanelFocusAfterModal('commits');
    }
  }
  private async runPanelCommand(viewPanel: ViewPanel, typed: string) {
    const item = findMenuItemByKey(this.panelCommandCatalog(viewPanel), typed);
    if (!item) return;
    try {
      await executeGitMenuItem(item);
      await this.refresh(false);
    } finally {
      await this.restorePanelFocusAfterModal(viewPanel);
    }
  }
  private async stashAll() { await runGitAction('Stash all changes', ['stash', 'push']); await this.refresh(true); }
  private async runMenu(menu: () => Promise<void>, viewPanel: ViewPanel = this.activeViewPanel()) {
    try {
      await menu();
      await this.refresh(false);
    } finally {
      await this.restorePanelFocusAfterModal(viewPanel);
    }
  }
  private async discardMenu(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    try {
      if (panel === 'hunks') { const h = this.hunks[this.hunkSelected]; if (!h) return; if (this.hunkSelectionMode === 'line') { const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected]; if (line !== undefined) { if (h.staged) await applyLine(h, line); else await discardUnstagedLine(h, line); } } else await showDiscardHunkMenu(h); await this.loadHunks(false); await this.refresh(false); return; }
      if (panel === 'files') { const f = this.currentFile(); if (!f) return; await showDiscardFileMenu(f, String(this.lazygitKeymap.files.confirmDiscard ?? 'x')); await this.refresh(false); }
    } finally {
      await this.restorePanelFocusAfterModal(viewPanel);
    }
  }
  private async enterHunks() {
    const file = this.currentFile();
    if (!file) return;
    this.previousPanel = 'files'; this.activePanel = 'files'; this.ownsModeStatus = false; this.editorEditMode = false; this.editorModeFilePath = file.path; this.hunkSide = 'unstaged'; this.hunkSelectionMode = this.lazygitGui.useHunkModeInStagingView ? 'hunk' : 'line'; this.hunkSelected = 0; this.hunkLineSelected = 0; await this.loadHunks(true);
    if (!this.hunks.length && this.allHunks.some(h => h.staged)) { this.hunkSide = 'staged'; this.filterHunks(); }
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorEditMode', false);
    await this.setEditorHunkMode(true);
    this.statusLine = 'Editor HUNK mode: j/k move · space stage · a line · tab staged · d discard · Esc back';
    this.persistNavigationState();
    this.renderAll();
    await editPath(file.path);
    await this.forceEditorFocus();
    await this.revealEditorHunk();
    setTimeout(() => void this.forceEditorFocus().then(() => this.revealEditorHunk()), 80);
  }

  async editorNextHunk(delta: number) {
    if (!this.editorHunkMode) return;
    const wrap = (value: number, length: number) => length ? ((value % length) + length) % length : 0;
    if (this.hunkSelectionMode === 'line') {
      const h = this.hunks[this.hunkSelected];
      const len = h ? hunkSelectableLineIndexes(h).length : 0;
      if (len && this.hunkLineSelected + delta >= 0 && this.hunkLineSelected + delta < len) this.hunkLineSelected += delta;
      else { this.hunkSelected = wrap(this.hunkSelected + delta, this.hunks.length); this.hunkLineSelected = delta > 0 ? 0 : Math.max(0, (this.hunks[this.hunkSelected] ? hunkSelectableLineIndexes(this.hunks[this.hunkSelected]).length : 1) - 1); }
    } else {
      this.hunkSelected = wrap(this.hunkSelected + delta, this.hunks.length);
    }
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.renderAll();
    await this.revealEditorHunk();
  }
  async editorToggleHunk() {
    if (!this.editorHunkMode) return;
    if (this.readOnlyHunkMode) { this.statusLine = 'Commit diff is read-only: j/k move · a line · Esc back'; this.updateModeStatusBar(); this.renderAll(); return; }
    const h = this.hunks[this.hunkSelected]; if (!h) return;
    let preferredEditorLine: number | undefined;
    if (this.hunkSelectionMode === 'line') {
      const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected];
      if (line === undefined) return;
      preferredEditorLine = hunkChangedEditorLine(h, line);
      await applyLine(h, line);
    } else await applyHunk(h);
    await this.loadHunks(false);
    await this.refresh(false);
    if (preferredEditorLine !== undefined) this.selectNearestLineToEditorLine(preferredEditorLine);
    await this.revealEditorHunk();
  }
  async editorDiscardHunk() {
    if (!this.editorHunkMode) return;
    if (this.readOnlyHunkMode) { this.statusLine = 'Commit diff is read-only: j/k move · a line · Esc back'; this.updateModeStatusBar(); this.renderAll(); return; }
    const h = this.hunks[this.hunkSelected]; if (!h) return;
    let preferredEditorLine: number | undefined;
    if (h.staged && this.hunkSelectionMode === 'line') {
      const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected];
      if (line === undefined) return;
      preferredEditorLine = hunkChangedEditorLine(h, line);
      await applyLine(h, line);
    } else if (h.staged) { await applyHunk(h); }
    else if (this.hunkSelectionMode === 'line') {
      const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected];
      if (line === undefined) return;
      preferredEditorLine = hunkChangedEditorLine(h, line);
      const ok = await vscode.window.showWarningMessage('Discard selected line?', { modal: true }, 'Discard');
      if (ok !== 'Discard') return;
      await discardUnstagedLine(h, line);
    } else await showDiscardHunkMenu(h);
    await this.loadHunks(false);
    await this.refresh(false);
    if (preferredEditorLine !== undefined) this.selectNearestLineToEditorLine(preferredEditorLine);
    await this.revealEditorHunk();
  }
  async editorToggleHunkSelectionMode() {
    if (!this.editorHunkMode) return;
    this.hunkSelectionMode = this.hunkSelectionMode === 'hunk' ? 'line' : 'hunk';
    this.hunkLineSelected = 0;
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.updateEditorHunkDecorations();
    await this.revealEditorHunk();
  }
  async editorHunkHelp() {
    if (!this.editorHunkMode) return;
    await pickGitAction('HUNK/LINE commands', this.hunkCommandCatalog(this.activeViewPanel()).filter(item => item.key));
    await this.forceEditorFocus();
  }
  async editorToggleHunkSide() {
    if (!this.editorHunkMode) return;
    this.hunkSide = this.hunkSide === 'unstaged' ? 'staged' : 'unstaged';
    this.hunkSelected = 0; this.hunkLineSelected = 0;
    this.filterHunks();
    this.statusLine = `${this.hunkSide === 'staged' ? 'Staged' : 'Unstaged'} changes${this.hunks.length ? '' : ': none'}`;
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.updateEditorHunkDecorations();
    this.renderAll();
    await this.revealEditorHunk();
  }
  async enterEditorEditMode() {
    if (!this.editorHunkMode) return;
    this.editorEditMode = true;
    this.editorHunkMode = false;
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorHunkMode', false);
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorEditMode', true);
    await vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', false);
    await this.setVimKeyCaptureSuppressed(false);
    this.statusLine = 'EDIT mode: normal editor typing. Ctrl+Enter returns to HUNK mode.';
    this.ownsModeStatus = false;
    this.setFocusArea('editor-edit');
    this.clearEditorHunkDecorations();
    this.updateModeStatusBar();
    const filePath = this.editorModeFilePath ?? this.currentFile()?.path;
    if (filePath) await editPath(filePath);
    await this.forceEditorFocus();
    await this.placeCursorAtEditorHunkStart();
    setTimeout(() => void this.forceEditorFocus().then(() => this.placeCursorAtEditorHunkStart()), 80);
    setTimeout(() => void this.forceEditorFocus().then(() => this.placeCursorAtEditorHunkStart()), 220);
    setTimeout(() => void this.forceEditorFocus().then(() => this.placeCursorAtEditorHunkStart()), 450);
  }
  async returnToEditorHunkMode() {
    if (!this.editorEditMode) return;
    const filePath = this.editorModeFilePath ?? this.currentFile()?.path;
    if (!filePath) return;
    const visibleIndex = this.filteredFiles().findIndex(f => f.path === filePath);
    if (visibleIndex >= 0) this.selected = visibleIndex;
    this.editorEditMode = false;
    this.editorHunkMode = true;
    this.editorModeFilePath = filePath;
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorEditMode', false);
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorHunkMode', true);
    await vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', true);
    await this.setVimKeyCaptureSuppressed(true);
    this.setFocusArea('editor-hunk');
    await this.loadHunks(false);
    this.statusLine = 'Editor HUNK mode: j/k move · space stage · e edit · Ctrl+Enter edit/hunk';
    this.updateModeStatusBar();
    this.renderAll();
    await editPath(filePath);
    await this.forceEditorFocus();
    await this.revealEditorHunk();
  }
  private async forceEditorFocus() {
    try { await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'); } catch { /* ignore */ }
    const editor = vscode.window.activeTextEditor;
    if (editor) await vscode.window.showTextDocument(editor.document, editor.viewColumn ?? vscode.ViewColumn.Active, false);
  }
  async exitEditorHunkMode() {
    await this.setEditorHunkMode(false);
    this.activePanel = 'files';
    this.statusLine = '';
    this.renderAll();
    try { await vscode.commands.executeCommand(`${VIEW_IDS.files}.focus`); } catch { /* ignore */ }
  }
  private selectNearestLineToEditorLine(targetLine: number) {
    const h = this.hunks[this.hunkSelected];
    const changed = h ? hunkSelectableLineIndexes(h) : [];
    if (!h || !changed.length) { this.hunkLineSelected = 0; return; }
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    changed.forEach((diffIndex, index) => {
      const distance = Math.abs(hunkChangedEditorLine(h, diffIndex) - targetLine);
      if (distance < bestDistance) { best = index; bestDistance = distance; }
    });
    this.hunkLineSelected = best;
  }
  private async revealEditorHunk() {
    const h = this.hunks[this.hunkSelected];
    if (!h) { this.updateEditorHunkDecorations(); return; }
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const changed = hunkSelectableLineIndexes(h);
    const targetLine = changed.length ? hunkChangedEditorLine(h, changed[clamp(this.hunkLineSelected, changed.length)]) : hunkStartLine(h);
    const line = Math.min(targetLine, Math.max(0, editor.document.lineCount - 1));
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    this.updateEditorHunkDecorations();
  }
  private async placeCursorAtEditorHunkStart() {
    const h = this.hunks[this.hunkSelected];
    const editor = vscode.window.activeTextEditor;
    if (!h || !editor) return;
    const changed = hunkSelectableLineIndexes(h);
    const targetLine = changed.length ? hunkChangedEditorLine(h, changed[clamp(this.hunkLineSelected, changed.length)]) : hunkStartLine(h);
    const line = Math.min(targetLine, Math.max(0, editor.document.lineCount - 1));
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  private clearEditorHunkDecorations() {
    for (const editor of vscode.window.visibleTextEditors) this.clearEditorHunkDecorationsFor(editor);
  }
  private clearEditorHunkDecorationsFor(editor: vscode.TextEditor) {
    editor.setDecorations(this.unstagedHunkDecoration, []);
    editor.setDecorations(this.stagedHunkDecoration, []);
    editor.setDecorations(this.activeUnstagedHunkDecoration, []);
    editor.setDecorations(this.activeStagedHunkDecoration, []);
    editor.setDecorations(this.activeUnstagedLineDecoration, []);
    editor.setDecorations(this.activeStagedLineDecoration, []);
    editor.setDecorations(this.unstagedGutterDecoration, []);
    editor.setDecorations(this.stagedGutterDecoration, []);
  }
  private updateEditorHunkDecorations() {
    const editor = vscode.window.activeTextEditor;
    this.clearEditorHunkDecorations();
    if (!editor) return;
    const previewFile = this.activePanel === 'files' && !this.editorEditMode ? this.currentFile()?.path : undefined;
    const targetFile = this.editorModeFilePath ?? previewFile;
    const shouldDecorate = this.editorHunkMode;
    if (!shouldDecorate) return;
    if (targetFile && editor.document.uri.fsPath !== path.join(workspaceRoot(), targetFile)) return;
    const active = this.hunks[this.hunkSelected];
    const blockedByUnstaged = active?.staged ? rangeLineSet(this.allHunks.filter(h => !h.staged).flatMap(h => hunkChangedEditorRanges(h, editor))) : new Set<number>();
    const hunkRanges = excludeRangeLines(this.hunks.flatMap(h => hunkChangedEditorRanges(h, editor)), blockedByUnstaged);
    const rawActiveRange = active ? hunkChangedEditorRanges(active, editor) : [];
    const activeRange = active?.staged ? excludeRangeLines(rawActiveRange, blockedByUnstaged) : rawActiveRange;
    const changed = active ? hunkSelectableLineIndexes(active) : [];
    const activeLineIndex = active && changed.length ? hunkChangedEditorLine(active, changed[clamp(this.hunkLineSelected, changed.length)]) : undefined;
    const rawActiveLine = activeLineIndex !== undefined ? [editorLineRange(editor, activeLineIndex)] : [];
    const activeLine = active?.staged ? excludeRangeLines(rawActiveLine, blockedByUnstaged) : rawActiveLine;
    editor.setDecorations(this.unstagedHunkDecoration, active?.staged ? [] : hunkRanges);
    editor.setDecorations(this.stagedHunkDecoration, active?.staged ? hunkRanges : []);
    editor.setDecorations(this.activeUnstagedHunkDecoration, !active?.staged && this.hunkSelectionMode !== 'line' ? activeRange : []);
    editor.setDecorations(this.activeStagedHunkDecoration, active?.staged && this.hunkSelectionMode !== 'line' ? activeRange : []);
    editor.setDecorations(this.activeUnstagedLineDecoration, !active?.staged && this.hunkSelectionMode === 'line' ? activeLine : []);
    editor.setDecorations(this.activeStagedLineDecoration, active?.staged && this.hunkSelectionMode === 'line' ? activeLine : []);
    if (!this.editorHunkMode) return;
    const markerLine = activeLine[0]?.start.line ?? activeRange[0]?.start.line;
    const marker = active && markerLine !== undefined ? [{ range: new vscode.Range(markerLine, 0, markerLine, 0), hoverMessage: `${active.staged ? 'S staged' : 'U unstaged'} · ${this.hunkSelectionMode.toUpperCase()}` }] : [];
    editor.setDecorations(this.unstagedGutterDecoration, active?.staged ? [] : marker);
    editor.setDecorations(this.stagedGutterDecoration, active?.staged ? marker : []);
  }
  private async toggleHunkPanel() { if (this.activePanel !== 'hunks' && !this.editorHunkMode) return; this.hunkSide = this.hunkSide === 'unstaged' ? 'staged' : 'unstaged'; this.hunkSelected = 0; this.hunkLineSelected = 0; this.filterHunks(); this.updateModeStatusBar(); this.updateEditorHunkDecorations(); this.renderAll(); }
  private showPendingLineMode() { if (this.activePanel !== 'hunks' && !this.editorHunkMode) return; this.hunkSelectionMode = this.hunkSelectionMode === 'hunk' ? 'line' : 'hunk'; this.hunkLineSelected = 0; this.statusLine = this.hunkSelectionMode === 'line' ? 'Line mode' : 'Hunk mode'; this.updateModeStatusBar(); this.updateEditorHunkDecorations(); this.renderAll(); }
  private async loadHunks(showMessage: boolean) { const f = this.currentFile(); this.allHunks = f ? await hunksForFile(f, this.lazygitGit) : []; this.filterHunks(); this.hunkSelected = clamp(this.hunkSelected, this.hunks.length); if (showMessage && f?.untracked) vscode.window.showInformationMessage('LazyGitVS: untracked file has no hunks yet; space stages whole file.'); }
  private filterHunks() { this.hunks = this.allHunks.filter(h => this.hunkSide === 'staged' ? h.staged : !h.staged); }
  private async openCurrent(viewPanel: ViewPanel, preserveFocus: boolean, forceListPreview = false) {
    if (!preserveFocus) { this.ownsModeStatus = false; this.setFocusArea('viewer'); this.renderAll(); }
    const panel = this.panelForView(viewPanel);
    if ((this.editorHunkMode || this.editorEditMode) && (panel === 'files' || panel === 'hunks')) {
      if (!forceListPreview) return;
      await this.setEditorHunkMode(false);
      this.statusLine = '';
      this.activePanel = 'files';
    }
    if (panel === 'files' || panel === 'hunks') {
      const f = this.currentFile();
      if (f) {
        const previewHunks = await hunksForFile(f, this.lazygitGit).catch(() => []);
        this.allHunks = previewHunks;
        this.hunkSide = previewHunks.some(h => !h.staged) ? 'unstaged' : 'staged';
        this.filterHunks();
        this.hunkSelected = 0;
        this.hunkLineSelected = 0;
        await previewDiff(f, preserveFocus);
        const firstHunk = previewHunks[0];
        if (firstHunk) revealVisibleEditorLine(f.path, hunkStartLine(firstHunk));
        this.updateEditorHunkDecorations();
      }
    }
    else if (panel === 'branches') { const b = this.currentBranch(); if (b) await showText(`LazyGitVS Branch ${b.name}`, await git(branchLogArgs(this.lazygitGit, b.name)), preserveFocus, preserveFocus); }
    else if (panel === 'conflicts') { const f = this.currentConflict(); if (f) await previewDiff(f, preserveFocus); }
    else if (panel === 'commits') {
      if (this.commitFilesFor) {
        const f = this.commitFileItems[this.commitFileSelected];
        if (f) await showText(`LazyGitVS ${this.commitFilesFor.hash}:${f.path}`, await git(this.showArgs('--patch', '--stat', this.commitFilesFor.hash, '--', f.path)), preserveFocus, preserveFocus);
      } else {
        const c = this.currentCommit();
        if (c) await showText(`LazyGitVS Commit ${c.hash}`, await git(this.showArgs('--stat', '--patch', c.hash)), preserveFocus, preserveFocus);
      }
    }
   
    if (panel === 'stash') { const s = this.currentStash(); if (s && !preserveFocus) await git(['stash', 'show', '--stat', s.ref]).then(out => showText(`LazyGitVS ${s.ref}`, out)); }
  }

  private diffArgs(...args: string[]): string[] { return ['diff', ...gitDiffConfigArgs(this.lazygitGit, true), ...args]; }
  private showArgs(...args: string[]): string[] { return ['show', ...gitDiffConfigArgs(this.lazygitGit, true), ...args]; }
  private async enterCommit() {
    if (this.commitFilesFor) {
      const f = this.commitFileItems[this.commitFileSelected];
      if (f) return this.enterCommitFileHunkMode(f);
      return;
    }
    const c = this.currentCommit(); if (!c) return;
    this.commitFilesFor = c;
    this.commitFileItems = await commitFiles(c.hash);
    this.commitFileSelected = 0;
    this.renderAll();
    await this.openCurrent('commits', true);
  }
  private async enterCommitFileHunkMode(file: CommitFile) {
    const commit = this.commitFilesFor;
    if (!commit) return;
    const patch = await git(this.showArgs('--patch', '--stat', commit.hash, '--', file.path));
    this.allHunks = parseDiffHunks(patch, false);
    this.hunks = this.allHunks;
    this.hunkSide = 'unstaged';
    this.hunkSelectionMode = this.lazygitGui.useHunkModeInStagingView ? 'hunk' : 'line';
    this.hunkSelected = 0;
    this.hunkLineSelected = 0;
    this.editorModeFilePath = file.path;
    this.readOnlyHunkMode = true;
    this.statusLine = 'Commit HUNK mode: j/k move · a line · Esc back';
    await this.setEditorHunkMode(true);
    this.renderAll();
    await showText(`LazyGitVS ${commit.hash}:${file.path}`, patch, false, false);
    await this.forceEditorFocus();
    await this.revealEditorHunk();
  }
  private async enterStash() {
    if (this.stashFilesFor) {
      const f = this.stashFileItems[this.stashFileSelected];
      if (f && this.stashFilesFor) await showText(`LazyGitVS ${this.stashFilesFor.ref}:${f.path}`, await git(['stash', 'show', ...gitDiffConfigArgs(this.lazygitGit, true), '--patch', this.stashFilesFor.ref, '--', f.path]).catch(() => git(['stash', 'show', ...gitDiffConfigArgs(this.lazygitGit, true), '--patch', this.stashFilesFor!.ref])));
      return;
    }
    const s = this.currentStash(); if (!s) return showStashCreateMenu();
    this.stashFilesFor = s;
    this.stashFileItems = await stashFiles(s.ref);
    this.stashFileSelected = 0;
    this.renderAll();
  }

  private async clearFilterOrBack(viewPanel: ViewPanel) {
    if (this.filterText) { this.filterText = ''; this.clampSelections(); this.persistNavigationState(); this.renderAll(); await this.openCurrent(viewPanel, true).catch(() => undefined); return; }
    await this.back(viewPanel);
  }
  private async searchPanel() {
    const value = await vscode.window.showInputBox({ title: `Search ${this.title(this.activePanel)}`, value: this.filterText, prompt: 'Empty clears the filter.' });
    if (value === undefined) return;
    this.filterText = value;
    this.clampSelections();
    this.renderAll();
  }
  private async statusFilterMenu() {
    const item = await vscode.window.showQuickPick([
      { label: 'r No filter', value: 'all' as const },
      { label: 's Filter staged files', value: 'staged' as const },
      { label: 'u Filter unstaged files', value: 'unstaged' as const },
      { label: 't Filter tracked files', value: 'tracked' as const },
      { label: 'T Filter untracked files', value: 'untracked' as const },
    ], { title: 'Filtering menu' });
    if (!item) return;
    this.fileStatusFilter = item.value;
    this.selected = 0;
    this.renderAll();
  }
  private async conflictMenu() {
    const f = this.currentConflict();
    if (!f) return;
    await pickGitAction(`Merge conflicts · ${f.path}`, this.conflictCommandCatalog());
    await this.refresh(true);
  }
  private async branchMenu() {
    await pickGitAction('Branch options', this.branchCommandCatalog());
    await this.refresh(true);
  }
  private async tagMenu() {
    await pickGitAction('Tag options', this.tagCommandCatalog());
    await this.refresh(true);
  }
  private async remoteMenu() {
    await pickGitAction('Remote options', this.remoteCommandCatalog());
    await this.refresh(true);
  }
  private async commitMenu() {
    const c = this.currentCommit(); if (!c) return;
    await pickGitAction(`Commit ${c.hash}`, this.commitCommandCatalog());
    await this.refresh(true);
  }
  private async stashItemMenu() {
    const s = this.currentStash();
    await pickGitAction(s ? `${s.ref}` : 'Stash options', this.stashCommandCatalog());
    await this.refresh(true);
  }
  private async animateExplosion() {
    this.explosion = true; this.statusLine = 'Nuking working tree…'; this.renderAll();
    await new Promise(resolve => setTimeout(resolve, 850));
    this.explosion = false; this.statusLine = '💥 Nuked working tree'; this.renderAll();
  }
  private renderAll() { this.persistNavigationState(); this.statusTreeProvider?.refresh(); for (const panel of PANEL_ORDER) this.render(panel); }
  private render(viewPanel: ViewPanel) {
    const view = this.views.get(viewPanel);
    if (!view) return;
    const panel = this.panelForView(viewPanel);
    const title = this.title(panel);
    const isActiveView = this.activeViewPanel() === viewPanel;
    const showPanelSelection = isActiveView && this.focusArea === 'panel';
    const rows = this.rows(panel, showPanelSelection);
    const footer = '';
    const boom = this.explosion && (viewPanel === 'status' || viewPanel === 'files') ? '<div class="boom"><div class="bomb">💣</div><div class="blast">💥</div></div>' : '';
    try { view.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><style>
      html,body{height:100%;margin:0;}body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);line-height:1.4;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);overflow:hidden;}
      .root{position:relative;height:100%;display:flex;flex-direction:column;}.title{display:${panel === viewPanel ? 'none' : 'block'};padding:4px 8px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-sideBarSectionHeader-border);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.rows{overflow:auto;flex:1;padding:2px 0;}
      .root.wrap-staging .row.hunk{height:auto;min-height:20px;white-space:normal;align-items:start;padding-top:2px;padding-bottom:2px}.root.wrap-staging .row.hunk .path{overflow:visible;text-overflow:clip;white-space:normal}.row{display:grid;grid-template-columns:7px 36px minmax(0,1fr) minmax(0,20%);align-items:center;column-gap:2px;height:20px;padding:0 2px;box-sizing:border-box;white-space:nowrap;min-width:0;color:var(--vscode-list-foreground,var(--vscode-foreground));cursor:default;border-left:2px solid transparent;}.row.file{grid-template-columns:7px 28px minmax(0,1fr);}.row.branch{grid-template-columns:7px 18px minmax(0,1fr) minmax(0,42px);}.row.commit{grid-template-columns:7px 44px minmax(0,1fr);}.row.commit .meta{display:none}.row.sel{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);outline:1px solid var(--vscode-list-focusOutline);outline-offset:-1px;}.row.range:not(.sel){background:var(--vscode-list-inactiveSelectionBackground);}.row:not(.sel):hover{background:var(--vscode-list-hoverBackground);}.cursor{width:7px;color:var(--vscode-focusBorder);}.status{color:var(--vscode-descriptionForeground);font-size:11px;overflow:hidden;text-overflow:clip;}.path,.summary{overflow:hidden;text-overflow:ellipsis;min-width:0;}.meta{opacity:.68;margin-left:2px;overflow:hidden;text-overflow:ellipsis;justify-self:end;min-width:0;font-size:10px;}.empty{color:var(--vscode-descriptionForeground);padding:4px 6px;}
      .status-pair{display:grid;grid-template-columns:12px 12px;column-gap:2px;align-items:center;font-family:var(--vscode-editor-font-family);font-size:10px}.slot{display:inline-grid;place-items:center;width:12px;height:14px;border-radius:2px;font-size:10px;font-weight:700;line-height:1;box-sizing:border-box;color:var(--vscode-button-foreground,#fff)}.slot.empty{visibility:hidden;background:transparent;border-color:transparent;box-shadow:none}.slot.index{background:var(--vscode-gitDecoration-addedResourceForeground,#6a9955)}.slot.worktree{background:var(--vscode-gitDecoration-modifiedResourceForeground,#e06c75)}.slot.deleted,.slot.conflict{background:var(--vscode-errorForeground,#f85149)}.slot.untracked{background:var(--vscode-gitDecoration-untrackedResourceForeground,#d7ba7d);color:var(--vscode-sideBar-background,#1e1e1e)}.row.file.staged{border-left-color:var(--vscode-gitDecoration-addedResourceForeground,#6a9955)}.row.file.unstaged{border-left-color:var(--vscode-gitDecoration-modifiedResourceForeground,#e06c75)}.row.file.mixed{border-left-color:var(--vscode-gitDecoration-conflictingResourceForeground,#569cd6)}.row.file.untracked{border-left-color:var(--vscode-gitDecoration-untrackedResourceForeground,#d7ba7d)}.status-dashboard{padding:7px 9px 10px;display:flex;flex-direction:column;gap:5px;min-width:0}.lg-logo{font-family:var(--vscode-editor-font-family);font-size:20px;font-weight:800;letter-spacing:.5px;color:var(--vscode-foreground);line-height:1.05}.lg-sub{color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:4px}.lg-link{display:flex;align-items:center;gap:5px;min-height:19px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.lg-link span{overflow:hidden;text-overflow:ellipsis}.lg-repo{margin-top:6px;padding-top:6px;border-top:1px solid var(--vscode-sideBarSectionHeader-border);color:var(--vscode-descriptionForeground);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.current .path,.current .status{font-weight:700}.danger .status{color:var(--vscode-errorForeground)}.hint{color:var(--vscode-descriptionForeground);font-size:11px;line-height:1.35;padding:4px 8px 5px;border-top:1px solid var(--vscode-sideBarSectionHeader-border);background:var(--vscode-sideBar-background);}kbd{font-family:var(--vscode-editor-font-family);font-size:10px;color:var(--vscode-keybindingLabel-foreground);background:var(--vscode-keybindingLabel-background);border:1px solid var(--vscode-keybindingLabel-border);border-bottom-color:var(--vscode-keybindingLabel-bottomBorder);border-radius:3px;padding:0 3px;margin-right:2px;}.statusline{color:var(--vscode-descriptionForeground);padding-top:3px;}
      .boom{position:absolute;inset:0;display:grid;place-items:center;background:color-mix(in srgb,var(--vscode-sideBar-background) 55%,transparent);z-index:5;pointer-events:none;}.bomb{font-size:46px;animation:bomb .45s ease-in forwards}.blast{position:absolute;font-size:76px;opacity:0;animation:blast .5s ease-out .35s forwards}@keyframes bomb{to{transform:scale(.35) rotate(20deg);opacity:0}}@keyframes blast{0%{transform:scale(.2);opacity:0}35%{opacity:1}100%{transform:scale(1.6);opacity:0}}
    </style></head><body tabindex="0"><div class="root ${this.lazygitGui.wrapLinesInStagingView ? 'wrap-staging' : ''}">${boom}<div class="title">${title}</div><div class="rows">${rows}</div>${footer}</div><script>
      const vscode=acquireVsCodeApi(); const panel='${viewPanel}'; const shouldFocus=${isActiveView && !this.editorHunkMode && !this.editorEditMode && Date.now() > this.suppressWebviewAutoFocusUntil ? 'true' : 'false'}; function markPanelFocus(){vscode.postMessage({type:'focusArea',area:'panel'});} window.addEventListener('focus',markPanelFocus); document.body.addEventListener('focus',markPanelFocus); setTimeout(()=>{document.querySelector('.row.sel')?.scrollIntoView({block:'nearest'}); if(shouldFocus){ document.body.focus(); markPanelFocus(); }},0);
      const keymap=${JSON.stringify(this.lazygitKeymap)};
      const panels={1:'status',2:'files',3:'branches',4:'commits',5:'stash',6:'conflicts',7:'tags',8:'remotes'};
      function norm(e){ let key=e.key; if(key===' ')key='<space>'; else if(key==='Enter')key='<enter>'; else if(key==='Escape')key='<esc>'; else if(key==='Tab')key=e.shiftKey?'<backtab>':'<tab>'; else if(key==='Backspace')key='<backspace>'; else if(key==='ArrowDown')key='<down>'; else if(key==='ArrowUp')key='<up>'; else if(key==='ArrowLeft')key='<left>'; else if(key==='ArrowRight')key='<right>'; const mods=[]; if(e.ctrlKey)mods.push('ctrl'); if(e.altKey)mods.push('alt'); if(e.metaKey)mods.push('meta'); return mods.length?'<'+mods.join('+')+'+'+String(key).replace(/^<|>$/g,'')+'>':key; }
      function hit(e,...bindings){ const k=norm(e); return bindings.flat().filter(Boolean).some(b => String(b).toLowerCase() === k.toLowerCase()); }
      document.querySelector('.rows')?.addEventListener('click',e=>{ const row=e.target.closest('.row[data-index]'); if(!row)return; document.body.focus(); vscode.postMessage({type:'select',index:Number(row.dataset.index)}); });
      document.querySelector('.rows')?.addEventListener('dblclick',e=>{ const row=e.target.closest('.row[data-index]'); if(!row)return; document.body.focus(); vscode.postMessage({type:'select',index:Number(row.dataset.index)}); vscode.postMessage({type:'enter'}); });
      window.addEventListener('keydown',e=>{ const u=keymap.universal, f=keymap.files, m=keymap.main; const jump=Array.isArray(u.jumpToBlock)?u.jumpToBlock:[]; const jumpIndex=jump.indexOf(e.key); const jumpPanel = jumpIndex>=0 ? panels[String(jumpIndex+1)] : panels[e.key]; if(jumpPanel){e.preventDefault();vscode.postMessage({type:'switchPanel',panel:jumpPanel});return;}
        if(e.key==='?'){e.preventDefault();vscode.postMessage({type:'helpMenu'});return;} if(hit(e,u.focusMainView)){e.preventDefault();vscode.postMessage({type:'focusMainView'});return;} if(e.shiftKey&&e.key==='ArrowDown'){e.preventDefault();vscode.postMessage({type:'rangeMove',delta:1});return;} if(e.shiftKey&&e.key==='ArrowUp'){e.preventDefault();vscode.postMessage({type:'rangeMove',delta:-1});return;} if(e.key==='ArrowDown'){e.preventDefault();vscode.postMessage({type:'move',delta:1});return;} if(e.key==='ArrowUp'){e.preventDefault();vscode.postMessage({type:'move',delta:-1});return;} if(hit(e,u.prevPage)){e.preventDefault();vscode.postMessage({type:'move',delta:-10});return;} if(hit(e,u.nextPage)){e.preventDefault();vscode.postMessage({type:'move',delta:10});return;} if(hit(e,u.gotoTop,u.gotoTopAlt)){e.preventDefault();vscode.postMessage({type:'moveTo',position:'top'});return;} if(hit(e,u.gotoBottom,u.gotoBottomAlt)){e.preventDefault();vscode.postMessage({type:'moveTo',position:'bottom'});return;} if(hit(e,u.toggleRangeSelect)){e.preventDefault();vscode.postMessage({type:'rangeToggle'});return;} if(hit(e,u.startSearch)){e.preventDefault();vscode.postMessage({type:'search'});return;} if(panel==='files'&&hit(e,f.openStatusFilter)){e.preventDefault();vscode.postMessage({type:'statusFilter'});return;} if(hit(e,u.nextItem,u.nextItemAlt)){e.preventDefault();vscode.postMessage({type:'move',delta:1});return;} if(hit(e,u.prevItem,u.prevItemAlt)){e.preventDefault();vscode.postMessage({type:'move',delta:-1});return;}
        if(hit(e,u.nextBlock,u.nextBlockAlt,u.nextBlockAlt2)){e.preventDefault();vscode.postMessage({type:'moveBlock',delta:1});return;} if(hit(e,u.prevBlock,u.prevBlockAlt,u.prevBlockAlt2)){e.preventDefault();vscode.postMessage({type:'moveBlock',delta:-1});return;}
        const c=keymap.commits; if(panel==='commits'&&hit(e,c.checkoutCommit,c.copyCommitAttributeToClipboard,c.newBranch,c.renameCommit,c.amendToCommit,c.createFixupCommit,c.markCommitAsFixup,c.cherryPickCopy,c.revertCommit,c.createTag,c.tagCommit,c.viewResetOptions,c.openInBrowser,c.openLogMenu)){e.preventDefault();vscode.postMessage({type:'commitAction',key:norm(e)});return;}
        const b=keymap.branches, st=keymap.stash; if(panel==='status'&&['o','e','a','A','u','<enter>'].includes(norm(e))){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='hunks'&&hit(e,u.select,u.togglePanel,u.remove,m.toggleSelectHunk)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='branches'&&hit(e,u.select,u.new,u.remove,b.checkoutBranchByName,b.checkoutPreviousBranch,b.renameBranch,b.mergeIntoCurrentBranch,b.rebaseBranch,b.forceCheckoutBranch,b.setUpstream,b.fastForward,b.createTag)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='stash'&&hit(e,u.goInto,st.apply,st.popStash,st.newBranch,st.renameStash,u.remove)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='tags'&&hit(e,u.select,u.new,u.remove,b.createTag,b.pushTag)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='remotes'&&hit(e,u.new,u.edit,u.remove,b.fetchRemote,b.addForkRemote)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='conflicts'&&(hit(e,u.goInto,u.openFile)||['1','2','b','m'].includes(norm(e)))){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;}
        if(hit(e,u.select)){e.preventDefault();vscode.postMessage({type:'toggle'});return;} if(panel==='status'&&hit(e,u.goInto)){e.preventDefault();vscode.postMessage({type:'repoMenu'});return;} if(hit(e,u.goInto)){e.preventDefault();vscode.postMessage({type:'enter'});return;} if(hit(e,u.openFile)){e.preventDefault();vscode.postMessage({type:'openFile'});return;} if(hit(e,u.edit)){e.preventDefault();vscode.postMessage({type:'editFile'});return;} if(panel==='files'&&hit(e,f.copyFileInfoToClipboard)){e.preventDefault();vscode.postMessage({type:'copyInfo'});return;} if(panel==='files'&&hit(e,f.copyPath,u.copyToClipboard)){e.preventDefault();vscode.postMessage({type:'copyPath'});return;} if(panel!=='files'&&hit(e,u.copyToClipboard)){e.preventDefault();vscode.postMessage({type:'copyInfo'});return;} if(panel==='files'&&hit(e,f.ignoreFile)){e.preventDefault();vscode.postMessage({type:'ignoreMenu'});return;} if(panel==='files'&&hit(e,f.fetch)){e.preventDefault();vscode.postMessage({type:'fetch'});return;}
        if(panel==='files'&&hit(e,f.toggleStagedAll)){e.preventDefault();vscode.postMessage({type:'stageAll'});return;} if(panel==='files'&&hit(e,f.commitChangesWithoutHook)){e.preventDefault();vscode.postMessage({type:'commitNoVerify'});return;} if(panel==='files'&&hit(e,f.amendLastCommit)){e.preventDefault();vscode.postMessage({type:'amendLastCommit'});return;} if(panel==='files'&&hit(e,f.commitChangesWithEditor)){e.preventDefault();vscode.postMessage({type:'commitWithEditor'});return;} if((panel==='files'||panel==='status')&&hit(e,f.commitChanges)){e.preventDefault();vscode.postMessage({type:'commit'});return;} if(hit(e,u.pushFiles,u.push)){e.preventDefault();vscode.postMessage({type:'pushMenu'});return;} if(hit(e,u.pullFiles,u.pull)){e.preventDefault();vscode.postMessage({type:'pullMenu'});return;}
        if((panel==='files'||panel==='status')&&hit(e,f.stashAllChanges)){e.preventDefault();vscode.postMessage({type:'stashAll'});return;} if((panel==='files'||panel==='status')&&hit(e,f.viewStashOptions)){e.preventDefault();vscode.postMessage({type:'stashMenu'});return;} if(hit(e,u.remove)){e.preventDefault();vscode.postMessage({type:'discardMenu'});return;} if((panel==='files'||panel==='status')&&hit(e,f.viewResetOptions)){e.preventDefault();vscode.postMessage({type:'resetMenu'});return;}
        if(hit(e,u.togglePanel)){e.preventDefault();vscode.postMessage({type:'togglePanel'});return;} if(hit(e,u.return)){e.preventDefault();vscode.postMessage({type:'back'});return;} if(e.key==='Backspace'){e.preventDefault();vscode.postMessage({type:'clearFilter'});return;} if(hit(e,u.refresh,f.refreshFiles)){e.preventDefault();vscode.postMessage({type:'refresh'});return;} if(hit(e,u.quit)){e.preventDefault();vscode.postMessage({type:'close'});return;} if(panel==='hunks'&&hit(e,m.toggleSelectHunk)){e.preventDefault();vscode.postMessage({type:'toggleHunkSelection'});return;} });
    </script></body></html>`; } catch { this.views.delete(viewPanel); }
  }
  private title(panel: Panel): string { if (panel === 'hunks') return `${this.hunkSide === 'staged' ? 'Staged' : 'Unstaged'} changes · ${escapeHtml(this.files[this.selected]?.path ?? '')}`; if (panel === 'commits' && this.commitFilesFor) return `Commit files · ${this.commitFilesFor.hash}`; if (panel === 'stash' && this.stashFilesFor) return `Stash files · ${this.stashFilesFor.ref}`; return ({ status: 'Status', files: 'Files', branches: 'Branches', commits: 'Commits', stash: 'Stash', conflicts: 'Conflicts', tags: 'Tags', remotes: 'Remotes', hunks: 'Hunks' } as Record<Panel,string>)[panel]; }
  private help(panel: Panel): string {
    const u = this.lazygitKeymap.universal, f = this.lazygitKeymap.files, m = this.lazygitKeymap.main;
    const kb = (value: string | string[] | undefined) => `<kbd>${escapeHtml(Array.isArray(value) ? value.join('/') : String(value ?? ''))}</kbd>`;
    const common = `${this.lazygitGui.showPanelJumps ? `${kb(u.jumpToBlock)} views · ` : ''}${kb([String(u.prevItemAlt), String(u.nextItemAlt)])} move · ${kb(String(u.startSearch))} search · ${kb(String(u.goInto))} action · ${kb([String(u.refresh), String(f.refreshFiles)])} refresh<br>`;
    if (panel === 'status') return common + `${kb(String(u.goInto))} files · ${kb(String(u.pushFiles ?? u.push))}/${kb(String(u.pullFiles ?? u.pull))} push/pull · ${kb(String(f.stashAllChanges))} stash · ${kb(String(f.viewResetOptions))} nuke`;
    if (panel === 'hunks') return common + `${kb(String(u.select))} stage/unstage · ${kb(String(u.remove))} discard/unstage · ${kb([String(u.prevBlockAlt), String(u.nextBlockAlt)])} hunk/line · ${kb(String(u.togglePanel))} staged/unstaged · ${kb(String(m.toggleSelectHunk))} line/hunk`;
    if (panel === 'files') return common + `${kb(String(u.select))} stage · ${kb(String(u.goInto))} hunks · ${kb(String(f.openStatusFilter))} filter · ${kb(String(f.ignoreFile))} ignore · ${kb(String(f.fetch))} fetch · ${kb(String(f.commitChanges))} commit · ${kb(String(u.remove))}/${kb(String(f.viewResetOptions))} discard/nuke · ${kb(String(f.toggleStagedAll))} all`;
    if (panel === 'branches') return `${this.lazygitGui.showPanelJumps ? `${kb(u.jumpToBlock)} views · ` : ''}${kb([String(u.prevItemAlt), String(u.nextItemAlt)])} move · ${kb(String(u.startSearch))} search · ${kb(String(u.focusMainView))} focus log · ${kb([String(u.refresh), String(f.refreshFiles)])} refresh<br>${kb(String(u.select))} checkout · ${kb(String(u.pushFiles ?? u.push))}/${kb(String(u.pullFiles ?? u.pull))} push/pull`;
    if (panel === 'tags') return common + `${kb(String(u.select))} checkout · ${kb(String(u.new))} branch · ${kb(String(this.lazygitKeymap.branches.createTag))} create · ${kb(String(this.lazygitKeymap.branches.pushTag))} push`;
    if (panel === 'remotes') return common + `${kb(String(this.lazygitKeymap.branches.fetchRemote))} fetch · ${kb(String(u.new))} add · ${kb(String(u.edit))} edit URL · ${kb(String(u.remove))} remove`;
    if (panel === 'commits') { const c = this.lazygitKeymap.commits; return common + `${kb(String(u.goInto))} files · ${kb(String(c.checkoutCommit))} checkout · ${kb(String(c.copyCommitAttributeToClipboard ?? u.copyToClipboard))} copy · ${kb(String(c.viewResetOptions))} reset · ${kb(String(c.revertCommit))}/${kb(String(c.createTag ?? c.tagCommit))} revert/tag`; }

    if (panel === 'stash') return common + `${kb(String(u.goInto))} apply/pop/drop/show · ${kb(String(f.stashAllChanges))} create stash`;
    return common + `${kb([String(u.goInto), String(u.openFile)])} open conflict · resolve with VS Code`;
  }
  private fileDisplayPath(filePath: string): string { return this.lazygitGui.showFileTree ? filePath.replace(/\//g, ' › ') : filePath; }
  private rows(panel: Panel, active: boolean): string {
    if (panel === 'status') return this.renderStatus(active);
    if (panel === 'files') { const files = this.filteredFiles(); return files.length ? files.map((f,i)=>fileRow(active && i===this.selected, `${statusClass(f)} ${this.fileRangeSelected.has(i) ? 'range' : ''}`, f, this.fileDisplayPath(f.path), i)).join('') : '<div class="empty">No files for current filter.</div>'; }
    if (panel === 'hunks') return this.renderHunks(active);
    if (panel === 'branches') { const branches = this.filteredBranches(); return branches.length ? branches.map((b,i)=>row(active && i===this.branchSelected, `branch ${b.current ? 'current' : ''} ${b.kind}`, `${b.current ? '●' : ' '} ${b.kind === 'remote' ? 'R' : b.kind === 'tag' ? 'T' : b.kind === 'worktree' ? 'W' : 'L'}`, b.label, b.kind === 'remote' ? 'remote' : b.kind === 'tag' ? 'tag' : b.kind === 'worktree' ? 'worktree' : (b.upstream || 'local'), i)).join('') : '<div class="empty">No branches.</div>'; }
    if (panel === 'tags') { const tags = this.filteredTags(); return tags.length ? tags.map((t,i)=>row(active && i===this.tagSelected, 'tag', 'T', t.name, t.date || t.subject, i)).join('') : '<div class="empty">No tags. Press T to create one.</div>'; }
    if (panel === 'remotes') { const remotes = this.filteredRemotes(); return remotes.length ? remotes.map((r,i)=>row(active && i===this.remoteSelected, 'remote', 'R', r.name, r.fetchUrl || r.pushUrl, i)).join('') : '<div class="empty">No remotes. Press n to add one.</div>'; }
    if (panel === 'commits') {
      if (this.commitFilesFor) return this.commitFileItems.length ? this.commitFileItems.map((f,i)=>row(active && i===this.commitFileSelected, 'commit', f.status, f.path, this.commitFilesFor!.hash, i)).join('') : '<div class="empty">No files in commit.</div>';
      const commits = this.filteredCommits(); return commits.length ? commits.map((c,i)=>row(active && i===this.commitSelected, 'commit', c.hash, c.subject, compactRefs(c.refs), i)).join('') : '<div class="empty">No commits.</div>';
    }

    if (panel === 'stash') {
      if (this.stashFilesFor) return this.stashFileItems.length ? this.stashFileItems.map((f,i)=>row(active && i===this.stashFileSelected, '', f.status, f.path, this.stashFilesFor!.ref, i)).join('') : '<div class="empty">No files in stash.</div>';
      const stashes = this.filteredStashes(); return stashes.length ? stashes.map((s,i)=>row(active && i===this.stashSelected, '', s.ref, s.message, '', i)).join('') : '<div class="empty">No stashes. Press s to create one.</div>';
    }
    const conflicts = this.filteredConflicts(); return conflicts.length ? conflicts.map((f,i)=>row(active && i===this.conflictSelected, 'danger', f.xy, f.path, '', i)).join('') : '<div class="empty">No conflicts.</div>';
  }
  private renderHunks(active: boolean): string {
    const f = this.currentFile(); if (!f) return '<div class="empty">No file selected.</div>'; if (f.untracked) return '<div class="empty">Untracked file. Back to Files and space stages whole file.</div>';
    if (this.hunkSelectionMode === 'line') {
      const h = this.hunks[this.hunkSelected]; if (!h) return '<div class="empty">No hunks for this side.</div>';
      const changed = hunkSelectableLineIndexes(h);
      const body = hunkBodyLines(h);
      return body.map((line, i) => { const changedIndex = changed.indexOf(i); return row(active && changed[this.hunkLineSelected] === i, `hunk ${line.startsWith('+') ? 'staged' : line.startsWith('-') ? 'unstaged' : ''}`, line.slice(0, 1) || ' ', line.slice(1), '', changedIndex >= 0 ? changedIndex : undefined); }).join('');
    }
    return this.hunks.length ? this.hunks.map((h,i)=>row(active && i===this.hunkSelected, `hunk ${h.staged?'staged':'unstaged'}`, h.staged?'S':'M', h.summary, '', i)).join('') : '<div class="empty">No hunks for this side.</div>';
  }
  private renderStatus(active: boolean): string {
    return row(active, 'status-repo', 'enter', path.basename(workspaceRoot()), '', 0);
  }
}
function clamp(index: number, length: number): number { return length ? Math.max(0, Math.min(length - 1, index)) : 0; }
function row(sel: boolean, klass: string, status: string, main: string, meta = '', index?: number): string { const data = typeof index === 'number' ? ` data-index="${index}"` : ''; return `<div class="row ${sel ? 'sel' : ''} ${klass}"${data}><span class="cursor">${sel ? '›' : ' '}</span><span class="status">${escapeHtml(status)}</span><span class="path">${escapeHtml(main)}</span>${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}</div>`; }
function fileRow(sel: boolean, klass: string, file: ChangedFile, main: string, index: number): string { return `<div class="row file ${sel ? 'sel' : ''} ${klass}" data-index="${index}" title="${escapeHtml(file.xy)} · ${escapeHtml(fileStateLabel(file))} · ${escapeHtml(file.path)}"><span class="cursor">${sel ? '›' : ' '}</span><span class="status">${fileStatusHtml(file)}</span><span class="path">${escapeHtml(main)}</span></div>`; }
function escapeHtml(s: string): string { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
function stripAnsi(s: string): string { return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''); }
async function showText(title: string, content: string, preserveFocus = false, preview = false) {
  const uri = virtualPreviewProvider.set(title, stripAnsi(content));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(doc, 'diff');
  await vscode.window.showTextDocument(doc, { preview, preserveFocus, viewColumn: vscode.ViewColumn.Active });
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('lazygitvs-empty', new EmptyProvider()));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('lazygitvs-preview', virtualPreviewProvider));
  const app = new LazyGitVSController(context);
  const statusProvider = new StatusTreeProvider(app);
  const statusTree = vscode.window.createTreeView(VIEW_IDS.status, { treeDataProvider: statusProvider });
  app.attachStatusTree(statusProvider, statusTree);
  context.subscriptions.push(statusTree, statusProvider);
  for (const panel of PANEL_ORDER.filter(panel => panel !== 'status')) context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_IDS[panel], new PanelViewProvider(app, panel), { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.changedFiles', showChangedFilesQuickPick));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.statusRecentRepos', () => app.openRecentRepos()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.statusEnter', (repoPath?: string) => app.statusEnter(repoPath)));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.openDashboard', () => app.focus()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.closeDashboard', () => app.close()));
  PANEL_ORDER.forEach((panel, index) => {
    context.subscriptions.push(vscode.commands.registerCommand(`lazygitvs.focusPanel${index + 1}`, () => app.focusNumberPanel(index + 1)));
  });
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkNext', () => app.editorNextHunk(1)));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkPrev', () => app.editorNextHunk(-1)));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkToggle', () => app.editorToggleHunk()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkEdit', () => app.enterEditorEditMode()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkReturn', () => app.returnToEditorHunkMode()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkToggleMode', () => app.editorToggleHunkSelectionMode()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkToggleSide', () => app.editorToggleHunkSide()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkHelp', () => app.editorHunkHelp()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkDiscard', () => app.editorDiscardHunk()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkExit', () => app.exitEditorHunkMode()));
  vscode.commands.getCommands(true).then(commands => {
    const hasVSCodeVim = commands.includes('extension.vim_tab');
    app.setVSCodeVimPresent(hasVSCodeVim);
    if (!hasVSCodeVim) {
      context.subscriptions.push(vscode.commands.registerCommand('extension.vim_tab', () => app.editorToggleHunkSide()));
    }
  });
}

export function deactivate() {}
