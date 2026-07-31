import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { type CommitRangeSelection } from './commitCherryPick';
import { detectGitOperationState } from './gitOperationState';
import type { GitMenuItem } from './gitMenus';

export const CREATE_FIXUP_COMMIT_TITLE = 'Create fixup commit';
export const CREATING_FIXUP_COMMIT_STATUS = 'Creating fixup commit';
export const NO_FILES_STAGED_TITLE = 'No files staged';
export const NO_FILES_STAGED_PROMPT = 'You have not staged any files. Commit all files?';
export const CREATE_FIXUP_COMMIT_MENU_ITEMS = [
  { key: 'f', label: 'fixup! commit' },
  { key: 'a', label: 'amend! commit with changes' },
  { key: 'r', label: 'amend! commit without changes (pure reword)' },
] as const;

export type CreateFixupCommitAction = typeof CREATE_FIXUP_COMMIT_MENU_ITEMS[number]['key'];
export type CreateFixupCommitMenuItem = typeof CREATE_FIXUP_COMMIT_MENU_ITEMS[number] & { description?: string; disabled?: boolean };

type GitFailure = Error & { code?: number | string };
type WorktreeSnapshot = {
  status: string;
  stagedDiff: string;
  unstagedDiff: string;
  untracked: string;
  untrackedContent: string;
};
type PreparedCreateFixup = {
  branch: string;
  head: string;
  hash: string;
  visibleHash: string;
  fullMessage: string;
  originalSubject: string;
  originalBody: string;
  headTree: string;
  worktree: WorktreeSnapshot;
};

export type CreateFixupCommitBlockReason =
  | 'branch-view'
  | 'multiple-commits'
  | 'empty-selection'
  | 'invalid-selection'
  | 'active-operation'
  | 'conflicts'
  | 'gpg-signing'
  | 'detached-head'
  | 'unreachable'
  | 'merge-commit'
  | 'no-files-staged'
  | 'drift';
export type CreateFixupCommitOutcome =
  | { kind: 'success'; action: CreateFixupCommitAction; selectionIndex: number; selectedIndex: number; targetHash: string; commitHash: string }
  | { kind: 'cancelled' }
  | { kind: 'blocked'; reason: CreateFixupCommitBlockReason; message: string };

export type CreateFixupCommitInput = {
  repoPath: string;
  visibleHashes: readonly string[];
  selectedIndex: number;
  range: CommitRangeSelection;
  isLocalCommits: boolean;
  chooseAction: (items: readonly CreateFixupCommitMenuItem[]) => Promise<CreateFixupCommitAction | undefined>;
  prompt: (title: string, value: string) => Promise<string | undefined>;
  confirm: (title: string, prompt: string) => Promise<boolean>;
  onStart?: () => void;
};

type Preflight = PreparedCreateFixup | Extract<CreateFixupCommitOutcome, { kind: 'blocked' }>;

function blocked(reason: CreateFixupCommitBlockReason, message: string): Extract<CreateFixupCommitOutcome, { kind: 'blocked' }> {
  return { kind: 'blocked', reason, message };
}

function localeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, LANG: 'C', LC_ALL: 'C', LC_MESSAGES: 'C' };
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: localeEnv() }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error((stderr || stdout || error.message).trim()) as GitFailure;
        failure.code = error.code ?? undefined;
        reject(failure);
      } else resolve(String(stdout ?? ''));
    });
  });
}

function splitCommitMessage(fullMessage: string): { summary: string; body: string } {
  const message = fullMessage.endsWith('\n') ? fullMessage.slice(0, -1) : fullMessage;
  const boundary = message.indexOf('\n');
  return boundary < 0 ? { summary: message, body: '' } : { summary: message.slice(0, boundary), body: message.slice(boundary + 1) };
}

function validHash(hash: string): boolean {
  return /^[0-9a-f]{4,64}$/i.test(hash);
}

