import * as path from 'path';
import type { LazyGitGitRuntimeConfig } from './gitService';
import type { CommitFileTreeRow } from './commitFileCheckout';
import { commitFileCheckoutPath } from './commitFileCheckout';
import type { CopyText, GitMenuItem, GitRunner } from './gitMenus';

/** Upstream lazygit's Commit-files `y` menu title. */
export const COMMIT_FILE_CLIPBOARD_MENU_TITLE = 'Copy to clipboard';
export const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export type CommitFileClipboardInput = {
  repoPath: string;
  commitHash: string;
  row: CommitFileTreeRow | undefined;
  gitConfig: LazyGitGitRuntimeConfig;
  runGit: GitRunner;
  copyText: CopyText;
};

function configuredInteger(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function selectedCommitFilePath(row: CommitFileTreeRow | undefined): string | undefined {
  return commitFileCheckoutPath(row);
}

function literalPathspec(filePath: string): string {
  return filePath === '.' ? filePath : `:(literal)${filePath}`;
}

/** Exact parent-to-commit shape used by lazygit's plain Commit-files diff copy. */
export function commitFileDiffArgs(from: string, to: string, paths: readonly string[], gitConfig: LazyGitGitRuntimeConfig): string[] {
  const contextSize = configuredInteger(gitConfig.diffContextSize, 3, 0);
  const renameThreshold = configuredInteger(gitConfig.renameSimilarityThreshold, 50, 0, 100);
  return [
    '-c', 'diff.noprefix=false',
    'diff', '--submodule', '--no-ext-diff',
    `--unified=${contextSize}`, `--find-renames=${renameThreshold}%`, '--color=never',
    from, to, '--', ...paths.map(literalPathspec),
  ];
}

export function commitFileContentArgs(commitHash: string, filePath: string): string[] {
  return ['show', `${commitHash}:${filePath}`];
}

async function parentForDiff(input: CommitFileClipboardInput): Promise<string> {
  const line = (await input.runGit(['rev-list', '--parents', '-n', '1', input.commitHash], input.repoPath)).trim();
  const fields = line.split(/\s+/).filter(Boolean);
  if (!fields[0]) throw new Error('LazyGitVS: inspected commit no longer exists.');
  return fields[1] ?? EMPTY_TREE_HASH;
}

async function copyCommitFileDiff(input: CommitFileClipboardInput, paths: readonly string[], label: string): Promise<void> {
  const from = await parentForDiff(input);
  const diff = await input.runGit(commitFileDiffArgs(from, input.commitHash, paths, input.gitConfig), input.repoPath);
  await input.copyText(diff, label);
}

async function copyCommitFileContent(input: CommitFileClipboardInput, filePath: string): Promise<void> {
  const content = await input.runGit(commitFileContentArgs(input.commitHash, filePath), input.repoPath);
  await input.copyText(content, 'file content copied to clipboard');
}

/** Upstream-aligned `y` menu for one captured Commit-files row. */
export function commitFileClipboardCatalog(input: CommitFileClipboardInput): GitMenuItem[] {
  const selectedPath = selectedCommitFilePath(input.row);
  if (!input.commitHash || !input.repoPath || !selectedPath) return [];
  const items: GitMenuItem[] = [
    { key: 'n', label: 'File name', description: path.posix.basename(selectedPath), run: async () => input.copyText(path.posix.basename(selectedPath), 'file name copied to clipboard') },
    { key: 'p', label: 'Relative path', description: selectedPath, run: async () => input.copyText(selectedPath, 'file path copied to clipboard') },
    { key: 'P', label: 'Absolute path', description: path.resolve(input.repoPath, selectedPath), run: async () => input.copyText(path.resolve(input.repoPath, selectedPath), 'file path copied to clipboard') },
    { key: 's', label: 'Diff of selected file', description: selectedPath, run: async () => copyCommitFileDiff(input, [selectedPath], 'file diff copied to clipboard') },
    { key: 'a', label: 'Diff of all files', description: input.commitHash, run: async () => copyCommitFileDiff(input, ['.'], 'all files diff copied to clipboard') },
  ];
  if (input.row?.kind === 'file') items.push({ key: 'c', label: 'Content of selected file', description: selectedPath, run: async () => copyCommitFileContent(input, selectedPath) });
  return items;
}

export type CommitFileClipboardActionSource = {
  commitHash: string | undefined;
  row: CommitFileTreeRow | undefined;
  repoPath: string;
  gitConfig: LazyGitGitRuntimeConfig;
  runGit: GitRunner;
  copyText: CopyText;
};

export type CommitFileClipboardMenuPicker = (title: string, items: GitMenuItem[]) => Promise<unknown>;

/** Capture the source before opening QuickPick, then always restore Commit-files focus. */
export async function runCommitFileClipboardAction(
  source: CommitFileClipboardActionSource,
  pickMenu: CommitFileClipboardMenuPicker,
  restoreFocus: () => Promise<void>,
): Promise<void> {
  if (!source.commitHash || !source.row) return;
  const input: CommitFileClipboardInput = {
    repoPath: source.repoPath,
    commitHash: source.commitHash,
    row: source.row,
    gitConfig: { ...source.gitConfig },
    runGit: source.runGit,
    copyText: source.copyText,
  };
  try {
    await pickMenu(COMMIT_FILE_CLIPBOARD_MENU_TITLE, commitFileClipboardCatalog(input));
  } finally {
    await restoreFocus();
  }
}
