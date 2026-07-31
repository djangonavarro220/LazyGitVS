import * as path from 'path';
import type { LazyGitGitRuntimeConfig } from './gitService';
import type { CommitFileContextCheck, CommitFileTreeRow } from './commitFileCheckout';
import { commitFileCheckoutPath } from './commitFileCheckout';
import type { CopyText, GitMenuItem, GitRunner } from './gitMenus';
import { LatestWinsAsyncGate } from './previewRequestGate';

/** Upstream lazygit's Commit-files `y` menu title. */
export const COMMIT_FILE_CLIPBOARD_MENU_TITLE = 'Copy to clipboard';
export const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const clipboardPublication = new LatestWinsAsyncGate();

export type CommitFileClipboardInput = {
  repoPath: string;
  commitHash: string;
  row: CommitFileTreeRow | undefined;
  gitConfig: LazyGitGitRuntimeConfig;
  runGit: GitRunner;
  copyText: CopyText;
  isContextCurrent?: CommitFileContextCheck;
  validateContext?: () => Promise<boolean>;
  canPublish?: () => boolean;
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

async function assertContextCurrent(input: Pick<CommitFileClipboardInput, 'isContextCurrent'>): Promise<void> {
  if (input.isContextCurrent && !await input.isContextCurrent()) throw new Error('LazyGitVS: Commit-files context changed; clipboard publication was not started.');
}

async function copyGuarded(input: CommitFileClipboardInput, text: string, label: string): Promise<void> {
  const publication = await clipboardPublication.request(async isCurrent => {
    await assertContextCurrent(input);
    if (input.validateContext && !await input.validateContext()) throw new Error('LazyGitVS: Commit-files context changed; clipboard publication was not started.');
    if (input.canPublish && !input.canPublish()) throw new Error('LazyGitVS: Commit-files context changed; clipboard publication was not started.');
    if (!isCurrent()) return false;
    await input.copyText(text, label, () => isCurrent() && (!input.canPublish || input.canPublish()));
    return isCurrent() && (!input.canPublish || input.canPublish());
  });
  if (publication === undefined || publication === true) return;
  throw new Error('LazyGitVS: Commit-files context changed; clipboard publication was not completed.');
}

async function copyCommitFileDiff(input: CommitFileClipboardInput, paths: readonly string[], label: string): Promise<void> {
  await assertContextCurrent(input);
  const from = await parentForDiff(input);
  await assertContextCurrent(input);
  const diff = await input.runGit(commitFileDiffArgs(from, input.commitHash, paths, input.gitConfig), input.repoPath);
  await copyGuarded(input, diff, label);
}

async function copyCommitFileContent(input: CommitFileClipboardInput, filePath: string): Promise<void> {
  await assertContextCurrent(input);
  const content = await input.runGit(commitFileContentArgs(input.commitHash, filePath), input.repoPath);
  await copyGuarded(input, content, 'file content copied to clipboard');
}

/** Upstream-aligned `y` menu for one captured Commit-files row. */
export function commitFileClipboardCatalog(input: CommitFileClipboardInput): GitMenuItem[] {
  const selectedPath = selectedCommitFilePath(input.row);
  if (!input.commitHash || !input.repoPath || !selectedPath) return [];
  const items: GitMenuItem[] = [
    { key: 'n', label: 'File name', description: path.posix.basename(selectedPath), run: async () => copyGuarded(input, path.posix.basename(selectedPath), 'file name copied to clipboard') },
    { key: 'p', label: 'Relative path', description: selectedPath, run: async () => copyGuarded(input, selectedPath, 'file path copied to clipboard') },
    { key: 'P', label: 'Absolute path', description: path.resolve(input.repoPath, selectedPath), run: async () => copyGuarded(input, path.resolve(input.repoPath, selectedPath), 'file path copied to clipboard') },
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
  isContextCurrent?: CommitFileContextCheck;
  validateContext?: () => Promise<boolean>;
  canPublish?: () => boolean;
};

export type CommitFileClipboardMenuPicker = (title: string, items: GitMenuItem[]) => Promise<unknown>;

/** Capture the source before opening QuickPick, then restore focus only if the session remains current. */
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
    isContextCurrent: source.isContextCurrent,
    validateContext: source.validateContext,
    canPublish: source.canPublish,
  };
  try {
    await assertContextCurrent(input);
    await pickMenu(COMMIT_FILE_CLIPBOARD_MENU_TITLE, commitFileClipboardCatalog(input));
    await assertContextCurrent(input);
  } finally {
    if (input.canPublish && !input.canPublish()) return;
    try { await assertContextCurrent(input); } catch { return; }
    await restoreFocus();
  }
}
