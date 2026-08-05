import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { cloneGitConfig } from './lazygitConfig';
import { git, workspaceRoot, type ChangedFile, type Commit, type CommitFile, type ConflictFile, type LazyGitGitRuntimeConfig, type Stash, type StashFile } from './gitService';
import { gitDiffConfigArgs } from './gitActions';
import { EMPTY_PREVIEW_SCHEME, VIRTUAL_PREVIEW_SCHEME } from './previewDocuments';
import { commitPatchPreviewHtml } from './richPreview';
import { PreviewRequestGate } from './previewRequestGate';
import { LatestWinsAsyncGate } from './previewRequestGate';

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

export function branchLogArgs(gitConfig: LazyGitGitRuntimeConfig, branchName: string): string[] {
  const template = typeof gitConfig.branchLogCmd === 'string' && gitConfig.branchLogCmd.trim()
    ? gitConfig.branchLogCmd
    : cloneGitConfig().branchLogCmd;
  const argv = shellWords(template.replace(/{{\s*branchName\s*}}/g, branchName));
  return argv[0] === 'git' ? argv.slice(1) : argv;
}

export async function closeLazyGitVSPreviewTabsIfSingle() {
  const mode = vscode.workspace.getConfiguration('lazygitvs').get<'single' | 'multiple'>('previewTabs', 'single');
  if (mode !== 'single') return;
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => {
    const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
    if (input?.uri?.scheme === VIRTUAL_PREVIEW_SCHEME) return true;
    if (input?.viewType === 'lazygitvs.preview') return true;
    if (input instanceof vscode.TabInputWebview && tab.label.startsWith('LazyGitVS:')) return true;
    return input instanceof vscode.TabInputTextDiff && tab.label.startsWith('LazyGitVS:');
  });
  if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
}

async function closeRichPreviewPanels() {
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => {
    const input = tab.input as { viewType?: string } | undefined;
    return input?.viewType === 'lazygitvs.preview';
  });
  if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
}

export async function previewDiff(file: ChangedFile | ConflictFile, preserveFocus = true, shouldOpen = () => true) {
  await closeLazyGitVSPreviewTabsIfSingle();
  if (!shouldOpen()) return false;
  const root = workspaceRoot();
  const right = vscode.Uri.file(path.join(root, file.path));
  const untracked = 'untracked' in file && file.untracked;
  const left = untracked ? vscode.Uri.parse(`${EMPTY_PREVIEW_SCHEME}:${encodeURIComponent(file.path)}`) : right.with({ scheme: 'git', query: JSON.stringify({ path: right.fsPath, ref: 'HEAD' }) });
  await vscode.commands.executeCommand('vscode.diff', left, right, `LazyGitVS: ${file.path}`, { preview: preserveFocus, preserveFocus, viewColumn: vscode.ViewColumn.Active });
  return true;
}

export async function previewCommitFileDiff(commit: Commit, file: CommitFile, preserveFocus = true, shouldOpen: () => boolean = () => true, capturedRepoPath?: string) {
  const publication = await commitFilePreviewPublication.request(async isCurrent => {
    await closeLazyGitVSPreviewTabsIfSingle();
    if (!isCurrent() || !shouldOpen()) return false;
    const root = capturedRepoPath ?? workspaceRoot();
    if (!isCurrent() || !shouldOpen()) return false;
    const beforePath = file.oldPath ?? file.path;
    const afterPath = file.path;
    const before = vscode.Uri.file(path.join(root, beforePath)).with({ scheme: 'git', query: JSON.stringify({ path: path.join(root, beforePath), ref: `${commit.hash}^` }) });
    const after = vscode.Uri.file(path.join(root, afterPath)).with({ scheme: 'git', query: JSON.stringify({ path: path.join(root, afterPath), ref: commit.hash }) });
    const empty = vscode.Uri.parse(`${EMPTY_PREVIEW_SCHEME}:${encodeURIComponent(`${commit.hash}:${file.path}:empty`)}`);
    const status = file.status[0];
    const left = status === 'A' ? empty : before;
    const right = status === 'D' ? empty : after;
    if (!isCurrent() || !shouldOpen()) return false;
    await vscode.commands.executeCommand('vscode.diff', left, right, `LazyGitVS: ${file.path}`, { preview: preserveFocus, preserveFocus, viewColumn: vscode.ViewColumn.Active });
    return isCurrent() && shouldOpen();
  });
  return publication === true;
}

