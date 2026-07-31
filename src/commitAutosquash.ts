import * as cp from 'child_process';
import { type CommitRangeSelection } from './commitCherryPick';
import { detectGitOperationState } from './gitOperationState';
import type { GitMenuItem } from './gitMenus';

export const APPLY_FIXUP_COMMITS_TITLE = 'Apply fixup commits';
export const APPLY_FIXUP_COMMITS_MENU_ITEMS = [
  {
    key: 'a',
    label: 'Above the selected commit',
    tooltip: "Squash all 'fixup!' commits above the selected commit (autosquash).",
  },
] as const;
export const SQUASHING_STATUS = 'Squashing';
export const AUTOSQUASH_REBASE_ARGS = ['rebase', '--interactive', '--rebase-merges', '--autostash', '--autosquash'];

export type ApplyFixupCommitsAction = typeof APPLY_FIXUP_COMMITS_MENU_ITEMS[number]['key'];
type GitFailure = Error & { code?: number | string };

export type CommitAutosquashBlockReason =
  | 'multiple-commits'
  | 'branch-view'
  | 'empty-selection'
  | 'invalid-selection'
  | 'active-operation'
  | 'dirty-worktree'
  | 'gpg-signing'
  | 'detached-head'
  | 'unreachable'
  | 'merge-commit'
  | 'unsupported-history'
  | 'drift';

export type CommitAutosquashOutcome =
  | {
      kind: 'success';
      selectionOffset: number;
      selectedIndex: number;
      selectedAfterHash: string;
      beforeFirstParent: string[];
      afterFirstParent: string[];
    }
  | { kind: 'cancelled' }
  | { kind: 'blocked'; reason: CommitAutosquashBlockReason; message: string }
  | { kind: 'rebase-active'; message: string };

export type CommitAutosquashInput = {
  repoPath: string;
  visibleHashes: readonly string[];
  selectedIndex: number;
  range: CommitRangeSelection;
  isLocalCommits: boolean;
  chooseAction: () => Promise<ApplyFixupCommitsAction | undefined>;
  onStart?: () => void;
};

type PreparedAutosquash = {
  branch: string;
  head: string;
  selectedIndex: number;
  todoHash: string;
  hash: string;
  parent?: string;
  message: string;
  firstParent: string[];
  selectedOrder: number;
};
type Preflight = PreparedAutosquash | Extract<CommitAutosquashOutcome, { kind: 'blocked' }>;

