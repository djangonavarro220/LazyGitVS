import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { commitRangeBounds, type CommitRangeSelection } from './commitCherryPick';
import { detectGitOperationState } from './gitOperationState';

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
type SequenceEditor = { directory: string; command: string; hashes: string[] };

const rebaseArgs = ['rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges'];
const sequenceEditorSource = [
  '#!/usr/bin/env node',
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "function fail(message) { process.stderr.write('LazyGitVS Drop sequence editor: ' + message + '\\n'); process.exit(2); }",
  "const todoPath = process.argv[2];",
  "if (process.argv.length !== 3 || typeof todoPath !== 'string') fail('expected exactly one generated rebase todo path');",
  "const resolvedTodo = path.resolve(todoPath);",
  "if (path.basename(resolvedTodo) !== 'git-rebase-todo') fail('refusing to edit a file other than git-rebase-todo');",
  "const rebaseDirectory = path.basename(path.dirname(resolvedTodo));",
  "if (rebaseDirectory !== 'rebase-merge' && rebaseDirectory !== 'rebase-apply') fail('refusing to edit a non-rebase todo');",
  "let hashes; try { hashes = JSON.parse(process.env.LGVS_DROP_HASHES || ''); } catch (_) { fail('invalid selected-hash environment data'); }",
  "if (!Array.isArray(hashes) || !hashes.length || hashes.some(hash => typeof hash !== 'string' || !hash)) fail('missing selected hashes');",
  "if (new Set(hashes).size !== hashes.length) fail('duplicate selected hashes');",
  "const selected = new Set(hashes);",
  "const counts = new Map(hashes.map(hash => [hash, 0]));",
  "const source = fs.readFileSync(resolvedTodo, 'utf8');",
  "const lines = source.match(/[^\\n]*\\n|[^\\n]+/g) || [];",
  "const rewritten = lines.map(line => { const match = line.match(/^pick ([^\\s]+)(?=\\s|$)/); if (!match || !selected.has(match[1])) return line; counts.set(match[1], counts.get(match[1]) + 1); return 'drop ' + line.slice(5); });",
  "for (const hash of hashes) if (counts.get(hash) !== 1) fail('expected exactly one pick ' + hash + ', found ' + counts.get(hash));",
  "fs.writeFileSync(resolvedTodo, rewritten.join(''), 'utf8');",
].join('\n');

function blocked(reason: CommitDropBlockReason, message: string): Extract<CommitDropOutcome, { kind: 'blocked' }> {
  return { kind: 'blocked', reason, message };
}

function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: env ?? process.env }, (error, stdout, stderr) => {
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

function createSequenceEditor(hashes: string[]): SequenceEditor {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lazygitvs-drop-'));
  try {
    fs.chmodSync(directory, 0o700);
    const command = path.join(directory, 'sequence-editor');
    fs.writeFileSync(command, sequenceEditorSource, { encoding: 'utf8', mode: 0o700 });
    fs.chmodSync(command, 0o700);
    return { directory, command, hashes };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function rewriteDropTodo(todo: string, hashes: readonly string[]): string {
  if (!hashes.length || hashes.some(hash => !hash)) throw new Error('Drop todo rewrite requires selected hashes.');
  if (new Set(hashes).size !== hashes.length) throw new Error('Drop todo rewrite received duplicate selected hashes.');
  const selected = new Set(hashes);
  const counts = new Map(hashes.map(hash => [hash, 0]));
  const lines = todo.match(/[^\n]*\n|[^\n]+/g) ?? [];
  const rewritten = lines.map(line => {
    const match = line.match(/^pick (\S+)(?=\s|$)/);
    if (!match || !selected.has(match[1])) return line;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    return `drop ${line.slice(5)}`;
  });
  for (const hash of hashes) if (counts.get(hash) !== 1) throw new Error(`Drop todo rewrite expected exactly one pick ${hash}, found ${counts.get(hash) ?? 0}.`);
  return rewritten.join('');
}

export async function dropSelectedCommits(input: CommitDropInput): Promise<CommitDropOutcome> {
  const initial = await preflight(input);
  if ('kind' in initial) return initial;
  if (!await input.confirm(DROP_COMMIT_TITLE, DROP_COMMIT_PROMPT)) return { kind: 'cancelled' };
  const final = await preflight(input);
  if ('kind' in final) return final;
  if (!samePreparedDrop(initial, final)) return blocked('drift', 'LazyGitVS: repository changed while confirmation was open; Drop was not started.');
  const editor = createSequenceEditor(initial.commits.map(commit => commit.todoHash));
  try {
    await runGit(input.repoPath, [...rebaseArgs, ...(initial.useRoot ? ['--root'] : [initial.upstream!])], {
      ...process.env,
      GIT_SEQUENCE_EDITOR: editor.command,
      GIT_EDITOR: 'true',
      LGVS_DROP_HASHES: JSON.stringify(editor.hashes),
      LANG: 'C',
      LC_ALL: 'C',
      LC_MESSAGES: 'C',
    });
    return { kind: 'success', startIndex: initial.startIndex, hashes: editor.hashes };
  } catch (error) {
    if (detectGitOperationState(input.repoPath)?.kind === 'rebase') return { kind: 'rebase-active', message: 'LazyGitVS: Drop stopped during rebase. Resolve, continue, skip, or abort it from Status.' };
    throw error;
  } finally {
    fs.rmSync(editor.directory, { recursive: true, force: true });
  }
}
