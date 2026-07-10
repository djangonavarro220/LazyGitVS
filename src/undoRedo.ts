import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type ReflogDirection = 'undo' | 'redo';
export type ReflogAction = {
  kind: 'checkout' | 'commit' | 'rebase' | 'current-rebase';
  from: string;
  to: string;
};
export type ReflogEntry = { hash: string; name: string };
export type ReflogConfirm = (prompt: string, title: 'Undo' | 'Redo' | 'Autostash?') => Promise<boolean>;

type GitOptions = { env?: NodeJS.ProcessEnv; allowFailure?: boolean };

function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: options.env ?? process.env,
    }, (error, stdout, stderr) => {
      if (error && !options.allowFailure) {
        const gitError = new Error((stderr || stdout || error.message).trim()) as Error & { code?: number | string };
        gitError.code = error.code ?? undefined;
        reject(gitError);
        return;
      }
      resolve(String(stdout ?? ''));
    });
  });
}

export async function readReflog(cwd: string): Promise<ReflogEntry[]> {
  const output = await runGit(cwd, ['-c', 'log.showSignature=false', 'log', '-g', '--format=%H%x00%gs%x00']);
  const fields = output.split('\0');
  const entries: ReflogEntry[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const hash = fields[i].replace(/^\n+/, '').trim();
    const name = fields[i + 1].replace(/^\n+/, '').trim();
    if (hash && name) entries.push({ hash, name });
  }
  return entries;
}

export function findReflogAction(entries: ReflogEntry[], direction: ReflogDirection): ReflogAction | undefined {
  let counter = 0;
  let rebaseFinishCommitHash = '';

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const previousHash = entries[index + 1]?.hash ?? '';
    let action: ReflogAction | undefined;

    if (!rebaseFinishCommitHash) {
      if (/^\[lazygit undo\]/.test(entry.name)) counter++;
      else if (/^\[lazygit redo\]/.test(entry.name)) counter--;
      else if (/^rebase (-i )?\((abort|finish)\)/.test(entry.name)) rebaseFinishCommitHash = entry.hash;
      else {
        const checkout = entry.name.match(/^checkout: moving from (\S+) to (\S+)/);
        if (checkout) action = { kind: 'checkout', from: checkout[1], to: checkout[2] };
        else if (/^(commit|reset: moving to|pull)/.test(entry.name)) action = { kind: 'commit', from: previousHash, to: entry.hash };
        else if (/^rebase (-i )?\(start\)/.test(entry.name)) action = { kind: 'current-rebase', from: previousHash, to: '' };
      }
    } else if (/^rebase (-i )?\(start\)/.test(entry.name)) {
      action = { kind: 'rebase', from: previousHash, to: rebaseFinishCommitHash };
      rebaseFinishCommitHash = '';
    }

    if (!action) continue;
    if (action.kind !== 'current-rebase' && (!action.from || !action.to || action.from === action.to)) continue;

    if (direction === 'undo') {
      if (counter === 0) return action.kind === 'current-rebase' ? undefined : action;
    } else {
      if (counter === 0) return undefined;
      if (counter === 1) return action.kind === 'current-rebase' ? undefined : action;
    }
    counter--;
  }
  return undefined;
}

function shortHash(hash: string): string { return hash.slice(0, 8); }

export function reflogActionPrompt(action: ReflogAction, direction: ReflogDirection): string {
  const target = direction === 'undo' ? action.from : action.to;
  if (action.kind === 'checkout') return `Are you sure you want to checkout '${target}'? An auto-stash will be performed if necessary.`;
  if (direction === 'undo' && action.kind === 'commit') return `Are you sure you want to soft reset to '${shortHash(target)}'?`;
  return `Are you sure you want to hard reset to '${shortHash(target)}'? An auto-stash will be performed if necessary.`;
}

async function gitPathExists(cwd: string, marker: string): Promise<boolean> {
  const gitPath = (await runGit(cwd, ['rev-parse', '--git-path', marker])).trim();
  return fs.existsSync(path.isAbsolute(gitPath) ? gitPath : path.join(cwd, gitPath));
}

async function operationInProgress(cwd: string): Promise<boolean> {
  const markers = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
  const states = await Promise.all(markers.map(marker => gitPathExists(cwd, marker)));
  return states.some(Boolean);
}

async function trackedWorkingTreeDirty(cwd: string): Promise<boolean> {
  const status = await runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=no']);
  return status.trim().length > 0;
}

async function hardResetWithAutoStash(cwd: string, target: string, env: NodeJS.ProcessEnv): Promise<void> {
  const dirty = await trackedWorkingTreeDirty(cwd);
  if (!dirty) {
    await runGit(cwd, ['reset', '--hard', target], { env });
    return;
  }

  await runGit(cwd, ['stash', 'push', '-m', `Auto-stashing changes for undoing to ${shortHash(target)}`]);
  await runGit(cwd, ['reset', '--hard', target], { env });
  await runGit(cwd, ['stash', 'pop', '0']);
}

async function checkoutWithAutoStash(cwd: string, target: string, env: NodeJS.ProcessEnv, confirm: ReflogConfirm): Promise<boolean> {
  try {
    await runGit(cwd, ['checkout', target], { env });
    return true;
  } catch (error) {
    if (!await trackedWorkingTreeDirty(cwd)) throw error;
    const accepted = await confirm('You must stash and pop your changes to bring them across. Do this automatically? (enter/esc)', 'Autostash?');
    if (!accepted) return false;
    await runGit(cwd, ['stash', 'push', '-m', `Auto-stashing changes for checking out ${target}`]);
    try {
      await runGit(cwd, ['checkout', target], { env });
    } catch (checkoutError) {
      await runGit(cwd, ['stash', 'pop', '0']).catch(() => undefined);
      throw checkoutError;
    }
    await runGit(cwd, ['stash', 'pop', '0']);
    return true;
  }
}

export async function performReflogAction(
  cwd: string,
  action: ReflogAction | undefined,
  direction: ReflogDirection,
  confirm: ReflogConfirm,
): Promise<boolean> {
  if (await operationInProgress(cwd)) throw new Error(`Can't ${direction} while rebasing`);
  if (!action) return false;
  const confirmed = await confirm(reflogActionPrompt(action, direction), direction === 'undo' ? 'Undo' : 'Redo');
  if (!confirmed) return false;

  const env = { ...process.env, GIT_REFLOG_ACTION: `[lazygit ${direction}]` };
  const target = direction === 'undo' ? action.from : action.to;
  if (action.kind === 'checkout') return checkoutWithAutoStash(cwd, target, env, confirm);
  else if (direction === 'undo' && action.kind === 'commit') await runGit(cwd, ['reset', '--soft', target], { env });
  else await hardResetWithAutoStash(cwd, target, env);
  return true;
}

export async function planAndPerformReflogAction(cwd: string, direction: ReflogDirection, confirm: ReflogConfirm): Promise<boolean> {
  const entries = await readReflog(cwd);
  return performReflogAction(cwd, findReflogAction(entries, direction), direction, confirm);
}
