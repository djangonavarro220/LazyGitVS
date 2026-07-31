import * as cp from 'child_process';
import { runSelectedCommitRebase } from './commitRebaseTodo';
import { assertValidCommitFileCheckoutPath, type CommitFileContextCheck, type CommitFileTreeRow } from './commitFileCheckout';
import { detectGitOperationState } from './gitOperationState';
import type { CommitFile } from './gitService';

export const COMMIT_FILE_DISCARD_TITLE = 'Discard file changes';
export const COMMIT_FILE_DISCARD_PROMPT = 'Are you sure you want to discard changes to the selected file(s) from this commit?\n\nThis action will start a rebase, reverting these file changes. Be aware that if subsequent commits depend on these changes, you may need to resolve conflicts.';

type GitFailure = Error & { code?: number | string };
export type CommitFileDiscardBlockReason = 'not-local-commits' | 'multiple-commits' | 'empty-selection' | 'invalid-selection' | 'invalid-path' | 'unsupported-entry' | 'active-operation' | 'dirty-worktree' | 'gpg-signing' | 'detached-head' | 'unreachable' | 'merge-commit' | 'drift';
export type CommitFileDiscardOutcome =
  | { kind: 'success'; paths: string[] }
  | { kind: 'cancelled' }
  | { kind: 'blocked'; reason: CommitFileDiscardBlockReason; message: string }
  | { kind: 'rebase-active'; message: string };

export type CommitFileDiscardInput = {
  repoPath: string;
  commitHash: string;
  commitFiles: readonly CommitFile[];
  row: CommitFileTreeRow | undefined;
  rangeMode: string;
  isLocalCommits: boolean;
  confirm: (title: string, prompt: string) => Promise<boolean>;
  onStart?: () => void;
  isContextCurrent?: CommitFileContextCheck;
  validateContext?: () => Promise<boolean>;
  canMutate?: () => boolean;
};

type PreparedPath = { path: string; previousExists: boolean };
type PreparedDiscard = { branch: string; head: string; todoHash: string; hash: string; parent?: string; paths: PreparedPath[] };
type Preflight = PreparedDiscard | Extract<CommitFileDiscardOutcome, { kind: 'blocked' }>;

function blocked(reason: CommitFileDiscardBlockReason, message: string): Extract<CommitFileDiscardOutcome, { kind: 'blocked' }> {
  return { kind: 'blocked', reason, message };
}

async function contextCurrent(input: CommitFileDiscardInput): Promise<boolean> {
  return !input.isContextCurrent || await input.isContextCurrent();
}

function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error((stderr || stdout || error.message).trim()) as GitFailure;
        failure.code = error.code ?? undefined;
        reject(failure);
      } else resolve(String(stdout ?? ''));
    });
  });
}

function rebaseEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_EDITOR: 'true', LANG: 'C', LC_ALL: 'C', LC_MESSAGES: 'C' };
}

function rowPath(row: CommitFileTreeRow | undefined): string | undefined {
  return row?.kind === 'dir' ? row.path : row?.file.path;
}

export function normaliseCommitFileDiscardPaths(row: CommitFileTreeRow | undefined, commitFiles: readonly CommitFile[]): string[] {
  const selectedPath = rowPath(row);
  if (!selectedPath) return [];
  return row?.kind === 'dir'
    ? commitFiles.filter(file => file.path.startsWith(`${selectedPath}/`)).map(file => file.path)
    : commitFiles.filter(file => file.path === selectedPath).map(file => file.path);
}

function selectedFiles(input: CommitFileDiscardInput): { paths: string[]; files: CommitFile[] } | Extract<CommitFileDiscardOutcome, { kind: 'blocked' }> {
  if (!input.isLocalCommits) return blocked('not-local-commits', 'LazyGitVS: Commit-files discard is only available from Local Commits.');
  if (input.rangeMode !== 'none') return blocked('multiple-commits', 'LazyGitVS: Commit-files discard only supports one inspected commit.');
  const selectedPath = rowPath(input.row);
  if (selectedPath !== undefined) {
    try { assertValidCommitFileCheckoutPath(selectedPath); } catch (error) { return blocked('invalid-path', (error as Error).message); }
  }
  const paths = normaliseCommitFileDiscardPaths(input.row, input.commitFiles);
  if (!paths.length) return blocked('empty-selection', 'LazyGitVS: no Commit-files path is selected to discard.');
  if (new Set(paths).size !== paths.length) return blocked('invalid-selection', 'LazyGitVS: selected Commit-files paths must be distinct.');
  const files = paths.map(path => input.commitFiles.find(file => file.path === path)).filter((file): file is CommitFile => !!file);
  if (files.length !== paths.length) return blocked('invalid-selection', 'LazyGitVS: selected Commit-files paths are stale.');
  for (const file of files) {
    try { assertValidCommitFileCheckoutPath(file.path); } catch (error) { return blocked('invalid-path', (error as Error).message); }
    if (file.oldPath || /^(R|C)/.test(file.status)) return blocked('unsupported-entry', 'LazyGitVS: Commit-files discard supports ordinary non-renamed file paths only.');
  }
  return { paths, files };
}

