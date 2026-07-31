import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type CommitRangeSelection } from './commitCherryPick';
import { detectGitOperationState } from './gitOperationState';
import type { GitMenuItem } from './gitMenus';

export type CommitMoveDirection = 'down' | 'up';
export const MOVING_STATUS = 'Moving';
export const MOVE_COMMIT_DOWN_LABEL = 'Move commit down one';
export const MOVE_COMMIT_UP_LABEL = 'Move commit up one';
export const CANNOT_MOVE_ANY_FURTHER = 'Cannot move any further';
export const MOVE_REBASE_ARGS = ['rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges'];

type GitFailure = Error & { code?: number | string };
type HistoryCommit = { hash: string; tree: string; subject: string; author: string; message: string };
type CommitSnapshot = HistoryCommit & { todoHash: string; parent?: string; firstParentIndex: number };
type MoveSelection = { startIndex: number; endIndex: number; hashes: string[]; destinationTodoHash: string };
type SequenceEditor = { directory: string; command: string };

export type CommitMoveBlockReason =
  | 'branch-view'
  | 'active-operation'
  | 'empty-selection'
  | 'invalid-selection'
  | 'boundary'
  | 'dirty-worktree'
  | 'gpg-signing'
  | 'detached-head'
  | 'unreachable'
  | 'merge-commit'
  | 'unsupported-history'
  | 'drift';

export type CommitMoveOutcome =
  | { kind: 'success'; delta: 1 | -1; selectedIndex: number; range: CommitRangeSelection; beforeFirstParent: string[]; afterFirstParent: string[] }
  | { kind: 'blocked'; reason: CommitMoveBlockReason; message: string }
  | { kind: 'rebase-active'; message: string };

export type CommitMoveInput = {
  repoPath: string;
  visibleHashes: readonly string[];
  selectedIndex: number;
  range: CommitRangeSelection;
  direction: CommitMoveDirection;
  isLocalCommits: boolean;
  onStart?: () => void;
};

type PreparedMove = {
  branch: string;
  head: string;
  direction: CommitMoveDirection;
  startIndex: number;
  endIndex: number;
  selectedIndex: number;
  selected: CommitSnapshot[];
  destination: CommitSnapshot;
  base?: string;
  useRoot: boolean;
  firstParent: HistoryCommit[];
  expectedFirstParent: HistoryCommit[];
};
type Preflight = PreparedMove | Extract<CommitMoveOutcome, { kind: 'blocked' }>;
type TodoPick = { lineIndex: number; hash: string };

function blocked(reason: CommitMoveBlockReason, message: string): Extract<CommitMoveOutcome, { kind: 'blocked' }> {
  return { kind: 'blocked', reason, message };
}

function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error((stderr || stdout || error.message).trim()) as GitFailure;
        failure.code = (error as GitFailure).code ?? undefined;
        reject(failure);
      } else resolve(String(stdout ?? ''));
    });
  });
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{4,128}$/i.test(value);
}

