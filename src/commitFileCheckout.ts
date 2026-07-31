import * as path from 'path';
import type { ChangedFile, CommitFile } from './gitService';
import type { GitMenuItem } from './gitMenus';
import { parseDiffHunks, type Hunk } from './hunkPatch';
import { buildTreeRows, type TreeRow, type TreeSortOptions } from './panels';

export type CommitFileTreeItem = ChangedFile & CommitFile;
export type CommitFileTreeRow = TreeRow<CommitFileTreeItem>;
export type CommitFileGitRunner = (args: string[], cwd: string) => Promise<string>;
export type CommitFileContextCheck = () => boolean | Promise<boolean>;
export type CommitFileSynchronousMutationCheck = () => boolean;
export type PorcelainV1Status = { xy: string; path: string; originalPath?: string };

export const COMMIT_FILE_RANGE_MESSAGE = 'Commit files only supports a single inspected commit. Clear the visual commit range before pressing Enter.';
const LOCAL_MODIFICATIONS_MESSAGE = 'Cannot checkout commit file: local modifications exist in the selected path.';
const UNTRACKED_COLLISION_MESSAGE = 'Cannot checkout commit file: an untracked path would be overwritten.';
const INVALID_PATH_MESSAGE = 'Commit-files checkout requires a non-empty relative literal repository path.';

export function canInspectSingleCommit(rangeMode: string): boolean {
  return rangeMode === 'none';
}

function commitFileAsChangedFile(file: CommitFile): CommitFileTreeItem {
  const status = (file.status || 'M').slice(0, 1);
  return { ...file, xy: `${status} `, staged: status !== '?', untracked: status === '?' };
}

export function projectCommitFileTreeRows(files: readonly CommitFile[], options: TreeSortOptions, collapsedDirs: ReadonlySet<string>): CommitFileTreeRow[] {
  return buildTreeRows(files.map(commitFileAsChangedFile), options, new Set(collapsedDirs));
}

export function selectedCommitFileTreeRow(rows: readonly CommitFileTreeRow[], selected: number): CommitFileTreeRow | undefined {
  return rows[selected];
}

export function selectedCommitFile(rows: readonly CommitFileTreeRow[], selected: number): CommitFile | undefined {
  const row = selectedCommitFileTreeRow(rows, selected);
  return row?.kind === 'file' ? row.file : undefined;
}

export function commitFileCheckoutPath(row: CommitFileTreeRow | undefined): string | undefined {
  return row?.kind === 'dir' ? row.path : row?.file.path;
}

export function commitFileCheckoutMenuItem(commitHash: string | undefined, row: CommitFileTreeRow | undefined, key: string): { key: string; label: string; description: string } | undefined {
  const checkoutPath = commitFileCheckoutPath(row);
  return commitHash && checkoutPath ? { key, label: '$(debug-step-over) Checkout', description: `Checkout ${checkoutPath}` } : undefined;
}

export function commitFileCheckoutCatalog(commitHash: string | undefined, row: CommitFileTreeRow | undefined, key: string, run: () => Promise<void>): GitMenuItem[] {
  const item = commitFileCheckoutMenuItem(commitHash, row, key);
  return item ? [{ ...item, run }] : [];
}

export async function commitFileDrilldownState<T extends { hash: string }>(commit: T, loadFiles: (hash: string) => Promise<CommitFile[]>): Promise<{ commitFilesFor: T; commitFileItems: CommitFile[]; commitFileSelected: number }> {
  return { commitFilesFor: commit, commitFileItems: await loadFiles(commit.hash), commitFileSelected: 0 };
}

export async function checkoutCommitFileTreeRow(input: { repoPath: string; commitHash: string; row: CommitFileTreeRow | undefined; runGit: CommitFileGitRunner; isContextCurrent?: CommitFileContextCheck; validateContext?: () => Promise<boolean>; canMutate?: CommitFileSynchronousMutationCheck }): Promise<boolean> {
  const checkoutPath = commitFileCheckoutPath(input.row);
  if (!checkoutPath) return false;
  await checkoutCommitFile({ repoPath: input.repoPath, commitHash: input.commitHash, path: checkoutPath, runGit: input.runGit, isContextCurrent: input.isContextCurrent, validateContext: input.validateContext, canMutate: input.canMutate });
  return true;
}

export function toggledCommitFileCollapsedDirs(collapsedDirs: ReadonlySet<string>, row: CommitFileTreeRow | undefined): Set<string> | undefined {
  if (row?.kind !== 'dir') return undefined;
  const next = new Set(collapsedDirs);
  if (next.has(row.path)) next.delete(row.path); else next.add(row.path);
  return next;
}

export type ReadOnlyCommitFileHunkState = {
  allHunks: Hunk[];
  hunks: Hunk[];
  hunkSide: 'unstaged';
  hunkSelectionMode: 'hunk' | 'line';
  hunkSelected: number;
  hunkLineSelected: number;
  editorModeFilePath: string;
  readOnlyHunkMode: true;
  statusLine: string;
};

export function readOnlyCommitFileHunkState(patch: string, filePath: string, useHunkMode: boolean): ReadOnlyCommitFileHunkState {
  const allHunks = parseDiffHunks(patch, false);
  return {
    allHunks,
    hunks: allHunks,
    hunkSide: 'unstaged',
    hunkSelectionMode: useHunkMode ? 'hunk' : 'line',
    hunkSelected: 0,
    hunkLineSelected: 0,
    editorModeFilePath: filePath,
    readOnlyHunkMode: true,
    statusLine: 'Commit HUNK mode: j/k move · a line · Esc back',
  };
}