function hasConflicts(status: string): boolean {
  return status.split('\0').some(entry => {
    const xy = entry.slice(0, 2);
    return ['AA', 'AU', 'UA', 'DD', 'DU', 'UD'].includes(xy) || xy.includes('U');
  });
}

function untrackedPaths(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

async function untrackedContent(cwd: string, output: string): Promise<string> {
  const entries: string[] = [];
  for (const file of untrackedPaths(output)) {
    const absolute = path.resolve(cwd, file);
    const bytes = await fs.promises.readFile(absolute);
    entries.push(`${file}\0${crypto.createHash('sha256').update(bytes).digest('hex')}`);
  }
  return entries.join('\0');
}

async function worktreeSnapshot(cwd: string): Promise<WorktreeSnapshot> {
  const [status, stagedDiff, unstagedDiff, untracked] = await Promise.all([
    runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=all', '-z']),
    runGit(cwd, ['diff', '--cached', '--binary', '--no-ext-diff']),
    runGit(cwd, ['diff', '--binary', '--no-ext-diff']),
    runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  return { status, stagedDiff, unstagedDiff, untracked, untrackedContent: await untrackedContent(cwd, untracked) };
}

function sameWorktree(a: WorktreeSnapshot, b: WorktreeSnapshot): boolean {
  return a.status === b.status && a.stagedDiff === b.stagedDiff && a.unstagedDiff === b.unstagedDiff && a.untracked === b.untracked && a.untrackedContent === b.untrackedContent;
}

function sameTarget(a: PreparedCreateFixup, b: PreparedCreateFixup): boolean {
  return a.branch === b.branch && a.head === b.head && a.hash === b.hash && a.visibleHash === b.visibleHash && a.fullMessage === b.fullMessage && a.originalSubject === b.originalSubject && a.originalBody === b.originalBody && a.headTree === b.headTree;
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

async function gpgSigningEnabled(cwd: string): Promise<boolean> {
  try {
    return (await runGit(cwd, ['config', '--bool', '--get', 'commit.gpgSign'])).trim().toLowerCase() === 'true';
  } catch (error) {
    if ((error as GitFailure).code === 1) return false;
    throw error;
  }
}

async function selectedHash(input: CreateFixupCommitInput): Promise<string | Extract<CreateFixupCommitOutcome, { kind: 'blocked' }>> {
  if (!input.isLocalCommits) return blocked('branch-view', 'LazyGitVS: Create fixup commit is only available from the attached top-level Local Commits view.');
  if (input.range.mode !== 'none') return blocked('multiple-commits', 'LazyGitVS: Create fixup commit supports one selected commit; clear the visual range first.');
  if (!Number.isInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex >= input.visibleHashes.length) return blocked('empty-selection', 'LazyGitVS: no visible commit is selected for Create fixup commit.');
  const visibleHash = input.visibleHashes[input.selectedIndex]?.trim();
  if (!visibleHash || !validHash(visibleHash)) return blocked('invalid-selection', 'LazyGitVS: selected commit must have a valid visible hash.');
  return visibleHash;
}

async function preflight(input: CreateFixupCommitInput): Promise<Preflight> {
  const visibleHash = await selectedHash(input);
  if (typeof visibleHash !== 'string') return visibleHash;
  const worktree = await worktreeSnapshot(input.repoPath);
  if (hasConflicts(worktree.status)) return blocked('conflicts', 'LazyGitVS: Create fixup commit is disabled while conflicts are present. Resolve conflicts from Status first.');
  const operation = detectGitOperationState(input.repoPath);
  if (operation) return blocked('active-operation', `LazyGitVS: cannot create fixup commits while ${operation.label}. Resolve it from Status first.`);
  if (await gpgSigningEnabled(input.repoPath)) return blocked('gpg-signing', 'LazyGitVS: Create fixup commit is disabled while commit.gpgSign is true.');
  const branch = await currentBranch(input.repoPath);
  if (!branch) return blocked('detached-head', 'LazyGitVS: Create fixup commit requires an attached HEAD on the current local branch.');
  const head = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  let hash: string;
  try {
    hash = (await runGit(input.repoPath, ['rev-parse', '--verify', `${visibleHash}^{commit}`])).trim();
  } catch {
    return blocked('unreachable', `LazyGitVS: selected commit ${visibleHash} no longer resolves to a reachable commit.`);
  }
  try {
    await runGit(input.repoPath, ['merge-base', '--is-ancestor', hash, 'HEAD']);
  } catch (error) {
    if ((error as GitFailure).code === 1) return blocked('unreachable', `LazyGitVS: selected commit ${visibleHash} is no longer reachable from HEAD.`);
    throw error;
  }
  const parents = (await runGit(input.repoPath, ['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/).filter(Boolean);
  if (parents.length > 2) return blocked('merge-commit', 'LazyGitVS: Create fixup commit supports ordinary non-merge commits only.');
  const fullMessage = (await runGit(input.repoPath, ['log', '--format=%B', '--max-count=1', hash])).replace(/\r\n/g, '\n').trim();
  const { summary, body } = splitCommitMessage(fullMessage);
  const headTree = (await runGit(input.repoPath, ['rev-parse', 'HEAD^{tree}'])).trim();
  return { branch, head, hash, visibleHash, fullMessage, originalSubject: summary, originalBody: body, headTree, worktree };
}

function disabledMenuItems(prepared: PreparedCreateFixup): CreateFixupCommitMenuItem[] {
  const noFiles = !prepared.worktree.status;
  return CREATE_FIXUP_COMMIT_MENU_ITEMS.map(item => item.key === 'r' || !noFiles
    ? { ...item }
    : { ...item, disabled: true, description: NO_FILES_STAGED_TITLE });
}

function noFilesStaged(prepared: PreparedCreateFixup): Extract<CreateFixupCommitOutcome, { kind: 'blocked' }> {
  return blocked('no-files-staged', NO_FILES_STAGED_TITLE);
}

async function revalidate(initial: PreparedCreateFixup, input: CreateFixupCommitInput, allowWorktreeChange = false): Promise<PreparedCreateFixup | Extract<CreateFixupCommitOutcome, { kind: 'blocked' }>> {
  const final = await preflight(input);
  if ('kind' in final) return final;
  if (!sameTarget(initial, final) || (!allowWorktreeChange && !sameWorktree(initial.worktree, final.worktree))) return blocked('drift', 'LazyGitVS: repository, target, or working tree changed while Create fixup commit was open; no commit was started.');
  return final;
}

type CommittablePlan = { prepared: PreparedCreateFixup; stageAll: boolean };

async function ensureCommittable(initial: PreparedCreateFixup, input: CreateFixupCommitInput): Promise<CommittablePlan | Extract<CreateFixupCommitOutcome, { kind: 'blocked' }> | { kind: 'cancelled' }> {
  const selected = await revalidate(initial, input);
  if ('kind' in selected) return selected;
  if (!selected.worktree.status) return noFilesStaged(selected);
  if (selected.worktree.stagedDiff) return { prepared: selected, stageAll: false };
  if (!await input.confirm(NO_FILES_STAGED_TITLE, NO_FILES_STAGED_PROMPT)) return { kind: 'cancelled' };
  const afterConfirm = await revalidate(initial, input);
  if ('kind' in afterConfirm) return afterConfirm;
  return { prepared: afterConfirm, stageAll: true };
}

function validSummary(summary: string): boolean {
  return !!summary.trim() && !/[\r\n]/.test(summary);
}

export function fixupCommitArgs(fullHash: string): string[] {
  return ['commit', `--fixup=${fullHash}`];
}

export function amendCommitArgs(originalSubject: string, summary: string, body: string, includeFileChanges: boolean): string[] {
  const description = body ? `${summary}\n\n${body}` : summary;
  return ['commit', '-m', `amend! ${originalSubject}`, '-m', description, ...(includeFileChanges ? [] : ['--only', '--allow-empty'])];
}

async function commitPayload(cwd: string, ref: string): Promise<string> {
  const raw = await runGit(cwd, ['cat-file', '-p', ref]);
  const separator = raw.indexOf('\n\n');
  if (separator < 0) throw new Error('LazyGitVS: created commit has no message payload.');
  return raw.slice(separator + 2);
}

async function verifyCreatedCommit(input: CreateFixupCommitInput, prepared: PreparedCreateFixup, action: CreateFixupCommitAction, expectedMessage: string, expectedTree: string, beforeWorktree: WorktreeSnapshot): Promise<string> {
  const commitHash = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  if (commitHash === prepared.head) throw new Error('LazyGitVS: Create fixup commit did not advance HEAD.');
  const parents = (await runGit(input.repoPath, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(/\s+/).filter(Boolean);
  if (parents.length !== 2 || parents[1] !== prepared.head) throw new Error('LazyGitVS: Create fixup commit created an unexpected parent relationship.');
  const actualMessage = await commitPayload(input.repoPath, 'HEAD');
  if (actualMessage !== expectedMessage) throw new Error('LazyGitVS: Create fixup commit created an unexpected commit message.');
  const actualTree = (await runGit(input.repoPath, ['rev-parse', 'HEAD^{tree}'])).trim();
  if (actualTree !== expectedTree) throw new Error('LazyGitVS: Create fixup commit created an unexpected tree.');
  const afterWorktree = await worktreeSnapshot(input.repoPath);
  if (action === 'r') {
    if (!sameWorktree(beforeWorktree, afterWorktree)) throw new Error('LazyGitVS: amend! reword changed staged, unstaged, or untracked files.');
  } else if (afterWorktree.unstagedDiff !== beforeWorktree.unstagedDiff || afterWorktree.untracked !== beforeWorktree.untracked || afterWorktree.untrackedContent !== beforeWorktree.untrackedContent || afterWorktree.stagedDiff) {
    throw new Error('LazyGitVS: Create fixup commit changed files outside the staged commit.');
  }
  return commitHash;
}

export async function createFixupCommit(input: CreateFixupCommitInput): Promise<CreateFixupCommitOutcome> {
  const initial = await preflight(input);
  if ('kind' in initial) return initial;
  const action = await input.chooseAction(disabledMenuItems(initial));
  if (action === undefined) return { kind: 'cancelled' };
  if (!['f', 'a', 'r'].includes(action)) throw new Error('LazyGitVS: Create fixup commit menu action is invalid.');
  const afterMenu = await revalidate(initial, input);
  if ('kind' in afterMenu) return afterMenu;
  let prepared = afterMenu;
  let stageAll = false;
  let summary = prepared.originalSubject;
  let body = prepared.originalBody;
  if (action === 'f') {
    const committable = await ensureCommittable(prepared, input);
    if ('kind' in committable) return committable;
    prepared = committable.prepared;
    stageAll = committable.stageAll;
  } else if (action === 'a') {
    const committable = await ensureCommittable(prepared, input);
    if ('kind' in committable) return committable;
    prepared = committable.prepared;
    stageAll = committable.stageAll;
    const newSummary = await input.prompt('Create "amend!" commit', prepared.originalSubject);
    if (newSummary === undefined) return { kind: 'cancelled' };
    if (!validSummary(newSummary)) return blocked('drift', 'LazyGitVS: amend! commit requires a non-empty one-line commit summary.');
    summary = newSummary;
    const newBody = await input.prompt('Commit description', prepared.originalBody);
    if (newBody === undefined) return { kind: 'cancelled' };
    body = newBody;
    const afterInput = await revalidate(prepared, input);
    if ('kind' in afterInput) return afterInput;
    prepared = afterInput;
  } else {
    const newSummary = await input.prompt('Create "amend!" commit', prepared.originalSubject);
    if (newSummary === undefined) return { kind: 'cancelled' };
    if (!validSummary(newSummary)) return blocked('drift', 'LazyGitVS: amend! commit requires a non-empty one-line commit summary.');
    summary = newSummary;
    const newBody = await input.prompt('Commit description', prepared.originalBody);
    if (newBody === undefined) return { kind: 'cancelled' };
    body = newBody;
    const afterInput = await revalidate(prepared, input);
    if ('kind' in afterInput) return afterInput;
    prepared = afterInput;
  }
  if (stageAll) {
    const beforeStage = await revalidate(prepared, input);
    if ('kind' in beforeStage) return beforeStage;
    await runGit(input.repoPath, ['add', '--all']);
    const afterStage = await preflight(input);
    if ('kind' in afterStage) return afterStage;
    if (!sameTarget(prepared, afterStage) || !afterStage.worktree.stagedDiff) return blocked('drift', 'LazyGitVS: repository, target, or working tree changed while staging all files; no commit was started.');
    prepared = afterStage;
  }
  const final = await preflight(input);
  if ('kind' in final) return final;
  const expectedWorktree = prepared.worktree;
  if (!sameTarget(prepared, final) || !sameWorktree(expectedWorktree, final.worktree)) return blocked('drift', 'LazyGitVS: repository, target, or working tree changed before Create fixup commit started; no commit was started.');
  prepared = final;
  const expectedTree = action === 'r' ? prepared.headTree : (await runGit(input.repoPath, ['write-tree'])).trim();
  const expectedMessage = action === 'f'
    ? `fixup! ${prepared.originalSubject}\n`
    : `amend! ${prepared.originalSubject}\n\n${summary}${body ? `\n\n${body}` : ''}\n`;
  input.onStart?.();
  const args = action === 'f' ? fixupCommitArgs(prepared.hash) : amendCommitArgs(prepared.originalSubject, summary, body, action === 'a');
  await runGit(input.repoPath, args);
  const verifiedHash = await verifyCreatedCommit(input, prepared, action, expectedMessage, expectedTree, expectedWorktree);
  const selectionIndex = input.selectedIndex + 1;
  return { kind: 'success', action, selectionIndex, selectedIndex: selectionIndex, targetHash: prepared.hash, commitHash: verifiedHash };
}

type CreateFixupMenuInput = Omit<CreateFixupCommitInput, 'chooseAction' | 'onStart'> & {
  key: string;
  label?: string;
  showMenu: (title: string, items: GitMenuItem[]) => Promise<boolean>;
  onStatus: (status: string) => void;
  onMessage?: (message: string) => void;
  onSuccess?: (outcome: Extract<CreateFixupCommitOutcome, { kind: 'success' }>) => void | Promise<void>;
};

export function createFixupCommitMenuItem(input: CreateFixupMenuInput): GitMenuItem {
  const { key, label, showMenu, onStatus, onMessage, onSuccess, ...createInput } = input;
  return {
    key,
    label: label || '$(tools) Create fixup commit',
    description: 'fixup! / amend! commit for the selected commit',
    run: async () => {
      let transientStatus = false;
      try {
        const outcome = await createFixupCommit({
          ...createInput,
          chooseAction: async items => {
            let selected: CreateFixupCommitAction | undefined;
            await showMenu(CREATE_FIXUP_COMMIT_TITLE, items.map(item => ({
              ...item,
              run: async () => { selected = item.key; },
            })) as GitMenuItem[]);
            return selected;
          },
          onStart: () => {
            transientStatus = true;
            onStatus(CREATING_FIXUP_COMMIT_STATUS);
          },
        });
        if (outcome.kind === 'success') await onSuccess?.(outcome);
        else if (outcome.kind === 'blocked') {
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
