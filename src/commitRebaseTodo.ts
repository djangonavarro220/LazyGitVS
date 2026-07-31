import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type RebaseTodoAction = 'drop' | 'squash' | 'fixup' | 'edit';
export type RebaseTodoActionFlag = '' | '-C';

export const INTERACTIVE_REBASE_ARGS = ['rebase', '--interactive', '--autostash', '--keep-empty', '--no-autosquash', '--rebase-merges'];

type SequenceEditor = { directory: string; command: string; hashes: string[] };

const sequenceEditorSource = [
  '#!/usr/bin/env node',
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "function fail(message) { process.stderr.write('LazyGitVS rebase sequence editor: ' + message + '\\n'); process.exit(2); }",
  "const todoPath = process.argv[2];",
  "if (process.argv.length !== 3 || typeof todoPath !== 'string') fail('expected exactly one generated rebase todo path');",
  "const resolvedTodo = path.resolve(todoPath);",
  "if (path.basename(resolvedTodo) !== 'git-rebase-todo') fail('refusing to edit a file other than git-rebase-todo');",
  "const rebaseDirectory = path.basename(path.dirname(resolvedTodo));",
  "if (rebaseDirectory !== 'rebase-merge' && rebaseDirectory !== 'rebase-apply') fail('refusing to edit a non-rebase todo');",
  "const action = process.env.LGVS_REBASE_TODO_ACTION;",
  "if (action !== 'drop' && action !== 'squash' && action !== 'fixup' && action !== 'edit') fail('invalid rebase todo action');",
  "const actionFlag = process.env.LGVS_REBASE_TODO_FLAG || '';",
  "if (actionFlag !== '' && actionFlag !== '-C') fail('invalid rebase todo action flag');",
  "if (actionFlag && action !== 'fixup') fail('rebase todo action flag is only valid for fixup');",
  "let hashes; try { hashes = JSON.parse(process.env.LGVS_REBASE_TODO_HASHES || ''); } catch (_) { fail('invalid selected-hash environment data'); }",
  "if (!Array.isArray(hashes) || !hashes.length || hashes.some(hash => typeof hash !== 'string' || !hash)) fail('missing selected hashes');",
  "if (new Set(hashes).size !== hashes.length) fail('duplicate selected hashes');",
  "const selected = new Set(hashes);",
  "const counts = new Map(hashes.map(hash => [hash, 0]));",
  "const source = fs.readFileSync(resolvedTodo, 'utf8');",
  "const lines = source.match(/[^\\n]*\\n|[^\\n]+/g) || [];",
  "const directive = action + (actionFlag ? ' ' + actionFlag : '');",
  "const rewritten = lines.map(line => { const match = line.match(/^pick ([^\\s]+)(?=\\s|$)/); if (!match || !selected.has(match[1])) return line; counts.set(match[1], counts.get(match[1]) + 1); return directive + ' ' + line.slice(5); });",
  "for (const hash of hashes) if (counts.get(hash) !== 1) fail('expected exactly one pick ' + hash + ', found ' + counts.get(hash));",
  "fs.writeFileSync(resolvedTodo, rewritten.join(''), 'utf8');",
].join('\n');

function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim())); else resolve(String(stdout ?? ''));
    });
  });
}

function createSequenceEditor(prefix: string, hashes: readonly string[]): SequenceEditor {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    fs.chmodSync(directory, 0o700);
    const command = path.join(directory, 'sequence-editor');
    fs.writeFileSync(command, sequenceEditorSource, { encoding: 'utf8', mode: 0o700 });
    fs.chmodSync(command, 0o700);
    return { directory, command, hashes: [...hashes] };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function validateActionFlag(action: RebaseTodoAction, actionFlag: RebaseTodoActionFlag = ''): RebaseTodoActionFlag {
  if (actionFlag !== '' && actionFlag !== '-C') throw new Error('Rebase todo action flag is invalid.');
  if (actionFlag && action !== 'fixup') throw new Error('Rebase todo action flag is only valid for fixup.');
  return actionFlag;
}

export function rewriteSelectedPickTodo(todo: string, hashes: readonly string[], action: RebaseTodoAction, actionFlag: RebaseTodoActionFlag = ''): string {
  const validatedActionFlag = validateActionFlag(action, actionFlag);
  if (!hashes.length || hashes.some(hash => !hash)) throw new Error('Rebase todo rewrite requires selected hashes.');
  if (new Set(hashes).size !== hashes.length) throw new Error('Rebase todo rewrite received duplicate selected hashes.');
  const selected = new Set(hashes);
  const counts = new Map(hashes.map(hash => [hash, 0]));
  const lines = todo.match(/[^\n]*\n|[^\n]+/g) ?? [];
  const rewritten = lines.map(line => {
    const match = line.match(/^pick (\S+)(?=\s|$)/);
    if (!match || !selected.has(match[1])) return line;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    return `${action}${validatedActionFlag ? ` ${validatedActionFlag}` : ''} ${line.slice(5)}`;
  });
  for (const hash of hashes) if (counts.get(hash) !== 1) throw new Error(`Rebase todo rewrite expected exactly one pick ${hash}, found ${counts.get(hash) ?? 0}.`);
  return rewritten.join('');
}

export async function runSelectedCommitRebase(input: {
  repoPath: string;
  hashes: readonly string[];
  action: RebaseTodoAction;
  actionFlag?: RebaseTodoActionFlag;
  base?: string;
  useRoot: boolean;
  keepEmpty?: boolean;
  temporaryDirectoryPrefix: string;
}): Promise<void> {
  if (!input.useRoot && !input.base) throw new Error('Interactive rebase requires a base commit or --root.');
  const actionFlag = validateActionFlag(input.action, input.actionFlag);
  const editor = createSequenceEditor(input.temporaryDirectoryPrefix, input.hashes);
  try {
    const rebaseArgs = input.keepEmpty === false ? INTERACTIVE_REBASE_ARGS.filter(arg => arg !== '--keep-empty') : INTERACTIVE_REBASE_ARGS;
    await runGit(input.repoPath, [...rebaseArgs, ...(input.useRoot ? ['--root'] : [input.base!])], {
      ...process.env,
      GIT_SEQUENCE_EDITOR: editor.command,
      GIT_EDITOR: 'true',
      LGVS_REBASE_TODO_ACTION: input.action,
      LGVS_REBASE_TODO_FLAG: actionFlag,
      LGVS_REBASE_TODO_HASHES: JSON.stringify(editor.hashes),
      LANG: 'C',
      LC_ALL: 'C',
      LC_MESSAGES: 'C',
    });
  } finally {
    fs.rmSync(editor.directory, { recursive: true, force: true });
  }
}