export function assertValidCommitFileCheckoutPath(filePath: string): void {
  const segments = typeof filePath === 'string' ? filePath.split(/[\\/]/) : [];
  const invalid =
    typeof filePath !== 'string' ||
    !filePath ||
    filePath.includes('\0') ||
    filePath === '.' ||
    filePath === '..' ||
    path.isAbsolute(filePath) ||
    path.posix.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath) ||
    segments.some(segment => !segment || segment === '.' || segment === '..') ||
    filePath.startsWith(':') ||
    /[*?[]/.test(filePath);
  if (invalid) throw new Error(INVALID_PATH_MESSAGE);
}

function assertValidCommitHash(commitHash: string): void {
  if (typeof commitHash !== 'string' || !/^[0-9a-f]{4,64}$/i.test(commitHash)) {
    throw new Error('Commit-files checkout requires a captured commit hash.');
  }
}

function assertValidRepoPath(repoPath: string): void {
  if (typeof repoPath !== 'string' || !repoPath || repoPath.includes('\0')) {
    throw new Error('Commit-files checkout requires a captured repository path.');
  }
}

export function parsePorcelainV1Status(output: string): PorcelainV1Status[] {
  const fields = output.split('\0');
  const entries: PorcelainV1Status[] = [];
  for (let index = 0; index < fields.length; index++) {
    const entry = fields[index];
    if (!entry || entry.length < 3) continue;
    const xy = entry.slice(0, 2);
    const filePath = entry.slice(3);
    const originalPath = xy[0] === 'R' || xy[0] === 'C' ? fields[++index] : undefined;
    entries.push(originalPath === undefined ? { xy, path: filePath } : { xy, path: filePath, originalPath });
  }
  return entries;
}

export function hasTrackedPorcelainChanges(entries: readonly PorcelainV1Status[]): boolean {
  return entries.some(entry => entry.xy !== '??' && entry.xy !== '!!');
}

function sourcePaths(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

function untrackedPathWouldCollide(entries: readonly PorcelainV1Status[], pathsInCommit: readonly string[], selectedPath: string): boolean {
  const untrackedOrIgnored = entries.filter(entry => entry.xy === '??' || entry.xy === '!!').map(entry => entry.path.replace(/\/$/, ''));
  return untrackedOrIgnored.some(candidate => pathsInCommit.some(sourcePath => sourcePath === candidate || sourcePath.startsWith(`${candidate}/`) || candidate.startsWith(`${sourcePath}/`) || (sourcePath.startsWith(`${selectedPath}/`) && candidate.startsWith(`${selectedPath}/`))));
}

function assertSafePathStatus(entries: readonly PorcelainV1Status[], pathsInCommit: readonly string[], selectedPath: string): void {
  if (hasTrackedPorcelainChanges(entries)) throw new Error(LOCAL_MODIFICATIONS_MESSAGE);
  if (untrackedPathWouldCollide(entries, pathsInCommit, selectedPath)) throw new Error(UNTRACKED_COLLISION_MESSAGE);
}

export async function checkoutCommitFile(input: {
  repoPath: string;
  commitHash: string;
  path: string;
  runGit: CommitFileGitRunner;
  isContextCurrent?: CommitFileContextCheck;
  validateContext?: () => Promise<boolean>;
  canMutate?: CommitFileSynchronousMutationCheck;
}): Promise<void> {
  const assertContextCurrent = async () => { if (input.isContextCurrent && !await input.isContextCurrent()) throw new Error('LazyGitVS: Commit-files context changed; checkout was not started.'); };
  await assertContextCurrent();
  assertValidRepoPath(input.repoPath);
  assertValidCommitHash(input.commitHash);
  assertValidCommitFileCheckoutPath(input.path);
  const statusArgs = ['status', '--porcelain=v1', '-z', '--ignored', '--untracked-files=all', '--', input.path];
  const verifyArgs = ['rev-parse', '--verify', `${input.commitHash}^{commit}`];
  await input.runGit(verifyArgs, input.repoPath);
  const initialStatus = parsePorcelainV1Status(await input.runGit(statusArgs, input.repoPath));
  const pathsInCommit = sourcePaths(await input.runGit(['ls-tree', '-r', '--name-only', '-z', input.commitHash, '--', input.path], input.repoPath));
  assertSafePathStatus(initialStatus, pathsInCommit, input.path);
  if (input.validateContext && !await input.validateContext()) throw new Error('LazyGitVS: Commit-files context changed; checkout was not started.');
  await input.runGit(verifyArgs, input.repoPath);
  const currentStatus = parsePorcelainV1Status(await input.runGit(statusArgs, input.repoPath));
  assertSafePathStatus(currentStatus, pathsInCommit, input.path);
  // This check is deliberately synchronous. Its next statement invokes Git
  // without an intervening await, closing the final validation/mutation gap.
  if (input.canMutate && !input.canMutate()) throw new Error('LazyGitVS: Commit-files context changed; checkout was not started.');
  const mutation = input.runGit(['checkout', input.commitHash, '--', input.path], input.repoPath);
  await mutation;
}