async function currentBranch(cwd: string): Promise<string | undefined> {
  try {
    const ref = (await runGit(cwd, ['symbolic-ref', '--quiet', 'HEAD'])).trim();
    return ref.startsWith('refs/heads/') ? ref.slice(11) : undefined;
  } catch (error) {
    if ((error as GitFailure).code === 1) return undefined;
    throw error;
  }
}

async function isAncestor(cwd: string, ancestor: string): Promise<boolean> {
  try {
    await runGit(cwd, ['merge-base', '--is-ancestor', ancestor, 'HEAD']);
    return true;
  } catch (error) {
    if ((error as GitFailure).code === 1) return false;
    throw error;
  }
}

async function gpgSigningEnabled(cwd: string): Promise<boolean> {
  try { return (await runGit(cwd, ['config', '--bool', '--get', 'commit.gpgSign'])).trim() === 'true'; }
  catch (error) {
    if ((error as GitFailure).code === 1) return false;
    throw error;
  }
}

async function treeEntryMode(cwd: string, ref: string, filePath: string): Promise<string | undefined> {
  const entries = (await runGit(cwd, ['ls-tree', '-z', ref, '--', filePath])).split('\0').filter(Boolean);
  if (!entries.length) return undefined;
  if (entries.length !== 1) throw new Error(`LazyGitVS: expected one tree entry for ${filePath}.`);
  const separator = entries[0].indexOf('\t');
  const name = separator >= 0 ? entries[0].slice(separator + 1) : '';
  const mode = entries[0].slice(0, separator).split(/\s+/)[0];
  if (name !== filePath || !mode) throw new Error(`LazyGitVS: unexpected tree entry for ${filePath}.`);
  return mode;
}