function compatibleHash(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function moveSelection(input: CommitMoveInput): MoveSelection | Extract<CommitMoveOutcome, { kind: 'blocked' }> {
  if (!input.isLocalCommits) return blocked('branch-view', 'LazyGitVS: Move commit is only available from the attached top-level Local Commits view.');
  if (input.direction !== 'down' && input.direction !== 'up') throw new Error('LazyGitVS: move direction is invalid.');
  if (!Array.isArray(input.visibleHashes) || !Number.isInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex >= input.visibleHashes.length) {
    return blocked('empty-selection', 'LazyGitVS: no visible commit is selected to move.');
  }
  const range = input.range as CommitRangeSelection | undefined;
  let startIndex = input.selectedIndex;
  let endIndex = input.selectedIndex;
  if (!range || (range.mode !== 'none' && range.mode !== 'sticky' && range.mode !== 'nonsticky')) {
    return blocked('invalid-selection', 'LazyGitVS: selected commit range is invalid.');
  }
  if (range.mode !== 'none') {
    if (!Number.isInteger(range.anchor) || range.anchor < 0 || range.anchor >= input.visibleHashes.length) {
      return blocked('invalid-selection', 'LazyGitVS: selected commit range is invalid.');
    }
    startIndex = Math.min(range.anchor, input.selectedIndex);
    endIndex = Math.max(range.anchor, input.selectedIndex);
  }
  const hashes = input.visibleHashes.slice(startIndex, endIndex + 1).map(hash => typeof hash === 'string' ? hash.trim() : '');
  if (!hashes.length) return blocked('empty-selection', 'LazyGitVS: no visible commit is selected to move.');
  if (hashes.some(hash => !validHash(hash)) || new Set(hashes.map(hash => hash.toLowerCase())).size !== hashes.length) {
    return blocked('invalid-selection', 'LazyGitVS: selected commits must be distinct valid hashes.');
  }
  const destinationIndex = input.direction === 'down' ? endIndex + 1 : startIndex - 1;
  if (destinationIndex < 0 || destinationIndex >= input.visibleHashes.length) {
    return blocked('boundary', `LazyGitVS: ${CANNOT_MOVE_ANY_FURTHER}.`);
  }
  const destinationTodoHash = input.visibleHashes[destinationIndex]?.trim();
  if (!validHash(destinationTodoHash) || hashes.some(hash => hash.toLowerCase() === destinationTodoHash.toLowerCase())) {
    return blocked('invalid-selection', 'LazyGitVS: adjacent destination commit is invalid.');
  }
  return { startIndex, endIndex, hashes, destinationTodoHash };
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
    return (await runGit(cwd, ['config', '--bool', '--get', 'commit.gpgSign'])).trim() === 'true';
  } catch (error) {
    if ((error as GitFailure).code === 1) return false;
    throw error;
  }
}

async function isAncestor(cwd: string, hash: string): Promise<boolean> {
  try {
    await runGit(cwd, ['merge-base', '--is-ancestor', hash, 'HEAD']);
    return true;
  } catch (error) {
    if ((error as GitFailure).code === 1) return false;
    throw error;
  }
}

async function resolveCommit(cwd: string, todoHash: string): Promise<string | undefined> {
  try {
    const hash = (await runGit(cwd, ['rev-parse', '--verify', `${todoHash}^{commit}`])).trim();
    return validHash(hash) ? hash : undefined;
  } catch {
    return undefined;
  }
}

