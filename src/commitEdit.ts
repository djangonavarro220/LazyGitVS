import * as cp from 'child_process';
import { commitRangeBounds, type CommitRangeSelection } from './commitCherryPick';
import { runSelectedCommitRebase, rewriteSelectedPickTodo } from './commitRebaseTodo';
import { detectGitOperationState } from './gitOperationState';
import type { GitMenuItem } from './gitMenus';

export const EDIT_COMMIT_STATUS = 'Rebasing';
export const EDIT_STOPPED_STATUS = 'Rebase stopped for commit editing; amend changes, then continue or abort from Status.';

type GitFailure = Error & { code?: number | string };
export type CommitEditBlockReason = 'branch-view' | 'active-operation' | 'empty-selection' | 'invalid-selection' | 'dirty-worktree' | 'detached-head' | 'unreachable' | 'merge-commit' | 'noncontiguous' | 'drift';
export type CommitEditOutcome =
  | { kind: 'stopped'; startIndex: number; hashes: string[]; message: string }
  | { kind: 'blocked'; reason: CommitEditBlockReason; message: string }
  | { kind: 'rebase-active'; message: string };

export type CommitEditInput = {
  repoPath: string;
  visibleHashes: readonly string[];
  selectedIndex: number;
  range: CommitRangeSelection;
  isLocalCommits: boolean;
  onStart?: () => void;
};

type SelectedCommit = { todoHash: string; hash: string; parent?: string };
type PreparedEdit = { branch: string; head: string; startIndex: number; commits: SelectedCommit[]; base?: string; useRoot: boolean };
type Preflight = PreparedEdit | Extract<CommitEditOutcome, { kind: 'blocked' }>;