async function pathChangedByCommit(cwd: string, hash: string, filePath: string): Promise<boolean> {
  return (await runGit(cwd, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-z', '-r', hash, '--', filePath])).split('\0').includes(filePath);
}

function ordinaryMode(mode: string | undefined): boolean {
  return mode === undefined || mode === '100644' || mode === '100755';
}

async function preflight(input: CommitFileDiscardInput): Promise<Preflight> {
  const selected = selectedFiles(input);
  if ('kind' in selected) return selected;
  if (typeof input.commitHash !== 'string' || !/^[0-9a-f]{4,64}$/i.test(input.commitHash)) return blocked('invalid-selection', 'LazyGitVS: Commit-files discard requires a captured commit hash.');
  const operation = detectGitOperationState(input.repoPath);
  if (operation) return blocked('active-operation', `LazyGitVS: cannot discard Commit-files changes while ${operation.label}. Resolve it from Status first.`);
  const status = await runGit(input.repoPath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim()) return blocked('dirty-worktree', 'LazyGitVS: Commit-files discard requires a clean working tree including staged, unstaged, and untracked changes; dirty-tree auto-stash is not supported.');
  if (await gpgSigningEnabled(input.repoPath)) return blocked('gpg-signing', 'LazyGitVS: Commit-files discard is disabled while commit.gpgSign is true.');
  const branch = await currentBranch(input.repoPath);
  if (!branch) return blocked('detached-head', 'LazyGitVS: Commit-files discard requires an attached HEAD on the current local branch.');
  const head = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const hash = (await runGit(input.repoPath, ['rev-parse', '--verify', `${input.commitHash}^{commit}`])).trim();
  if (!await isAncestor(input.repoPath, hash)) return blocked('unreachable', `LazyGitVS: selected commit ${input.commitHash} is no longer reachable from HEAD.`);
  const parents = (await runGit(input.repoPath, ['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/).filter(Boolean);
  if (parents.length > 2) return blocked('merge-commit', 'LazyGitVS: Commit-files discard currently supports ordinary non-merge commits only.');
  const parent = parents[1];
  const paths: PreparedPath[] = [];
  for (const filePath of selected.paths) {
    if (!await pathChangedByCommit(input.repoPath, hash, filePath)) return blocked('invalid-selection', `LazyGitVS: selected path ${filePath} is not changed by the captured commit.`);
    const currentMode = await treeEntryMode(input.repoPath, hash, filePath);
    const previousMode = parent ? await treeEntryMode(input.repoPath, `${hash}^`, filePath) : undefined;
    if (!currentMode && !previousMode) return blocked('invalid-selection', `LazyGitVS: selected path ${filePath} is not a tree entry in the captured commit.`);
    if (!ordinaryMode(currentMode) || !ordinaryMode(previousMode)) return blocked('unsupported-entry', 'LazyGitVS: Commit-files discard supports ordinary non-submodule, non-symlink paths only.');
    paths.push({ path: filePath, previousExists: !!previousMode });
  }
  return { branch, head, todoHash: input.commitHash, hash, parent, paths };
}

function samePreparedDiscard(initial: PreparedDiscard, final: PreparedDiscard): boolean {
  return initial.branch === final.branch && initial.head === final.head && initial.todoHash === final.todoHash && initial.hash === final.hash && initial.parent === final.parent && initial.paths.length === final.paths.length && initial.paths.every((path, index) => path.path === final.paths[index].path && path.previousExists === final.paths[index].previousExists);
}

function repositoryStillMatchesSync(repoPath: string, prepared: PreparedDiscard): boolean {
  if (detectGitOperationState(repoPath)) return false;
  try {
    const branch = cp.execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
    const [head, hash] = cp.execFileSync('git', ['rev-parse', 'HEAD^{commit}', `${prepared.todoHash}^{commit}`], { cwd: repoPath, encoding: 'utf8' }).trim().split(/\s+/);
    return branch === prepared.branch && head === prepared.head && hash === prepared.hash;
  } catch {
    return false;
  }
}

export async function discardCommitFileChanges(input: CommitFileDiscardInput): Promise<CommitFileDiscardOutcome> {
  if (!await contextCurrent(input)) return blocked('drift', 'LazyGitVS: Commit-files context changed; discard was not started.');
  const initial = await preflight(input);
  if ('kind' in initial) return initial;
  if (!await input.confirm(COMMIT_FILE_DISCARD_TITLE, COMMIT_FILE_DISCARD_PROMPT)) return { kind: 'cancelled' };
  if (input.validateContext && !await input.validateContext()) return blocked('drift', 'LazyGitVS: Commit-files context changed; discard was not started.');
  const final = await preflight(input);
  if ('kind' in final) return final;
  if (!samePreparedDiscard(initial, final)) return blocked('drift', 'LazyGitVS: repository changed while confirmation was open; Commit-files discard was not started.');
  // Keep the final session/capability check synchronous and invoke the
  // rebase immediately after it. There is intentionally no await between
  // this check and the mutation start.
  if (input.canMutate && !input.canMutate()) return blocked('drift', 'LazyGitVS: Commit-files context changed; discard was not started.');
  if (!repositoryStillMatchesSync(input.repoPath, final)) return blocked('drift', 'LazyGitVS: repository changed at the mutation boundary; Commit-files discard was not started.');
  const mutation = runSelectedCommitRebase({ repoPath: input.repoPath, hashes: [initial.todoHash], action: 'edit', base: initial.parent, useRoot: !initial.parent, keepEmpty: false, temporaryDirectoryPrefix: 'lazygitvs-commit-file-discard-' });
  input.onStart?.();
  try {
    await mutation;
    const operation = detectGitOperationState(input.repoPath);
    if (operation?.kind !== 'rebase') throw new Error('LazyGitVS: interactive rebase did not stop at the selected commit.');
    const stoppedHead = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    if (stoppedHead !== initial.hash) throw new Error('LazyGitVS: interactive rebase stopped at an unexpected commit; no file changes were applied.');
    for (const { path: filePath } of initial.paths) {
      const previousExists = initial.parent ? !!await treeEntryMode(input.repoPath, 'HEAD^', filePath) : false;
      if (previousExists) await runGit(input.repoPath, ['checkout', 'HEAD^', '--', filePath], rebaseEnv());
      else await runGit(input.repoPath, ['rm', '--ignore-unmatch', '--', filePath], rebaseEnv());
    }
    await runGit(input.repoPath, ['commit', '--amend', '--no-edit', '--allow-empty', '--allow-empty-message'], rebaseEnv());
    await runGit(input.repoPath, ['rebase', '--continue'], rebaseEnv());
    return { kind: 'success', paths: initial.paths.map(path => path.path) };
  } catch (error) {
    const operation = detectGitOperationState(input.repoPath);
    if (operation) return { kind: 'rebase-active', message: `LazyGitVS: Commit-files discard stopped while ${operation.label}. Resolve, continue, skip, or abort it from Status.` };
    throw error;
  }
}
