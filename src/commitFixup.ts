import * as cp from 'child_process';
import { commitRangeBounds, type CommitRangeSelection } from './commitCherryPick';
import { detectGitOperationState } from './gitOperationState';
import { rewriteSelectedPickTodo, runSelectedCommitRebase, type RebaseTodoActionFlag } from './commitRebaseTodo';

export const FIXUP_MENU_TITLE = 'Fixup';
export const FIXUP_MENU_ITEMS = [
  { key: 'f', label: 'Fixup', tooltip: "Meld the selected commit into the commit below it. Similar to squash, but the selected commit's message will be discarded.", actionFlag: '' },
  { key: 'c', label: "Fixup and use this commit's message", tooltip: "Squash the selected commit into the commit below, using this commit's message, discarding the message of the commit below.", actionFlag: '-C' },
] as const;

export type FixupActionFlag = typeof FIXUP_MENU_ITEMS[number]['actionFlag'];
type GitFailure = Error & { code?: number | string };
export type CommitFixupBlockReason = 'active-operation' | 'empty-selection' | 'invalid-selection' | 'dirty-worktree' | 'detached-head' | 'branch-mismatch' | 'unreachable' | 'merge-commit' | 'no-target' | 'target-mismatch' | 'drift';
export type CommitFixupOutcome =
  | { kind: 'success'; startIndex: number; hashes: string[] }
  | { kind: 'cancelled' }
  | { kind: 'blocked'; reason: CommitFixupBlockReason; message: string }
  | { kind: 'rebase-active'; message: string };

export type CommitFixupInput = {
  repoPath: string;
  visibleHashes: readonly string[];
  selectedIndex: number;
  range: CommitRangeSelection;
  viewBranch?: string;
  chooseAction: () => Promise<FixupActionFlag | undefined>;
  onStart?: () => void;
};

type SelectedCommit = { todoHash: string; hash: string; parent?: string };
type PreparedFixup = { branch: string; head: string; startIndex: number; commits: SelectedCommit[]; targetTodoHash: string; target: string; base?: string; useRoot: boolean };
type Preflight = PreparedFixup | { kind: 'blocked'; reason: CommitFixupBlockReason; message: string };

