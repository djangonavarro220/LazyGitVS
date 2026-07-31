import * as vscode from 'vscode';
import { changedFiles, type ChangedFile } from './gitService';
import { previewDiff } from './workspaceActions';
import { statusIcon } from './viewFormatting';

export async function showChangedFilesQuickPick() {
  const files = await changedFiles();
  if (!files.length) return vscode.window.showInformationMessage('LazyGitVS: clean working tree.');
  const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { file: ChangedFile }>();
  picker.title = 'LazyGitVS Changed Files';
  picker.placeholder = 'Move to preview diff. Enter opens diff. Use dashboard for space stage/unstage.';
  picker.items = files.map(file => ({ label: `${statusIcon(file)} ${file.path}`, description: file.staged ? 'staged' : 'unstaged', file }));
  picker.onDidChangeActive(items => { if (items[0]) previewDiff(items[0].file, true).catch(error => vscode.window.showErrorMessage(error.message)); });
  picker.onDidAccept(() => { const item = picker.activeItems[0]; if (item) previewDiff(item.file, false); picker.hide(); });
  picker.onDidHide(() => picker.dispose());
  picker.show();
}