export async function previewStashFileDiff(stash: Stash, file: StashFile, preserveFocus = true) {
  await closeLazyGitVSPreviewTabsIfSingle();
  const root = workspaceRoot();
  const beforePath = file.oldPath ?? file.path;
  const afterPath = file.path;
  const before = vscode.Uri.file(path.join(root, beforePath)).with({ scheme: 'git', query: JSON.stringify({ path: path.join(root, beforePath), ref: `${stash.ref}^1` }) });
  const after = vscode.Uri.file(path.join(root, afterPath)).with({ scheme: 'git', query: JSON.stringify({ path: path.join(root, afterPath), ref: stash.ref }) });
  const empty = vscode.Uri.parse(`${EMPTY_PREVIEW_SCHEME}:${encodeURIComponent(`${stash.ref}:${file.path}:empty`)}`);
  const status = file.status[0];
  const left = status === 'A' ? empty : before;
  const right = status === 'D' ? empty : after;
  await vscode.commands.executeCommand('vscode.diff', left, right, `LazyGitVS: ${file.path}`, { preview: preserveFocus, preserveFocus, viewColumn: vscode.ViewColumn.Active });
}

const richPreviewRequests = new PreviewRequestGate();
const commitFilePreviewPublication = new LatestWinsAsyncGate();

export async function reconcileCommitFilePreviewPublication(): Promise<void> {
  await commitFilePreviewPublication.request(async isCurrent => {
    if (isCurrent()) await closeLazyGitVSPreviewTabsIfSingle();
  });
}

function richPreviewShouldOpen(key: string): () => boolean {
  const request = richPreviewRequests.begin(key);
  return () => richPreviewRequests.isCurrent(request);
}

let singleRichPreviewPanel: vscode.WebviewPanel | undefined;
let singleRichPreviewCreation: Promise<void> | undefined;

function recordRichPreviewPanelLifecycle(action: 'created' | 'reused', title: string) {
  const report = process.env.LGVS_DOGFOOD_BOUNDARY_REPORT;
  if (!report) return;
  try { fs.appendFileSync(report, `${JSON.stringify({ at: new Date().toISOString(), event: 'richPreviewPanel', action, title })}\n`, { mode: 0o600 }); } catch { /* dogfood diagnostics must not affect product behavior */ }
}

function createRichPreviewPanel(title: string, html: string, preserveFocus: boolean) {
  const panel = vscode.window.createWebviewPanel(
    'lazygitvs.preview',
    title,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus },
    { enableScripts: false, retainContextWhenHidden: false }
  );
  panel.webview.html = html;
  recordRichPreviewPanelLifecycle('created', title);
  return panel;
}

function reuseRichPreviewPanel(panel: vscode.WebviewPanel, title: string, html: string, preserveFocus: boolean) {
  panel.title = title;
  panel.webview.html = html;
  panel.reveal(vscode.ViewColumn.Active, preserveFocus);
  recordRichPreviewPanelLifecycle('reused', title);
  return panel;
}

async function showRichPreviewPanel(title: string, html: string, preserveFocus: boolean, shouldOpen: () => boolean) {
  if (!shouldOpen()) return;
  if (singleRichPreviewPanel) return reuseRichPreviewPanel(singleRichPreviewPanel, title, html, preserveFocus);
  if (singleRichPreviewCreation) {
    await singleRichPreviewCreation;
    if (!shouldOpen()) return;
    if (singleRichPreviewPanel) return reuseRichPreviewPanel(singleRichPreviewPanel, title, html, preserveFocus);
    return showRichPreviewPanel(title, html, preserveFocus, shouldOpen);
  }

  const creation = (async () => {
    await closeRichPreviewPanels();
    if (!shouldOpen()) return;
    const panel = createRichPreviewPanel(title, html, preserveFocus);
    singleRichPreviewPanel = panel;
    panel.onDidDispose(() => { if (singleRichPreviewPanel === panel) singleRichPreviewPanel = undefined; });
  })();
  singleRichPreviewCreation = creation;
  try { await creation; } finally { if (singleRichPreviewCreation === creation) singleRichPreviewCreation = undefined; }
  return singleRichPreviewPanel;
}

