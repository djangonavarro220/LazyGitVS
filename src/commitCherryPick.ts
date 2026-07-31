export type CommitRangeMode = 'none' | 'sticky' | 'nonsticky';

export type CommitRangeSelection =
  | { mode: 'none' }
  | { mode: 'sticky' | 'nonsticky'; anchor: number };

export type CherryPickBuffer = {
  sourceRepoPath?: string;
  sourceListContext?: string;
  hashes: string[];
  didPaste: boolean;
};

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const CHERRY_PICK_TITLE = 'Cherry-pick';
export const EMPTY_COMMIT_RANGE: CommitRangeSelection = { mode: 'none' };
export const EMPTY_CHERRY_PICK_BUFFER: CherryPickBuffer = { hashes: [], didPaste: false };

function clamp(index: number, length: number): number {
  return length > 0 ? Math.max(0, Math.min(length - 1, index)) : 0;
}

function uniqueHashes(hashes: readonly string[]): string[] {
  return Array.from(new Set(hashes.filter(Boolean)));
}

export function toggleStickyCommitRange(range: CommitRangeSelection, selectedIndex: number): CommitRangeSelection {
  return range.mode === 'none' ? { mode: 'sticky', anchor: selectedIndex } : EMPTY_COMMIT_RANGE;
}

export function moveCommitSelection(range: CommitRangeSelection, selectedIndex: number, delta: number, listLength: number): { range: CommitRangeSelection; selected: number } {
  return {
    range: range.mode === 'nonsticky' ? EMPTY_COMMIT_RANGE : range,
    selected: clamp(selectedIndex + delta, listLength)
  };
}

export function extendNonStickyCommitRange(range: CommitRangeSelection, selectedIndex: number, delta: number, listLength: number): { range: CommitRangeSelection; selected: number } {
  const anchor = range.mode === 'none' ? selectedIndex : range.anchor;
  return {
    range: { mode: 'nonsticky', anchor },
    selected: clamp(selectedIndex + delta, listLength)
  };
}

export function clampCommitRange(range: CommitRangeSelection, listLength: number): CommitRangeSelection {
  if (range.mode === 'none' || listLength <= 0) return listLength <= 0 ? EMPTY_COMMIT_RANGE : range;
  return { ...range, anchor: clamp(range.anchor, listLength) };
}

export function commitRangeBounds(range: CommitRangeSelection, selectedIndex: number, listLength: number): [number, number] {
  if (listLength <= 0) return [0, -1];
  const selected = clamp(selectedIndex, listLength);
  if (range.mode === 'none') return [selected, selected];
  const anchor = clamp(range.anchor, listLength);
  return [Math.min(anchor, selected), Math.max(anchor, selected)];
}

export function isCommitInRange(range: CommitRangeSelection, selectedIndex: number, index: number, listLength: number): boolean {
  const [start, end] = commitRangeBounds(range, selectedIndex, listLength);
  return index >= start && index <= end;
}

export function toggleCopiedCommitRange(
  buffer: CherryPickBuffer,
  input: {
    repoPath: string;
    listContext: string;
    newestFirstHashes: readonly string[];
    range: CommitRangeSelection;
    selectedIndex: number;
  }
): CherryPickBuffer {
  const hashes = uniqueHashes(input.newestFirstHashes);
  const [start, end] = commitRangeBounds(input.range, input.selectedIndex, hashes.length);
  const selectedHashes = end >= start ? hashes.slice(start, end + 1) : [];
  const sameSource = buffer.sourceRepoPath === input.repoPath && buffer.sourceListContext === input.listContext;
  const copied = new Set(sameSource ? buffer.hashes : []);
  const allCopied = selectedHashes.length > 0 && selectedHashes.every(hash => copied.has(hash));

  if (allCopied) selectedHashes.forEach(hash => copied.delete(hash));
  else selectedHashes.forEach(hash => copied.add(hash));

  return {
    sourceRepoPath: input.repoPath,
    sourceListContext: input.listContext,
    hashes: hashes.filter(hash => copied.has(hash)),
    didPaste: false
  };
}

