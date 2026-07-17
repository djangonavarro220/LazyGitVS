import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// This deliberately mirrors lazygit's Status.WorkingTreeState. Bisect belongs
// to the commits/bisect controller, not Status.
export type GitOperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert';
export type GitOperationActionCommand = 'continue' | 'abort' | 'skip';

export type GitOperationAction = {
  command: GitOperationActionCommand;
  key: 'c' | 'a' | 's';
  label: 'continue' | 'abort' | 'skip';
  args: string[];
  requiresConfirmation?: boolean;
};

export type GitOperationState = {
  kind: GitOperationKind;
  // lazygit's LowerCaseTitle: this is the Status text inside parentheses.
  label: 'merging' | 'rebasing' | 'cherry-picking' | 'reverting';
  menuTitle: 'Merge options' | 'Rebase options' | 'Cherry-pick options' | 'Revert options';
  identity: string;
  actions: GitOperationAction[];
};

function gitPath(cwd: string, name: string): string | undefined {
  try {
    const out = cp.execFileSync('git', ['rev-parse', '--git-path', name], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const raw = out.trim();
    return raw ? (path.isAbsolute(raw) ? raw : path.resolve(cwd, raw)) : undefined;
  } catch { return undefined; }
}

function existsGitPath(cwd: string, name: string): boolean {
  const file = gitPath(cwd, name);
  return !!file && fs.existsSync(file);
}

function readGitPath(cwd: string, name: string): string | undefined {
  const file = gitPath(cwd, name);
  try { return file ? fs.readFileSync(file, 'utf8').trim() : undefined; } catch { return undefined; }
}

function operationIdentity(cwd: string, names: string[]): string {
  return names.map(name => {
    const file = gitPath(cwd, name);
    if (!file) return `${name}:missing`;
    try {
      const stat = fs.statSync(file, { bigint: true });
      const value = stat.isFile() ? fs.readFileSync(file, 'utf8').trim() : '';
      return `${name}:${stat.dev}:${stat.ino}:${stat.ctimeNs}:${value}`;
    } catch { return `${name}:missing`; }
  }).join('|');
}

// Git can leave CHERRY_PICK_HEAD while a rebase is stopped. Lazygit compares
// it with rebase-merge/stopped-sha so that this internal detail is still shown
// and controlled as a rebase, not as a separate user cherry-pick.
function cherryPickIsPartOfRebase(cwd: string): boolean {
  const cherryPickHead = readGitPath(cwd, 'CHERRY_PICK_HEAD');
  const stoppedSha = readGitPath(cwd, 'rebase-merge/stopped-sha');
  return !!cherryPickHead && !!stoppedSha && cherryPickHead.startsWith(stoppedSha);
}

function actions(operation: GitOperationKind, canSkip: boolean): GitOperationAction[] {
  const result: GitOperationAction[] = [
    { command: 'continue', key: 'c', label: 'continue', args: [operation, '--continue'] },
    { command: 'abort', key: 'a', label: 'abort', args: [operation, '--abort'], requiresConfirmation: true }
  ];
  if (canSkip) result.push({ command: 'skip', key: 's', label: 'skip', args: [operation, '--skip'] });
  return result;
}

// Keep upstream precedence: revert > cherry-pick > merge > rebase. This
// matters when a sequencer operation is nested inside an interactive rebase.
export function detectGitOperationState(cwd: string): GitOperationState | undefined {
  if (existsGitPath(cwd, 'REVERT_HEAD')) {
    return { kind: 'revert', label: 'reverting', menuTitle: 'Revert options', identity: operationIdentity(cwd, ['REVERT_HEAD']), actions: actions('revert', true) };
  }
  if (existsGitPath(cwd, 'CHERRY_PICK_HEAD') && !cherryPickIsPartOfRebase(cwd)) {
    return { kind: 'cherry-pick', label: 'cherry-picking', menuTitle: 'Cherry-pick options', identity: operationIdentity(cwd, ['CHERRY_PICK_HEAD']), actions: actions('cherry-pick', true) };
  }
  if (existsGitPath(cwd, 'MERGE_HEAD')) {
    return { kind: 'merge', label: 'merging', menuTitle: 'Merge options', identity: operationIdentity(cwd, ['MERGE_HEAD', 'MERGE_MSG']), actions: actions('merge', false) };
  }
  if (existsGitPath(cwd, 'rebase-merge') || existsGitPath(cwd, 'rebase-apply')) {
    return { kind: 'rebase', label: 'rebasing', menuTitle: 'Rebase options', identity: operationIdentity(cwd, ['rebase-merge', 'rebase-merge/orig-head', 'rebase-merge/stopped-sha', 'rebase-apply', 'rebase-apply/orig-head']), actions: actions('rebase', true) };
  }
  return undefined;
}