function blocked(reason: CommitAutosquashBlockReason, message: string): Extract<CommitAutosquashOutcome, { kind: 'blocked' }> {
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

function selectedTodoHash(input: CommitAutosquashInput): string | Extract<CommitAutosquashOutcome, { kind: 'blocked' }> {
  if (input.range.mode !== 'none') return blocked('multiple-commits', 'LazyGitVS: Apply fixup commits supports one selected commit; clear the visual range first.');
  if (!input.isLocalCommits) return blocked('branch-view', 'LazyGitVS: Apply fixup commits is only available from the attached top-level Local Commits view.');
  if (!Number.isInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex >= input.visibleHashes.length) {
    return blocked('empty-selection', 'LazyGitVS: no visible commit is selected to apply fixups above.');
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

async function firstParentHistory(cwd: string): Promise<string[]> {
  const output = (await runGit(cwd, ['rev-list', '--first-parent', 'HEAD'])).trim();
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

async function preflight(input: CommitAutosquashInput): Promise<Preflight> {
  const todoHash = selectedTodoHash(input);
  if (typeof todoHash !== 'string') return todoHash;
  const operation = detectGitOperationState(input.repoPath);
  if (operation) return blocked('active-operation', `LazyGitVS: cannot apply fixup commits while ${operation.label}. Resolve it from Status first.`);
  const status = await runGit(input.repoPath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim()) return blocked('dirty-worktree', 'LazyGitVS: Apply fixup commits requires a clean working tree including staged, unstaged, and untracked changes; dirty-tree auto-stash is not supported.');
  if (await gpgSigningEnabled(input.repoPath)) return blocked('gpg-signing', 'LazyGitVS: Apply fixup commits is disabled while commit.gpgSign is true.');
  const branch = await currentBranch(input.repoPath);
  if (!branch) return blocked('detached-head', 'LazyGitVS: Apply fixup commits requires an attached HEAD on the current local branch.');
  const head = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  let hash: string;
  try {
    hash = (await runGit(input.repoPath, ['rev-parse', '--verify', `${todoHash}^{commit}`])).trim();
  } catch {
    return blocked('unreachable', `LazyGitVS: selected commit ${todoHash} no longer resolves to a reachable commit.`);
  }
  if (!await isAncestor(input.repoPath, hash)) return blocked('unreachable', `LazyGitVS: selected commit ${todoHash} is no longer reachable from HEAD.`);
  const parents = (await runGit(input.repoPath, ['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/).filter(Boolean);
  if (parents.length > 2) return blocked('merge-commit', 'LazyGitVS: Apply fixup commits currently supports ordinary non-merge commits only.');
  const message = await runGit(input.repoPath, ['show', '-s', '--format=%B', hash]);
  const firstParent = await firstParentHistory(input.repoPath);
  const visiblePrefix = input.visibleHashes.slice(0, input.selectedIndex + 1).map(value => value.trim());
  if (visiblePrefix.some((value, index) => !value || !firstParent[index]?.startsWith(value))) {
    return blocked('unsupported-history', 'LazyGitVS: Apply fixup commits currently requires an unfiltered linear first-parent history above the selected commit.');
  }
  return { branch, head, selectedIndex: input.selectedIndex, todoHash, hash, parent: parents[1], message, firstParent, selectedOrder: firstParent.indexOf(hash) };
}

function samePreparedAutosquash(initial: PreparedAutosquash, final: PreparedAutosquash): boolean {
  return initial.branch === final.branch
    && initial.head === final.head
    && initial.selectedIndex === final.selectedIndex
    && initial.todoHash === final.todoHash
    && initial.hash === final.hash
    && initial.parent === final.parent
    && initial.message === final.message
    && initial.selectedOrder === final.selectedOrder
    && initial.firstParent.length === final.firstParent.length
    && initial.firstParent.every((hash, index) => hash === final.firstParent[index]);
}

function selectionRecovery(initial: PreparedAutosquash, afterFirstParent: string[]): Pick<Extract<CommitAutosquashOutcome, { kind: 'success' }>, 'selectionOffset' | 'selectedIndex' | 'selectedAfterHash'> {
  const beforeParentIndex = initial.parent ? initial.firstParent.indexOf(initial.parent) : -1;
  const afterParentIndex = initial.parent ? afterFirstParent.indexOf(initial.parent) : -1;
  const selectionOffset = beforeParentIndex >= 0 && afterParentIndex >= 0
    ? Math.max(0, beforeParentIndex - afterParentIndex)
    : Math.max(0, initial.firstParent.length - afterFirstParent.length);
  const selectedIndex = Math.max(0, initial.selectedIndex - selectionOffset);
  const selectedAfterHash = afterParentIndex > 0
    ? afterFirstParent[afterParentIndex - 1]
    : initial.parent === undefined
      ? afterFirstParent[afterFirstParent.length - 1]
      : afterFirstParent[selectedIndex];
  if (!selectedAfterHash) throw new Error('LazyGitVS: autosquash completed without a recoverable selected commit.');
  return { selectionOffset, selectedIndex, selectedAfterHash };
}

function autosquashEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_SEQUENCE_EDITOR: 'true',
    GIT_EDITOR: 'true',
    LANG: 'C',
    LC_ALL: 'C',
    LC_MESSAGES: 'C',
  };
}

export async function applyFixupCommitsAboveSelected(input: CommitAutosquashInput): Promise<CommitAutosquashOutcome> {
  const initial = await preflight(input);
  if ('kind' in initial) return initial;
  const action = await input.chooseAction();
  if (action === undefined) return { kind: 'cancelled' };
  if (action !== 'a') throw new Error('LazyGitVS: Apply fixup commits menu action is invalid.');
  const final = await preflight(input);
  if ('kind' in final || !samePreparedAutosquash(initial, final)) return blocked('drift', 'LazyGitVS: repository changed while the Apply fixup commits menu was open; autosquash was not started.');
  input.onStart?.();
  try {
    await runGit(input.repoPath, [...AUTOSQUASH_REBASE_ARGS, initial.parent ? `${initial.hash}^` : '--root'], autosquashEnvironment());
    const afterFirstParent = await firstParentHistory(input.repoPath);
    return {
      kind: 'success',
      ...selectionRecovery(initial, afterFirstParent),
      beforeFirstParent: initial.firstParent,
      afterFirstParent,
    };
  } catch (error) {
    const operation = detectGitOperationState(input.repoPath);
    if (operation) return { kind: 'rebase-active', message: `LazyGitVS: Apply fixup commits left ${operation.label} active. Resolve, continue, skip, or abort it from Status.` };
    throw error;
  }
}

export async function chooseApplyFixupCommitsAction(showMenu: (title: string, items: GitMenuItem[]) => Promise<boolean>): Promise<ApplyFixupCommitsAction | undefined> {
  let choice: ApplyFixupCommitsAction | undefined;
  await showMenu(APPLY_FIXUP_COMMITS_TITLE, APPLY_FIXUP_COMMITS_MENU_ITEMS.map(item => ({
    key: item.key,
    label: item.label,
    description: item.tooltip,
    run: async () => { choice = item.key; },
  })));
  return choice;
}

type CommitAutosquashMenuInput = Omit<CommitAutosquashInput, 'onStart'> & {
  key: string;
  onStatus: (status: string) => void;
  onMessage?: (message: string) => void;
  onSuccess?: (outcome: Extract<CommitAutosquashOutcome, { kind: 'success' }>) => void | Promise<void>;
};

export function commitAutosquashMenuItem(input: CommitAutosquashMenuInput): GitMenuItem {
  const { key, onStatus, onMessage, onSuccess, ...autosquashInput } = input;
  return {
    key,
    label: '$(combine) Apply fixup commits',
    description: 'autosquash above selected commit',
    run: async () => {
      let transientStatus = false;
      try {
        const outcome = await applyFixupCommitsAboveSelected({
          ...autosquashInput,
          onStart: () => {
            transientStatus = true;
            onStatus(SQUASHING_STATUS);
          },
        });
        if (outcome.kind === 'success') await onSuccess?.(outcome);
        else if (outcome.kind === 'blocked' || outcome.kind === 'rebase-active') {
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
