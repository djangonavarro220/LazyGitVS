import * as cp from 'child_process';
import { type CommitRangeSelection } from './commitCherryPick';
import { runSelectedCommitRebase } from './commitRebaseTodo';
import { detectGitOperationState } from './gitOperationState';
import type { GitMenuItem } from './gitMenus';

export const REWORD_COMMIT_TITLE = 'Reword commit';
export const REWORDING_STATUS = 'Rewording';

type GitFailure = Error & { code?: number | string };
export type CommitRewordBlockReason =
  | 'multiple-commits'
  | 'branch-view'
  | 'empty-selection'
  | 'invalid-selection'
  | 'invalid-summary'
  | 'active-operation'
  | 'dirty-worktree'
  | 'gpg-signing'
  | 'detached-head'
  | 'unreachable'
  | 'merge-commit'
  | 'drift';
export type CommitRewordOutcome =
  | { kind: 'success'; startIndex: number }
  | { kind: 'cancelled' }
  | { kind: 'blocked'; reason: CommitRewordBlockReason; message: string }
  | { kind: 'rebase-active'; message: string };

export type CommitRewordInput = {
  repoPath: string;
  visibleHashes: readonly string[];
  selectedIndex: number;
  range: CommitRangeSelection;
  isLocalCommits: boolean;
  prompt: (title: string, initialSummary: string) => Promise<string | undefined>;
  onStart?: () => void;
};

type PreparedReword = {
  branch: string;
  head: string;
  todoHash: string;
  hash: string;
  parent?: string;
  fullMessage: string;
  summary: string;
  body: string;
};
type Preflight = PreparedReword | Extract<CommitRewordOutcome, { kind: 'blocked' }>;

