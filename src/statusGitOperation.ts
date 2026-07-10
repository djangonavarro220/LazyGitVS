import * as vscode from 'vscode';
import { detectGitOperationState, type GitOperationAction, type GitOperationState } from './gitOperationState';
import { git } from './gitService';
import { pickGitAction } from './gitMenus';

export async function showGitOperationOptions(repoPath: string, isAvailable: () => boolean, onDone: () => Promise<void>) {
  if (!isAvailable()) return;
  const state = detectGitOperationState(repoPath);
  if (!state) return;
  await pickGitAction(state.menuTitle, state.actions.map(action => ({
    key: action.key,
    label: action.label,
    run: async () => runGitOperationAction(repoPath, isAvailable, state, action, onDone)
  })));
}

async function runGitOperationAction(repoPath: string, isAvailable: () => boolean, openedState: GitOperationState, action: GitOperationAction, onDone: () => Promise<void>) {
  if (!isAvailable()) throw new Error('The selected Status repository is no longer available. Refresh and try again.');
  const current = detectGitOperationState(repoPath);
  if (!current || current.kind !== openedState.kind || current.identity !== openedState.identity || !current.actions.some(candidate => candidate.command === action.command)) {
    throw new Error('This Git operation changed while the menu was open. Refresh and try again.');
  }
  if (action.requiresConfirmation) {
    const confirmed = await vscode.window.showWarningMessage(`Are you sure you want to abort the current ${current.kind}?`, { modal: true }, 'Abort');
    if (confirmed !== 'Abort') return;
    const afterConfirmation = detectGitOperationState(repoPath);
    if (!isAvailable() || !afterConfirmation || afterConfirmation.kind !== current.kind || afterConfirmation.identity !== current.identity) {
      throw new Error('This Git operation changed while confirmation was open. Refresh and try again.');
    }
  }
  // Deliberately do not stage anything. Git remains the continue/skip safety boundary.
  await git(action.args, repoPath, { GIT_EDITOR: 'true' });
  await onDone();
}