async function commitParents(cwd: string, hash: string): Promise<string[]> {
  return (await runGit(cwd, ['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/).filter(Boolean);
}

async function firstParentHistory(cwd: string): Promise<HistoryCommit[]> {
  const output = await runGit(cwd, ['log', '--first-parent', '--format=%x1e%H%x00%T%x00%s%x00%an <%ae> %aI%x00%B', 'HEAD']);
  const records = output.split('\x1e').filter(Boolean);
  return records.map(record => {
    const fields = record.split('\x00');
    if (fields.length !== 5 || !validHash(fields[0]) || !validHash(fields[1])) throw new Error('LazyGitVS: could not read a complete first-parent history.');
    const [hash, tree, subject, author, message] = fields;
    return { hash, tree, subject, author, message };
  });
}

function historyCommit(todoHash: string, hash: string, parents: string[], history: readonly HistoryCommit[]): CommitSnapshot | Extract<CommitMoveOutcome, { kind: 'blocked' }> {
  if (parents[0] !== hash) throw new Error(`LazyGitVS: could not read parents for ${hash}.`);
  if (parents.length > 2) return blocked('merge-commit', 'LazyGitVS: Move commit currently supports ordinary non-merge commits only.');
  const firstParentIndex = history.findIndex(commit => commit.hash === hash);
  if (firstParentIndex < 0) return blocked('unreachable', `LazyGitVS: commit ${todoHash} is no longer reachable in the current first-parent history.`);
  return { ...history[firstParentIndex], todoHash, parent: parents[1], firstParentIndex };
}

function expectedHistory(firstParent: readonly HistoryCommit[], selection: MoveSelection, destination: HistoryCommit, direction: CommitMoveDirection): HistoryCommit[] {
  const result = [...firstParent];
  const selected = result.slice(selection.startIndex, selection.endIndex + 1);
  if (direction === 'down') result.splice(selection.startIndex, selected.length + 1, destination, ...selected);
  else result.splice(selection.startIndex - 1, selected.length + 1, ...selected, destination);
  return result;
}

function sameHistory(left: readonly HistoryCommit[], right: readonly HistoryCommit[]): boolean {
  return left.length === right.length && left.every((commit, index) => {
    const other = right[index];
    return !!other && commit.hash === other.hash && commit.tree === other.tree && commit.subject === other.subject && commit.author === other.author && commit.message === other.message;
  });
}

function sameSnapshot(left: CommitSnapshot, right: CommitSnapshot): boolean {
  return left.todoHash === right.todoHash && left.parent === right.parent && left.firstParentIndex === right.firstParentIndex
    && left.hash === right.hash && left.tree === right.tree && left.subject === right.subject && left.author === right.author && left.message === right.message;
}

function samePreparedMove(left: PreparedMove, right: PreparedMove): boolean {
  return left.branch === right.branch && left.head === right.head && left.direction === right.direction
    && left.startIndex === right.startIndex && left.endIndex === right.endIndex && left.selectedIndex === right.selectedIndex
    && left.base === right.base && left.useRoot === right.useRoot && sameSnapshot(left.destination, right.destination)
    && left.selected.length === right.selected.length && left.selected.every((commit, index) => sameSnapshot(commit, right.selected[index]))
    && sameHistory(left.firstParent, right.firstParent) && sameHistory(left.expectedFirstParent, right.expectedFirstParent);
}

function topologyMatches(prepared: PreparedMove, after: readonly HistoryCommit[]): boolean {
  if (prepared.expectedFirstParent.length !== after.length) return false;
  const moved = new Set([...prepared.selected.map(commit => commit.hash), prepared.destination.hash]);
  return prepared.expectedFirstParent.every((expected, index) => {
    const actual = after[index];
    if (!actual || expected.subject !== actual.subject || expected.author !== actual.author || expected.message !== actual.message) return false;
    return moved.has(expected.hash) || expected.tree === actual.tree;
  });
}

function shiftedRange(range: CommitRangeSelection, delta: 1 | -1): CommitRangeSelection {
  return range.mode === 'none' ? { mode: 'none' } : { mode: range.mode, anchor: range.anchor + delta };
}

async function preflight(input: CommitMoveInput): Promise<Preflight> {
  const selection = moveSelection(input);
  if ('kind' in selection) return selection;
  const operation = detectGitOperationState(input.repoPath);
  if (operation) return blocked('active-operation', `LazyGitVS: cannot move commits while ${operation.label}. Resolve it from Status first.`);
  const status = await runGit(input.repoPath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim()) return blocked('dirty-worktree', 'LazyGitVS: Move commit requires a clean working tree including staged, unstaged, and untracked changes; dirty-tree auto-stash is not supported.');
  if (await gpgSigningEnabled(input.repoPath)) return blocked('gpg-signing', 'LazyGitVS: Move commit is disabled while commit.gpgSign is true.');
  const branch = await currentBranch(input.repoPath);
  if (!branch) return blocked('detached-head', 'LazyGitVS: Move commit requires an attached HEAD on the current local branch.');
  const head = (await runGit(input.repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const resolvedSelected: Array<{ todoHash: string; hash: string; parents: string[] }> = [];
  for (const todoHash of selection.hashes) {
    const hash = await resolveCommit(input.repoPath, todoHash);
    if (!hash || !await isAncestor(input.repoPath, hash)) return blocked('unreachable', `LazyGitVS: selected commit ${todoHash} no longer resolves to a reachable commit.`);
    resolvedSelected.push({ todoHash, hash, parents: await commitParents(input.repoPath, hash) });
  }
  if (new Set(resolvedSelected.map(commit => commit.hash)).size !== resolvedSelected.length) {
    return blocked('invalid-selection', 'LazyGitVS: selected commits resolve to duplicate history entries.');
  }
  const destinationHash = await resolveCommit(input.repoPath, selection.destinationTodoHash);
  if (!destinationHash || !await isAncestor(input.repoPath, destinationHash)) {
    return blocked('unreachable', `LazyGitVS: adjacent destination commit ${selection.destinationTodoHash} no longer resolves to a reachable commit.`);
  }
  if (resolvedSelected.some(commit => commit.hash === destinationHash)) return blocked('invalid-selection', 'LazyGitVS: adjacent destination commit duplicates the selected range.');
  const destinationParents = await commitParents(input.repoPath, destinationHash);
  const firstParent = await firstParentHistory(input.repoPath);
  if (!firstParent.length || firstParent[0].hash !== head) throw new Error('LazyGitVS: current HEAD changed while reading first-parent history.');
  const visiblePrefix = input.visibleHashes.map(hash => typeof hash === 'string' ? hash.trim() : '');
  if (visiblePrefix.length > firstParent.length || visiblePrefix.some((hash, index) => !validHash(hash) || !compatibleHash(firstParent[index].hash, hash))) {
    return blocked('unsupported-history', 'LazyGitVS: Move commit currently requires an unfiltered linear first-parent visible history.');
  }
  const selected: CommitSnapshot[] = [];
  for (const item of resolvedSelected) {
    const snapshot = historyCommit(item.todoHash, item.hash, item.parents, firstParent);
    if ('kind' in snapshot) return snapshot;
    selected.push(snapshot);
  }
  const destination = historyCommit(selection.destinationTodoHash, destinationHash, destinationParents, firstParent);
  if ('kind' in destination) return destination;
  if (selected.some((commit, index) => commit.firstParentIndex !== selection.startIndex + index)) {
    return blocked('unsupported-history', 'LazyGitVS: selected commits must match one contiguous visible first-parent history range.');
  }
  if (destination.firstParentIndex !== (input.direction === 'down' ? selection.endIndex + 1 : selection.startIndex - 1)) {
    return blocked('unsupported-history', 'LazyGitVS: adjacent destination must match the unfiltered first-parent history.');
  }
  if (selected.some((commit, index) => index + 1 < selected.length && commit.parent !== selected[index + 1].hash)) {
    return blocked('invalid-selection', 'LazyGitVS: selected commits must form one contiguous ordinary history range.');
  }
  const contiguous = input.direction === 'down'
    ? selected[selected.length - 1].parent === destination.hash
    : destination.parent === selected[0].hash;
  if (!contiguous) return blocked('invalid-selection', 'LazyGitVS: selected range and adjacent destination must be contiguous ordinary commits.');
  const base = input.direction === 'down' ? destination.parent : selected[selected.length - 1].parent;
  const expectedBase = firstParent[input.direction === 'down' ? selection.endIndex + 2 : selection.endIndex + 1]?.hash;
  if (base !== expectedBase) return blocked('unsupported-history', 'LazyGitVS: move base does not match the exact first-parent history.');
  return {
    branch,
    head,
    direction: input.direction,
    startIndex: selection.startIndex,
    endIndex: selection.endIndex,
    selectedIndex: input.selectedIndex,
    selected,
    destination,
    base,
    useRoot: !base,
    firstParent,
    expectedFirstParent: expectedHistory(firstParent, selection, destination, input.direction),
  };
}

function todoPicks(lines: readonly string[]): TodoPick[] {
  const picks: TodoPick[] = [];
  lines.forEach((line, lineIndex) => {
    const match = line.match(/^pick (\S+)(?=\s|$)/);
    if (match) picks.push({ lineIndex, hash: match[1] });
  });
  return picks;
}

function exactlyOnePick(picks: readonly TodoPick[], hash: string, role: string): TodoPick {
  const matches = picks.filter(pick => compatibleHash(hash, pick.hash));
  if (matches.length !== 1) throw new Error(`LazyGitVS: expected exactly one ${role} pick ${hash}, found ${matches.length}.`);
  return matches[0];
}

export function rewriteMoveTodo(todo: string, selectedHashes: readonly string[], destinationHash: string, direction: CommitMoveDirection): string {
  if (direction !== 'down' && direction !== 'up') throw new Error('LazyGitVS: rebase todo move direction is invalid.');
  if (!selectedHashes.length || selectedHashes.some(hash => !validHash(hash)) || !validHash(destinationHash)) {
    throw new Error('LazyGitVS: rebase todo move requires valid selected and destination hashes.');
  }
  if (new Set(selectedHashes.map(hash => hash.toLowerCase())).size !== selectedHashes.length) {
    throw new Error('LazyGitVS: rebase todo move received duplicate selected hashes.');
  }
  if (selectedHashes.some(hash => compatibleHash(hash, destinationHash))) {
    throw new Error('LazyGitVS: rebase todo move destination duplicates a selected hash.');
  }
  const lines = todo.match(/[^\n]*\n|[^\n]+/g) ?? [];
  const picks = todoPicks(lines);
  const selectedPicks = selectedHashes.map(hash => exactlyOnePick(picks, hash, 'selected'));
  if (new Set(selectedPicks.map(pick => pick.lineIndex)).size !== selectedPicks.length) {
    throw new Error('LazyGitVS: rebase todo move selected hashes map to duplicate picks.');
  }
  const destination = exactlyOnePick(picks, destinationHash, 'destination');
  if (selectedPicks.some(pick => pick.lineIndex === destination.lineIndex)) {
    throw new Error('LazyGitVS: rebase todo move destination duplicates a selected pick.');
  }
  const positions = selectedPicks.map(pick => picks.findIndex(candidate => candidate.lineIndex === pick.lineIndex)).sort((a, b) => a - b);
  if (positions.some((position, index) => index > 0 && position !== positions[index - 1] + 1)) {
    throw new Error('LazyGitVS: selected picks are not one contiguous rendered todo block.');
  }
  const destinationPosition = picks.findIndex(pick => pick.lineIndex === destination.lineIndex);
  if ((direction === 'down' && destinationPosition !== positions[0] - 1) || (direction === 'up' && destinationPosition !== positions[positions.length - 1] + 1)) {
    throw new Error('LazyGitVS: destination is not the one adjacent ordinary pick in the requested direction.');
  }
  const selectedLines = positions.map(position => lines[picks[position].lineIndex]);
  const rotatingPositions = direction === 'down' ? [destinationPosition, ...positions] : [...positions, destinationPosition];
  const rotatingLines = direction === 'down' ? [...selectedLines, lines[destination.lineIndex]] : [lines[destination.lineIndex], ...selectedLines];
  rotatingPositions.forEach((position, index) => { lines[picks[position].lineIndex] = rotatingLines[index]; });
  return lines.join('');
}

const sequenceEditorSource = [
  '#!/usr/bin/env node',
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "function fail(message) { process.stderr.write('LazyGitVS move sequence editor: ' + message + '\\n'); process.exit(2); }",
  "function validHash(value) { return typeof value === 'string' && /^[0-9a-f]{4,128}$/i.test(value); }",
  "function compatibleHash(left, right) { const a = left.toLowerCase(); const b = right.toLowerCase(); return a === b || a.startsWith(b) || b.startsWith(a); }",
  "function todoPicks(lines) { const picks = []; lines.forEach((line, lineIndex) => { const match = line.match(/^pick (\\S+)(?=\\s|$)/); if (match) picks.push({ lineIndex, hash: match[1] }); }); return picks; }",
  "function exactlyOnePick(picks, hash, role) { const matches = picks.filter(pick => compatibleHash(hash, pick.hash)); if (matches.length !== 1) fail('expected exactly one ' + role + ' pick ' + hash + ', found ' + matches.length); return matches[0]; }",
  "function rewrite(todo, selectedHashes, destinationHash, direction) { if ((direction !== 'down' && direction !== 'up') || !Array.isArray(selectedHashes) || !selectedHashes.length || selectedHashes.some(hash => !validHash(hash)) || !validHash(destinationHash)) fail('invalid move todo data'); if (new Set(selectedHashes.map(hash => hash.toLowerCase())).size !== selectedHashes.length) fail('duplicate selected hashes'); if (selectedHashes.some(hash => compatibleHash(hash, destinationHash))) fail('destination duplicates a selected hash'); const lines = todo.match(/[^\\n]*\\n|[^\\n]+/g) || []; const picks = todoPicks(lines); const selectedPicks = selectedHashes.map(hash => exactlyOnePick(picks, hash, 'selected')); if (new Set(selectedPicks.map(pick => pick.lineIndex)).size !== selectedPicks.length) fail('selected hashes map to duplicate picks'); const destination = exactlyOnePick(picks, destinationHash, 'destination'); if (selectedPicks.some(pick => pick.lineIndex === destination.lineIndex)) fail('destination duplicates a selected pick'); const positions = selectedPicks.map(pick => picks.findIndex(candidate => candidate.lineIndex === pick.lineIndex)).sort((a, b) => a - b); if (positions.some((position, index) => index > 0 && position !== positions[index - 1] + 1)) fail('selected picks are not one contiguous rendered todo block'); const destinationPosition = picks.findIndex(pick => pick.lineIndex === destination.lineIndex); if ((direction === 'down' && destinationPosition !== positions[0] - 1) || (direction === 'up' && destinationPosition !== positions[positions.length - 1] + 1)) fail('destination is not the one adjacent ordinary pick in the requested direction'); const selectedLines = positions.map(position => lines[picks[position].lineIndex]); const rotatingPositions = direction === 'down' ? [destinationPosition, ...positions] : [...positions, destinationPosition]; const rotatingLines = direction === 'down' ? [...selectedLines, lines[destination.lineIndex]] : [lines[destination.lineIndex], ...selectedLines]; rotatingPositions.forEach((position, index) => { lines[picks[position].lineIndex] = rotatingLines[index]; }); return lines.join(''); }",
  "const todoPath = process.argv[2];",
  "if (process.argv.length !== 3 || typeof todoPath !== 'string') fail('expected exactly one generated rebase todo path');",
  "const resolvedTodo = path.resolve(todoPath);",
  "if (path.basename(resolvedTodo) !== 'git-rebase-todo') fail('refusing to edit a file other than git-rebase-todo');",
  "const rebaseDirectory = path.basename(path.dirname(resolvedTodo));",
  "if (rebaseDirectory !== 'rebase-merge' && rebaseDirectory !== 'rebase-apply') fail('refusing to edit a non-rebase todo');",
  "const direction = process.env.LGVS_MOVE_TODO_DIRECTION;",
  "let selectedHashes; try { selectedHashes = JSON.parse(process.env.LGVS_MOVE_TODO_SELECTED || ''); } catch (_) { fail('invalid selected-hash environment data'); }",
  "const destinationHash = process.env.LGVS_MOVE_TODO_DESTINATION || '';",
  "const source = fs.readFileSync(resolvedTodo, 'utf8');",
  "const rewritten = rewrite(source, selectedHashes, destinationHash, direction);",
  "fs.writeFileSync(resolvedTodo, rewritten, 'utf8');",
].join('\n');

function createSequenceEditor(selectedHashes: readonly string[], destinationHash: string, direction: CommitMoveDirection): SequenceEditor {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lazygitvs-move-'));
  try {
    fs.chmodSync(directory, 0o700);
    const command = path.join(directory, 'sequence-editor');
    fs.writeFileSync(command, sequenceEditorSource, { encoding: 'utf8', mode: 0o700 });
    fs.chmodSync(command, 0o700);
    return { directory, command };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function runMoveRebase(input: { repoPath: string; prepared: PreparedMove }): Promise<void> {
  const editor = createSequenceEditor(input.prepared.selected.map(commit => commit.hash), input.prepared.destination.hash, input.prepared.direction);
  try {
    await runGit(input.repoPath, [...MOVE_REBASE_ARGS, ...(input.prepared.useRoot ? ['--root'] : [input.prepared.base!])], {
      ...process.env,
      GIT_SEQUENCE_EDITOR: editor.command,
      GIT_EDITOR: 'true',
      LGVS_MOVE_TODO_DIRECTION: input.prepared.direction,
      LGVS_MOVE_TODO_SELECTED: JSON.stringify(input.prepared.selected.map(commit => commit.hash)),
      LGVS_MOVE_TODO_DESTINATION: input.prepared.destination.hash,
      LANG: 'C',
      LC_ALL: 'C',
      LC_MESSAGES: 'C',
    });
  } finally {
    fs.rmSync(editor.directory, { recursive: true, force: true });
  }
}

export async function moveSelectedCommits(input: CommitMoveInput): Promise<CommitMoveOutcome> {
  const initial = await preflight(input);
  if ('kind' in initial) return initial;
  const final = await preflight(input);
  if ('kind' in final || !samePreparedMove(initial, final)) {
    return blocked('drift', 'LazyGitVS: repository changed before Move commit could start; no rebase was started.');
  }
  const delta: 1 | -1 = initial.direction === 'down' ? 1 : -1;
  input.onStart?.();
  try {
    await runMoveRebase({ repoPath: input.repoPath, prepared: initial });
    const after = await firstParentHistory(input.repoPath);
    if (!topologyMatches(initial, after)) throw new Error('LazyGitVS: Move commit completed without the expected first-parent topology.');
    return {
      kind: 'success',
      delta,
      selectedIndex: initial.selectedIndex + delta,
      range: shiftedRange(input.range, delta),
      beforeFirstParent: initial.firstParent.map(commit => commit.hash),
      afterFirstParent: after.map(commit => commit.hash),
    };
  } catch (error) {
    const operation = detectGitOperationState(input.repoPath);
    if (operation) return { kind: 'rebase-active', message: `LazyGitVS: Move commit left ${operation.label} active. Resolve, continue, skip, or abort it from Status.` };
    throw error;
  }
}

type CommitMoveMenuInput = Omit<CommitMoveInput, 'onStart'> & {
  key: string;
  onStatus: (status: string) => void;
  onMessage?: (message: string) => void;
  onSuccess?: (outcome: Extract<CommitMoveOutcome, { kind: 'success' }>) => void | Promise<void>;
};

export function commitMoveMenuItem(input: CommitMoveMenuInput): GitMenuItem {
  const { key, onStatus, onMessage, onSuccess, ...moveInput } = input;
  const down = moveInput.direction === 'down';
  return {
    key,
    label: down ? MOVE_COMMIT_DOWN_LABEL : MOVE_COMMIT_UP_LABEL,
    description: down ? 'move selected commit/range one position down' : 'move selected commit/range one position up',
    run: async () => {
      let transientStatus = false;
      try {
        const outcome = await moveSelectedCommits({
          ...moveInput,
          onStart: () => {
            transientStatus = true;
            onStatus(MOVING_STATUS);
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