export async function showCommitPreview(commit: Commit, gitConfig: LazyGitGitRuntimeConfig = cloneGitConfig(), preserveFocus = true) {
  const shouldOpen = richPreviewShouldOpen(`commit:${commit.hash}`);
  const patch = await git(['show', ...gitDiffConfigArgs(gitConfig, true), '--stat', '--patch', commit.hash]);
  if (!shouldOpen()) return;
  await showRichPreviewPanel(`LazyGitVS: Commit ${commit.hash}`, commitPatchPreviewHtml({ title: `Commit ${commit.hash}`, hash: commit.hash, subject: commit.subject, author: commit.author, relativeDate: commit.relativeDate }, patch), preserveFocus, shouldOpen);
}

export async function showStashPreview(stash: Stash, gitConfig: LazyGitGitRuntimeConfig = cloneGitConfig(), preserveFocus = true) {
  const shouldOpen = richPreviewShouldOpen(`stash:${stash.ref}`);
  const patch = await git(['stash', 'show', ...gitDiffConfigArgs(gitConfig, true), '--stat', '--patch', stash.ref]);
  if (!shouldOpen()) return;
  await showRichPreviewPanel(`LazyGitVS: ${stash.ref}`, commitPatchPreviewHtml({ title: stash.ref, subject: stash.message, subtitle: stash.ref }, patch), preserveFocus, shouldOpen);
}

export function revealVisibleEditorLine(filePath: string, line: number) {
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

export async function editPath(filePath: string): Promise<vscode.TextEditor> {
  await closeLazyGitVSPreviewTabsIfSingle();
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspaceRoot(), filePath)));
  return vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
}

export async function focusOpenedEditor(editor: vscode.TextEditor, shouldContinue: () => boolean = () => true): Promise<void> {
  const expectedUri = editor.document.uri.toString();
  const focus = async (requireCurrent: boolean) => {
    if (!shouldContinue() || (requireCurrent && vscode.window.activeTextEditor?.document.uri.toString() !== expectedUri)) return;
    try { await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'); } catch { /* ignore */ }
    if (!shouldContinue() || (requireCurrent && vscode.window.activeTextEditor?.document.uri.toString() !== expectedUri)) return;
    await vscode.window.showTextDocument(editor.document, editor.viewColumn ?? vscode.ViewColumn.Active, false);
  };
  await focus(false);
  for (const delay of [80, 220, 450]) setTimeout(() => void focus(true), delay);
}

export async function openPath(filePath: string) {
  await vscode.env.openExternal(vscode.Uri.file(path.join(workspaceRoot(), filePath)));
}

export async function copyText(text: string, label = 'Copied', shouldNotify?: () => boolean) {
  if (!shouldNotify) {
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(`LazyGitVS: ${label}.`);
    return;
  }
  const previous = await vscode.env.clipboard.readText();
  if (!shouldNotify()) return;
  await vscode.env.clipboard.writeText(text);
  if (!shouldNotify()) {
    if (await vscode.env.clipboard.readText() === text) await vscode.env.clipboard.writeText(previous);
    return;
  }
  vscode.window.showInformationMessage(`LazyGitVS: ${label}.`);
}

export async function appendIgnore(fileName: '.gitignore' | '.git/info/exclude', pattern: string) {
  const filePath = path.join(workspaceRoot(), fileName);
  const edit = new vscode.WorkspaceEdit();
  let existing = '';
  try { existing = (await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))).toString(); } catch { /* create */ }
  const line = existing.endsWith('\n') || !existing ? pattern + '\n' : '\n' + pattern + '\n';
  edit.insert(vscode.Uri.file(filePath), new vscode.Position(existing.split(/\r?\n/).length, 0), line);
  await vscode.workspace.applyEdit(edit);
}

export async function commitFlow(requested?: 'commit' | 'body' | 'amend' | 'amendNoEdit' | 'noVerify') {
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