function blocked(reason: CommitRewordBlockReason, message: string): Extract<CommitRewordOutcome, { kind: 'blocked' }> {
  return { kind: 'blocked', reason, message };
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

function selectedTodoHash(input: CommitRewordInput): string | Extract<CommitRewordOutcome, { kind: 'blocked' }> {
  if (input.range.mode !== 'none') return blocked('multiple-commits', 'LazyGitVS: Reword supports one selected commit; clear the visual range first.');
  if (!input.isLocalCommits) return blocked('branch-view', 'LazyGitVS: Reword is only available from the attached Local Commits view.');
  if (!Number.isInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex >= input.visibleHashes.length) {
    return blocked('empty-selection', 'LazyGitVS: no visible commit is selected to reword.');
  }
  const hash = input.visibleHashes[input.selectedIndex]?.trim();
  if (!hash) return blocked('invalid-selection', 'LazyGitVS: selected commit must have a valid visible hash.');
  return hash;
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
  try {
    return (await runGit(cwd, ['config', '--bool', '--get', 'commit.gpgSign'])).trim() === 'true';
  } catch (error) {
    if ((error as GitFailure).code === 1) return false;
    throw error;
  }
}

function splitCapturedMessage(fullMessage: string): { summary: string; body: string } {
  // --format=%B appends its own record newline. Remove exactly that framing byte,
  // retaining the stored message body, including its own trailing newline.
  const message = fullMessage.endsWith('\n') ? fullMessage.slice(0, -1) : fullMessage;
  const boundary = message.indexOf('\n');
  return boundary < 0
    ? { summary: message, body: '' }
    : { summary: message.slice(0, boundary), body: message.slice(boundary + 1) };
}

function validSummary(summary: string): boolean {
  return !!summary.trim() && !/[\r\n]/.test(summary);
}

async function preflight(input: CommitRewordInput): Promise<Preflight> {
  const todoHash = selectedTodoHash(input);
  if (typeof todoHash !== 'string') return todoHash;
  const operation = detectGitOperationState(input.repoPath);
  if (operation) return blocked('active-operation', `LazyGitVS: cannot reword commits while ${operation.label}. Resolve it from Status first.`);
  const status = await runGit(input.repoPath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim()) return blocked('dirty-worktree', 'LazyGitVS: Reword requires a clean working tree including staged, unstaged, and untracked changes; dirty-tree auto-stash is not supported.');
  if (await gpgSigningEnabled(input.repoPath)) return blocked('gpg-signing', 'LazyGitVS: Reword is disabled while commit.gpgSign is true.');
  const branch = await currentBranch(input.repoPath);
  if (!branch) return blocked('detached-head', 'LazyGitVS: Reword requires an attached HEAD on the current local branch.');
  const head = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const hash = (await runGit(input.repoPath, ['rev-parse', '--verify', `${todoHash}^{commit}`])).trim();
  if (!await isAncestor(input.repoPath, hash)) return blocked('unreachable', `LazyGitVS: selected commit ${todoHash} is no longer reachable from HEAD.`);
  const parents = (await runGit(input.repoPath, ['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/).filter(Boolean);
  if (parents.length > 2) return blocked('merge-commit', 'LazyGitVS: Reword currently supports ordinary non-merge commits only.');
  const fullMessage = await runGit(input.repoPath, ['show', '-s', '--format=%B', hash]);
  const { summary, body } = splitCapturedMessage(fullMessage);
  return { branch, head, todoHash, hash, parent: parents[1], fullMessage, summary, body };
}

function samePreparedReword(initial: PreparedReword, final: PreparedReword): boolean {
  return initial.branch === final.branch
    && initial.head === final.head
    && initial.todoHash === final.todoHash
    && initial.hash === final.hash
    && initial.parent === final.parent
    && initial.fullMessage === final.fullMessage;
}

export function rewordAmendArgs(summary: string, body: string): string[] {
  return ['commit', '--allow-empty', '--amend', '--only', '-m', summary, ...(body ? ['-m', body] : [])];
}

export async function rewordSelectedCommit(input: CommitRewordInput): Promise<CommitRewordOutcome> {
  const initial = await preflight(input);
  if ('kind' in initial) return initial;
  const summary = await input.prompt(REWORD_COMMIT_TITLE, initial.summary);
  if (summary === undefined) return { kind: 'cancelled' };
  if (!validSummary(summary)) return blocked('invalid-summary', 'LazyGitVS: Reword requires a non-empty one-line commit summary.');
  const final = await preflight(input);
  if ('kind' in final) return final;
  if (!samePreparedReword(initial, final)) return blocked('drift', 'LazyGitVS: repository changed while Reword input was open; Reword was not started.');
  input.onStart?.();
  try {
    if (initial.hash === initial.head) {
      await runGit(input.repoPath, rewordAmendArgs(summary, initial.body), rebaseEnv());
      return { kind: 'success', startIndex: input.selectedIndex };
    }
    await runSelectedCommitRebase({
      repoPath: input.repoPath,
      hashes: [initial.todoHash],
      action: 'edit',
      base: initial.parent,
      useRoot: !initial.parent,
      keepEmpty: false,
      temporaryDirectoryPrefix: 'lazygitvs-reword-',
    });
    const operation = detectGitOperationState(input.repoPath);
    if (operation?.kind !== 'rebase') throw new Error('LazyGitVS: interactive rebase did not stop at the selected commit.');
    const stoppedHead = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    if (stoppedHead !== initial.hash) throw new Error('LazyGitVS: interactive rebase stopped at an unexpected commit; no message was amended.');
    await runGit(input.repoPath, rewordAmendArgs(summary, initial.body), rebaseEnv());
    await runGit(input.repoPath, ['rebase', '--continue'], rebaseEnv());
    return { kind: 'success', startIndex: input.selectedIndex };
  } catch (error) {
    const operation = detectGitOperationState(input.repoPath);
    if (operation) return { kind: 'rebase-active', message: `LazyGitVS: Reword stopped while ${operation.label}. Resolve, continue, skip, or abort it from Status.` };
    throw error;
  }
}

type CommitRewordMenuInput = Omit<CommitRewordInput, 'onStart'> & {
  key: string;
  onStatus: (status: string) => void;
  onMessage?: (message: string) => void;
};

export function commitRewordMenuItem(input: CommitRewordMenuInput): GitMenuItem {
  const { key, onStatus, onMessage, ...rewordInput } = input;
  return {
    key,
    label: '$(edit) Reword commit',
    description: 'selected ordinary commit only',
    run: async () => {
      let transientStatus = false;
      try {
        const outcome = await rewordSelectedCommit({
          ...rewordInput,
          onStart: () => {
            transientStatus = true;
            onStatus(REWORDING_STATUS);
          },
        });
        if (outcome.kind === 'blocked' || outcome.kind === 'rebase-active') {
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
