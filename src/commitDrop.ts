import * as cp from 'child_process';
import { commitRangeBounds, type CommitRangeSelection } from './commitCherryPick';
import { detectGitOperationState } from './gitOperationState';
import { rewriteSelectedPickTodo, runSelectedCommitRebase } from './commitRebaseTodo';

export const DROP_COMMIT_TITLE = 'Drop commit';
export const DROP_COMMIT_PROMPT = 'Are you sure you want to drop the selected commit(s)?';

type GitFailure = Error & { code?: number | string };
export type CommitDropBlockReason = 'active-operation' | 'empty-selection' | 'invalid-selection' | 'dirty-worktree' | 'detached-head' | 'branch-mismatch' | 'unreachable' | 'merge-commit' | 'sole-root' | 'drift';
export type CommitDropOutcome =
  | { kind: 'success'; startIndex: number; hashes: string[] }
  | { kind: 'cancelled' }
  | { kind: 'blocked'; reason: CommitDropBlockReason; message: string }
  | { kind: 'rebase-active'; message: string };

export type CommitDropInput = {
  repoPath: string;
  visibleHashes: readonly string[];
  selectedIndex: number;
  range: CommitRangeSelection;
  viewBranch?: string;
  confirm: (title: string, prompt: string) => Promise<boolean>;
};

type SelectedCommit = { todoHash: string; hash: string; parent?: string };
type PreparedDrop = { branch: string; head: string; startIndex: number; commits: SelectedCommit[]; useRoot: boolean; upstream?: string };
type Preflight = PreparedDrop | { kind: 'blocked'; reason: CommitDropBlockReason; message: string };

function blocked(reason: CommitDropBlockReason, message: string): Extract<CommitDropOutcome, { kind: 'blocked' }> {
  return { kind: 'blocked', reason, message };
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error((stderr || stdout || error.message).trim()) as GitFailure;
        failure.code = error.code ?? undefined;
        reject(failure);
      } else resolve(String(stdout ?? ''));
    });
  });
}

function selection(input: CommitDropInput): { startIndex: number; hashes: string[] } | Extract<CommitDropOutcome, { kind: 'blocked' }> {
  const [startIndex, endIndex] = commitRangeBounds(input.range, input.selectedIndex, input.visibleHashes.length);
  const hashes = endIndex >= startIndex ? input.visibleHashes.slice(startIndex, endIndex + 1).map(hash => hash.trim()) : [];
  if (!hashes.length) return blocked('empty-selection', 'LazyGitVS: no visible commit is selected to drop.');
  if (hashes.some(hash => !hash) || new Set(hashes).size !== hashes.length) return blocked('invalid-selection', 'LazyGitVS: selected commits must be distinct valid hashes.');
  return { startIndex, hashes };
}

async function currentBranch(cwd: string): Promise<string | undefined> {
  try {
    const branch = (await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
    return branch || undefined;
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

async function preflight(input: CommitDropInput): Promise<Preflight> {
  const selected = selection(input);
  if ('kind' in selected) return selected;
  const operation = detectGitOperationState(input.repoPath);
  if (operation) return blocked('active-operation', `LazyGitVS: cannot drop commits while ${operation.label}. Resolve it from Status first.`);
  const status = await runGit(input.repoPath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim()) return blocked('dirty-worktree', 'LazyGitVS: Drop requires a clean working tree including staged, unstaged, and untracked changes; dirty-tree auto-stash is not supported.');
  const branch = await currentBranch(input.repoPath);
  if (!branch) return blocked('detached-head', 'LazyGitVS: Drop requires an attached HEAD on the current local branch.');
  if (input.viewBranch && input.viewBranch !== branch) return blocked('branch-mismatch', `LazyGitVS: this Commits view is for ${input.viewBranch}, but HEAD is on ${branch}.`);
  const head = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const commits: SelectedCommit[] = [];
  let useRoot = false;
  for (const todoHash of selected.hashes) {
    const hash = (await runGit(input.repoPath, ['rev-parse', '--verify', `${todoHash}^{commit}`])).trim();
    if (!await isAncestor(input.repoPath, hash)) return blocked('unreachable', `LazyGitVS: selected commit ${todoHash} is no longer reachable from HEAD.`);
    const parents = (await runGit(input.repoPath, ['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/).filter(Boolean);
    if (parents.length > 2) return blocked('merge-commit', 'LazyGitVS: Drop currently supports ordinary non-merge commits only.');
    const parent = parents[1];
    if (!parent && hash === head) return blocked('sole-root', 'LazyGitVS: cannot drop the sole root commit.');
    if (!parent) useRoot = true;
    commits.push({ todoHash, hash, parent });
  }
  return { branch, head, startIndex: selected.startIndex, commits, useRoot, upstream: useRoot ? undefined : commits[commits.length - 1].parent };
}

function samePreparedDrop(initial: PreparedDrop, final: PreparedDrop): boolean {
  return initial.branch === final.branch && initial.head === final.head && initial.useRoot === final.useRoot && initial.upstream === final.upstream && initial.commits.length === final.commits.length && initial.commits.every((commit, index) => commit.hash === final.commits[index].hash && commit.todoHash === final.commits[index].todoHash);
}

export function rewriteDropTodo(todo: string, hashes: readonly string[]): string {
  return rewriteSelectedPickTodo(todo, hashes, 'drop');
}

export async function dropSelectedCommits(input: CommitDropInput): Promise<CommitDropOutcome> {
  const initial = await preflight(input);
  if ('kind' in initial) return initial;
  if (!await input.confirm(DROP_COMMIT_TITLE, DROP_COMMIT_PROMPT)) return { kind: 'cancelled' };
  const final = await preflight(input);
  if ('kind' in final) return final;
  if (!samePreparedDrop(initial, final)) return blocked('drift', 'LazyGitVS: repository changed while confirmation was open; Drop was not started.');
  const hashes = initial.commits.map(commit => commit.todoHash);
  try {
    await runSelectedCommitRebase({ repoPath: input.repoPath, hashes, action: 'drop', base: initial.upstream, useRoot: initial.useRoot, temporaryDirectoryPrefix: 'lazygitvs-drop-' });
    return { kind: 'success', startIndex: initial.startIndex, hashes };
  } catch (error) {
    if (detectGitOperationState(input.repoPath)?.kind === 'rebase') return { kind: 'rebase-active', message: 'LazyGitVS: Drop stopped during rebase. Resolve, continue, skip, or abort it from Status.' };
    throw error;
  }
}