export function resetCherryPickBuffer(): CherryPickBuffer {
  return { hashes: [], didPaste: false };
}

export function hasVisibleCopiedCommit(buffer: CherryPickBuffer, input: { repoPath: string; listContext: string; hash: string }): boolean {
  return !buffer.didPaste && buffer.sourceRepoPath === input.repoPath && buffer.sourceListContext === input.listContext && buffer.hashes.includes(input.hash);
}

export function cherryPickArgs(buffer: Pick<CherryPickBuffer, 'hashes'>): string[] {
  return ['cherry-pick', ...buffer.hashes.slice().reverse()];
}

export function cherryPickPrompt(count: number): string {
  return `Are you sure you want to cherry-pick the ${count} copied commit(s) onto this branch?`;
}

export function findCommitIndexByHash(hashes: readonly string[], hash: string | undefined, fallback: number): number {
  if (!hash) return fallback;
  const index = hashes.indexOf(hash);
  return index >= 0 ? index : fallback;
}

type CherryPickPreflightOutcome =
  | { kind: 'ready' }
  | { kind: 'empty'; message: string }
  | { kind: 'source-mismatch'; message: string; buffer: CherryPickBuffer }
  | { kind: 'dirty-worktree'; message: string }
  | { kind: 'merge-commit'; message: string };

export type CherryPickPasteOutcome =
  | { kind: 'success'; buffer: CherryPickBuffer }
  | { kind: 'cancelled'; buffer: CherryPickBuffer }
  | Exclude<CherryPickPreflightOutcome, { kind: 'ready' }>;

const emptyMessage = 'LazyGitVS: no copied commits to cherry-pick.';
const sourceMismatchMessage = 'LazyGitVS: copied commits belong to a different repository; the copied selection was cleared.';
const dirtyWorktreeMessage = 'LazyGitVS: cherry-pick requires a clean working tree; auto-stash is deferred for this partial parity slice.';
const mergeCommitMessage = 'LazyGitVS: cherry-pick of merge commits is not supported in this partial parity slice.';

async function preflightCherryPick(buffer: CherryPickBuffer, targetRepoPath: string, runGit: GitRunner): Promise<CherryPickPreflightOutcome> {
  if (!buffer.hashes.length) return { kind: 'empty', message: emptyMessage };
  if (!buffer.sourceRepoPath || buffer.sourceRepoPath !== targetRepoPath) {
    return { kind: 'source-mismatch', message: sourceMismatchMessage, buffer: resetCherryPickBuffer() };
  }

  const status = await runGit(['status', '--porcelain'], targetRepoPath);
  if (status.trim()) return { kind: 'dirty-worktree', message: dirtyWorktreeMessage };

  for (const hash of buffer.hashes) {
    const parents = (await runGit(['rev-list', '--parents', '-n', '1', hash], targetRepoPath)).trim().split(/\s+/).filter(Boolean);
    if (parents.length > 2) return { kind: 'merge-commit', message: mergeCommitMessage };
  }

  return { kind: 'ready' };
}

export async function pasteCopiedCommits(input: {
  buffer: CherryPickBuffer;
  targetRepoPath: string;
  runGit: GitRunner;
  confirm: (title: string, prompt: string) => Promise<boolean>;
}): Promise<CherryPickPasteOutcome> {
  const firstPreflight = await preflightCherryPick(input.buffer, input.targetRepoPath, input.runGit);
  if (firstPreflight.kind !== 'ready') return firstPreflight;

  const accepted = await input.confirm(CHERRY_PICK_TITLE, cherryPickPrompt(input.buffer.hashes.length));
  if (!accepted) return { kind: 'cancelled', buffer: input.buffer };

  // The working tree can change while a modal confirmation is open, so verify the
  // same bounded preconditions immediately before the sole mutating argv call.
  const finalPreflight = await preflightCherryPick(input.buffer, input.targetRepoPath, input.runGit);
  if (finalPreflight.kind !== 'ready') return finalPreflight;

  await input.runGit(cherryPickArgs(input.buffer), input.targetRepoPath);
  return { kind: 'success', buffer: { ...input.buffer, hashes: [...input.buffer.hashes], didPaste: true } };
}
