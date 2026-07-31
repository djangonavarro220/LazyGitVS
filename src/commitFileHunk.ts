import type { CommitFile } from './gitService';
import { readOnlyCommitFileHunkState, type CommitFileContextCheck } from './commitFileCheckout';
import type { CommitFilesHunkToken, CommitFilesOperationToken, CommitFilesOwner } from './commitFilesController';

export type CommitFileHunkInput = {
  owner: CommitFilesOwner;
  file: CommitFile;
  selectedFile: CommitFile;
  hunkToken?: CommitFilesHunkToken;
  isOwnerCurrent: () => boolean;
  isHunkCurrent?: () => boolean;
  revalidateOwner: CommitFileContextCheck;
  showArgs: (...args: string[]) => string[];
  runGit: (args: string[], cwd: string) => Promise<string>;
  useHunkModeInStagingView: boolean;
  applyHunkState: (patch: string, filePath: string) => void;
  setEditorHunkMode: (enabled: boolean, ownerId?: string, prepare?: () => void) => Promise<boolean>;
  clearHunkState?: () => void;
  render: () => void;
  showText: (title: string, content: string, preview: boolean, preserveFocus: boolean, isCurrent: () => boolean) => Promise<void>;
  forceEditorFocus: (isCurrent: () => boolean) => Promise<void>;
  revealEditorHunk: (isCurrent: () => boolean) => Promise<void>;
};

/**
 * Commit-file HUNK work is bound to the session/editor token. In particular,
 * stale completion only releases its own editor-mode owner. That keeps a late
 * completion from disabling or clearing a newer mode owned by a later session.
 */
export async function enterCommitFileHunkMode(input: CommitFileHunkInput): Promise<void> {
  const isCurrent = () => input.isOwnerCurrent() && (!input.isHunkCurrent || input.isHunkCurrent());
  const abandon = async () => {
    if (await input.setEditorHunkMode(false, input.hunkToken?.editorModeId)) input.clearHunkState?.();
  };
  if (input.selectedFile.path !== input.file.path || !isCurrent() || !await input.revalidateOwner()) return;
  const patch = await input.runGit(input.showArgs('--patch', '--stat', input.owner.commitHash, '--', input.file.path), input.owner.repoPath);
  if (!isCurrent() || !await input.revalidateOwner()) return;
  if (!await input.setEditorHunkMode(true, input.hunkToken?.editorModeId, () => input.applyHunkState(patch, input.file.path))) return;
  if (!isCurrent()) { await abandon(); return; }
  input.render();
  if (!isCurrent() || !await input.revalidateOwner()) { await abandon(); return; }
  await input.showText(`LazyGitVS ${input.owner.commitHash}:${input.file.path}`, patch, false, false, isCurrent);
  if (!isCurrent()) { await abandon(); return; }
  await input.forceEditorFocus(isCurrent);
  if (!isCurrent() || !await input.revalidateOwner()) { await abandon(); return; }
  await input.revealEditorHunk(isCurrent);
}

export type CommitFilesHunkCoordinatorToken = CommitFilesOperationToken;

// Keep the read-only state constructor next to the entry coordinator so the
// controller cannot accidentally reuse the mutable Files HUNK state.
export { readOnlyCommitFileHunkState };