function blocked(reason: CommitFixupBlockReason, message: string): Extract<CommitFixupOutcome, { kind: 'blocked' }> {
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

function selection(input: CommitFixupInput): { startIndex: number; hashes: string[]; targetTodoHash: string } | Extract<CommitFixupOutcome, { kind: 'blocked' }> {
  const [startIndex, endIndex] = commitRangeBounds(input.range, input.selectedIndex, input.visibleHashes.length);
  const hashes = endIndex >= startIndex ? input.visibleHashes.slice(startIndex, endIndex + 1).map(hash => hash.trim()) : [];
  if (!hashes.length) return blocked('empty-selection', 'LazyGitVS: no visible commit is selected to fix up.');
  if (hashes.some(hash => !hash) || new Set(hashes).size !== hashes.length) return blocked('invalid-selection', 'LazyGitVS: selected commits must be distinct valid hashes.');
  const targetTodoHash = input.visibleHashes[endIndex + 1]?.trim();
  if (!targetTodoHash) return blocked('no-target', "LazyGitVS: There's no commit below to squash into.");
  return { startIndex, hashes, targetTodoHash };
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

async function commitParents(cwd: string, hash: string): Promise<string[]> {
  return (await runGit(cwd, ['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/).filter(Boolean);
}

async function preflight(input: CommitFixupInput): Promise<Preflight> {
  const selected = selection(input);
  if ('kind' in selected) return selected;
  const operation = detectGitOperationState(input.repoPath);
  if (operation) return blocked('active-operation', `LazyGitVS: cannot fix up commits while ${operation.label}. Resolve it from Status first.`);
  const status = await runGit(input.repoPath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim()) return blocked('dirty-worktree', 'LazyGitVS: Fixup requires a clean working tree including staged, unstaged, and untracked changes; dirty-tree auto-stash is not supported.');
  const branch = await currentBranch(input.repoPath);
  if (!branch) return blocked('detached-head', 'LazyGitVS: Fixup requires an attached HEAD on the current local branch.');
  if (input.viewBranch && input.viewBranch !== branch) return blocked('branch-mismatch', `LazyGitVS: this Commits view is for ${input.viewBranch}, but HEAD is on ${branch}.`);
  const head = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const commits: SelectedCommit[] = [];
  for (const todoHash of selected.hashes) {
    const hash = (await runGit(input.repoPath, ['rev-parse', '--verify', `${todoHash}^{commit}`])).trim();
    if (!await isAncestor(input.repoPath, hash)) return blocked('unreachable', `LazyGitVS: selected commit ${todoHash} is no longer reachable from HEAD.`);
    const parents = await commitParents(input.repoPath, hash);
    if (parents.length > 2) return blocked('merge-commit', 'LazyGitVS: Cannot squash or fixup a merge commit.');
    commits.push({ todoHash, hash, parent: parents[1] });
  }
  const target = (await runGit(input.repoPath, ['rev-parse', '--verify', `${selected.targetTodoHash}^{commit}`])).trim();
  if (!await isAncestor(input.repoPath, target)) return blocked('unreachable', `LazyGitVS: commit below the selection ${selected.targetTodoHash} is no longer reachable from HEAD.`);
  const oldest = commits[commits.length - 1];
  if (oldest.parent !== target || commits.some((commit, index) => index + 1 < commits.length && commit.parent !== commits[index + 1].hash)) {
    return blocked('target-mismatch', 'LazyGitVS: selected commits must form one contiguous history above the commit below.');
  }
  const targetParents = await commitParents(input.repoPath, target);
  const base = targetParents[1];
  return { branch, head, startIndex: selected.startIndex, commits, targetTodoHash: selected.targetTodoHash, target, base, useRoot: !base };
}

function samePreparedFixup(initial: PreparedFixup, final: PreparedFixup): boolean {
  return initial.branch === final.branch && initial.head === final.head && initial.targetTodoHash === final.targetTodoHash && initial.target === final.target && initial.base === final.base && initial.useRoot === final.useRoot && initial.commits.length === final.commits.length && initial.commits.every((commit, index) => commit.hash === final.commits[index].hash && commit.todoHash === final.commits[index].todoHash && commit.parent === final.commits[index].parent);
}

export function rewriteFixupTodo(todo: string, hashes: readonly string[], actionFlag: RebaseTodoActionFlag = ''): string {
  return rewriteSelectedPickTodo(todo, hashes, 'fixup', actionFlag);
}

export async function fixupSelectedCommits(input: CommitFixupInput): Promise<CommitFixupOutcome> {
  const initial = await preflight(input);
  if ('kind' in initial) return initial;
  const actionFlag = await input.chooseAction();
  if (actionFlag === undefined) return { kind: 'cancelled' };
  if (actionFlag !== '' && actionFlag !== '-C') throw new Error('LazyGitVS: Fixup menu action is invalid.');
  const final = await preflight(input);
  if ('kind' in final) return final;
  if (!samePreparedFixup(initial, final)) return blocked('drift', 'LazyGitVS: repository changed while the Fixup menu was open; Fixup was not started.');
  const hashes = initial.commits.map(commit => commit.todoHash);
  input.onStart?.();
  try {
    await runSelectedCommitRebase({ repoPath: input.repoPath, hashes, action: 'fixup', actionFlag, base: initial.base, useRoot: initial.useRoot, temporaryDirectoryPrefix: 'lazygitvs-fixup-' });
    return { kind: 'success', startIndex: initial.startIndex, hashes };
  } catch (error) {
    const activeOperation = detectGitOperationState(input.repoPath); if (activeOperation) return { kind: 'rebase-active', message: `LazyGitVS: Fixup left ${activeOperation.label} active. Resolve, continue, skip, or abort it from Status.` };
    throw error;
  }
}
