import * as vscode from 'vscode';
import * as path from 'path';
import { cloneGitConfig } from './lazygitConfig';
import { git, workspaceRoot, type ChangedFile, type ConflictFile, type LazyGitGitRuntimeConfig } from './gitService';
import { EMPTY_PREVIEW_SCHEME } from './previewDocuments';

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
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.label.startsWith('LazyGitVS:'));
  if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
}

export async function previewDiff(file: ChangedFile | ConflictFile, preserveFocus = true) {
  await closeLazyGitVSPreviewTabsIfSingle();
  const root = workspaceRoot();
  const right = vscode.Uri.file(path.join(root, file.path));
  const untracked = 'untracked' in file && file.untracked;
  const left = untracked ? vscode.Uri.parse(`${EMPTY_PREVIEW_SCHEME}:${encodeURIComponent(file.path)}`) : right.with({ scheme: 'git', query: JSON.stringify({ path: right.fsPath, ref: 'HEAD' }) });
  await vscode.commands.executeCommand('vscode.diff', left, right, `LazyGitVS: ${file.path}`, { preview: preserveFocus, preserveFocus, viewColumn: vscode.ViewColumn.Active });
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

export async function openPath(filePath: string) {
  await vscode.env.openExternal(vscode.Uri.file(path.join(workspaceRoot(), filePath)));
}

export async function copyText(text: string, label = 'Copied') {
  await vscode.env.clipboard.writeText(text);
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
