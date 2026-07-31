import * as vscode from 'vscode';
import { createFixupCommitMenuItem, type CreateFixupCommitOutcome } from './commitCreateFixup';
import type { CommitRangeSelection } from './commitCherryPick';
import { pickGitAction, type GitMenuItem } from './gitMenus';

type NativeCreateFixupMenuInput = {
  repoPath: string;
  visibleHashes: readonly string[];
  selectedIndex: number;
  range: CommitRangeSelection;
  isLocalCommits: boolean;
  key: string;
  label?: string;
  onStatus: (status: string) => void;
  onMessage?: (message: string) => void;
  onSuccess?: (outcome: Extract<CreateFixupCommitOutcome, { kind: 'success' }>) => void | Promise<void>;
};

export function nativeCreateFixupCommitMenuItem(input: NativeCreateFixupMenuInput): GitMenuItem {
  return createFixupCommitMenuItem({
    ...input,
    prompt: async (title, value) => vscode.window.showInputBox({ title, value, validateInput: title === 'Create "amend!" commit' ? candidate => candidate.trim() && !/[\r\n]/.test(candidate) ? undefined : 'Commit summary required.' : undefined }),
    confirm: async (title, prompt) => await vscode.window.showWarningMessage(prompt, { modal: true, detail: title }, title) === title,
    showMenu: pickGitAction,
  });
}