function blocked(reason: CommitEditBlockReason, message: string): Extract<CommitEditOutcome, { kind: 'blocked' }> {
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

function selectedVisibleHashes(input: CommitEditInput): { startIndex: number; hashes: string[] } | Extract<CommitEditOutcome, { kind: 'blocked' }> {
  if (!input.isLocalCommits) return blocked('branch-view', 'LazyGitVS: Edit is only available from the attached top-level Local Commits view.');
  const [startIndex, endIndex] = commitRangeBounds(input.range, input.selectedIndex, input.visibleHashes.length);
  const hashes = endIndex >= startIndex ? input.visibleHashes.slice(startIndex, endIndex + 1).map(hash => hash.trim()) : [];
  if (!hashes.length) return blocked('empty-selection', 'LazyGitVS: no visible commit is selected to edit.');
  if (hashes.some(hash => !hash) || new Set(hashes).size !== hashes.length) return blocked('invalid-selection', 'LazyGitVS: selected commits must be distinct valid hashes.');
  return { startIndex, hashes };
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

async function commitParents(cwd: string, hash: string): Promise<string[]> {
  return (await runGit(cwd, ['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/).filter(Boolean);
}

async function preflight(input: CommitEditInput): Promise<Preflight> {
  const selected = selectedVisibleHashes(input);
  if ('kind' in selected) return selected;
  const operation = detectGitOperationState(input.repoPath);
  if (operation) return blocked('active-operation', `LazyGitVS: cannot edit commits while ${operation.label}. Resolve it from Status first.`);
  const status = await runGit(input.repoPath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim()) return blocked('dirty-worktree', 'LazyGitVS: Edit requires a clean working tree including staged, unstaged, and untracked changes; dirty-tree auto-stash is not supported.');
  const branch = await currentBranch(input.repoPath);
  if (!branch) return blocked('detached-head', 'LazyGitVS: Edit requires an attached HEAD on the current local branch.');
  const head = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const commits: SelectedCommit[] = [];
  for (const todoHash of selected.hashes) {
    let hash: string;
    try {
      hash = (await runGit(input.repoPath, ['rev-parse', '--verify', `${todoHash}^{commit}`])).trim();
    } catch {
      return blocked('unreachable', `LazyGitVS: selected commit ${todoHash} no longer resolves to a reachable commit.`);
    }
    if (!await isAncestor(input.repoPath, hash)) return blocked('unreachable', `LazyGitVS: selected commit ${todoHash} is no longer reachable from HEAD.`);
    if (commits.some(commit => commit.hash === hash)) return blocked('invalid-selection', 'LazyGitVS: selected commits must resolve to distinct full hashes.');
    const parents = await commitParents(input.repoPath, hash);
    if (parents.length > 2) return blocked('merge-commit', 'LazyGitVS: Edit currently supports ordinary non-merge commits only.');
    commits.push({ todoHash, hash, parent: parents[1] });
  }
  if (commits.some((commit, index) => index + 1 < commits.length && commit.parent !== commits[index + 1].hash)) {
    return blocked('noncontiguous', 'LazyGitVS: selected commits must form one contiguous visible history range.');
  }
  const oldest = commits[commits.length - 1];
  return { branch, head, startIndex: selected.startIndex, commits, base: oldest.parent, useRoot: !oldest.parent };
}

function samePreparedEdit(initial: PreparedEdit, final: PreparedEdit): boolean {
  return initial.branch === final.branch
    && initial.head === final.head
    && initial.startIndex === final.startIndex
    && initial.base === final.base
    && initial.useRoot === final.useRoot
    && initial.commits.length === final.commits.length
    && initial.commits.every((commit, index) => commit.todoHash === final.commits[index].todoHash && commit.hash === final.commits[index].hash && commit.parent === final.commits[index].parent);
}

export function rewriteEditTodo(todo: string, hashes: readonly string[]): string {
  return rewriteSelectedPickTodo(todo, hashes, 'edit');
}

export async function editSelectedCommits(input: CommitEditInput): Promise<CommitEditOutcome> {
  const initial = await preflight(input);
  if ('kind' in initial) return initial;
  const final = await preflight(input);
  if ('kind' in final) return final;
  if (!samePreparedEdit(initial, final)) return blocked('drift', 'LazyGitVS: repository changed before Edit started; Edit was not started.');
  const hashes = initial.commits.map(commit => commit.hash);
  input.onStart?.();
  try {
    await runSelectedCommitRebase({ repoPath: input.repoPath, hashes, action: 'edit', base: initial.base, useRoot: initial.useRoot, keepEmpty: false, temporaryDirectoryPrefix: 'lazygitvs-edit-' });
    const operation = detectGitOperationState(input.repoPath);
    if (operation?.kind !== 'rebase') throw new Error('LazyGitVS: interactive rebase did not stop at the selected commit.');
    const stoppedHead = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    const oldest = initial.commits[initial.commits.length - 1];
    if (stoppedHead !== oldest.hash) throw new Error('LazyGitVS: interactive rebase stopped at an unexpected commit.');
    return { kind: 'stopped', startIndex: initial.startIndex, hashes, message: EDIT_STOPPED_STATUS };
  } catch (error) {
    const operation = detectGitOperationState(input.repoPath);
    if (operation) return { kind: 'rebase-active', message: `LazyGitVS: Edit left ${operation.label} active. Amend changes, then continue or abort from Status.` };
    throw error;
  }
}

type CommitEditMenuInput = Omit<CommitEditInput, 'onStart'> & {
  key: string;
  onStatus: (status: string) => void;
  onMessage?: (message: string) => void;
};

export function commitEditMenuItem(input: CommitEditMenuInput): GitMenuItem {
  const { key, onStatus, onMessage, ...editInput } = input;
  return {
    key,
    label: '$(edit) Edit selected commit(s)',
    description: 'start interactive rebase and stop at selected commit(s)',
    run: async () => {
      let transientStatus = false;
      try {
        const outcome = await editSelectedCommits({
          ...editInput,
          onStart: () => {
            transientStatus = true;
            onStatus(EDIT_COMMIT_STATUS);
          },
        });
        if (outcome.kind === 'stopped') {
          transientStatus = false;
          onStatus(outcome.message);
        } else if (outcome.kind === 'blocked' || outcome.kind === 'rebase-active') {
          transientStatus = false;
          onStatus(outcome.message);
          onMessage?.(outcome.message);
        }
      } finally {
        if (transientStatus) onStatus('');
      }
    },
  };
}
