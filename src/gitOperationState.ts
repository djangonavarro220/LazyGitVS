import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type GitOperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'bisect';
export type GitOperationActionCommand = 'continue' | 'abort' | 'skip' | 'good' | 'bad' | 'reset';

export type GitOperationAction = {
  command: GitOperationActionCommand;
  label: string;
  args: string[];
  requiresConfirmation?: boolean;
};

export type GitOperationState = {
  kind: GitOperationKind;
  label: string;
  actions: GitOperationAction[];
};

function gitPath(cwd: string, name: string): string | undefined {
  try {
    const out = cp.execFileSync('git', ['rev-parse', '--git-path', name], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const raw = out.trim();
    if (!raw) return undefined;
    return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  } catch {
    return undefined;
  }
}

function existsGitPath(cwd: string, name: string): boolean {
  const file = gitPath(cwd, name);
  return !!file && fs.existsSync(file);
}

const continueAction = (operation: 'merge' | 'rebase' | 'cherry-pick'): GitOperationAction => ({
  command: 'continue',
  label: 'Continue',
  args: [operation, '--continue']
});
const abortAction = (operation: 'merge' | 'rebase' | 'cherry-pick'): GitOperationAction => ({
  command: 'abort',
  label: 'Abort',
  args: [operation, '--abort'],
  requiresConfirmation: true
});
const skipAction = (operation: 'rebase' | 'cherry-pick'): GitOperationAction => ({
  command: 'skip',
  label: 'Skip',
  args: [operation, '--skip']
});

export function detectGitOperationState(cwd: string): GitOperationState | undefined {
  if (existsGitPath(cwd, 'rebase-merge') || existsGitPath(cwd, 'rebase-apply')) {
    return {
      kind: 'rebase',
      label: 'Rebase in progress',
      actions: [continueAction('rebase'), abortAction('rebase'), skipAction('rebase')]
    };
  }
  if (existsGitPath(cwd, 'MERGE_HEAD')) {
    return {
      kind: 'merge',
      label: 'Merge in progress',
      actions: [continueAction('merge'), abortAction('merge')]
    };
  }
  if (existsGitPath(cwd, 'CHERRY_PICK_HEAD')) {
    return {
      kind: 'cherry-pick',
      label: 'Cherry-pick in progress',
      actions: [continueAction('cherry-pick'), abortAction('cherry-pick'), skipAction('cherry-pick')]
    };
  }
  if (existsGitPath(cwd, 'BISECT_LOG')) {
    return {
      kind: 'bisect',
      label: 'Bisect in progress',
      actions: [
        { command: 'good', label: 'Mark good', args: ['bisect', 'good'] },
        { command: 'bad', label: 'Mark bad', args: ['bisect', 'bad'] },
        { command: 'reset', label: 'Reset bisect', args: ['bisect', 'reset'], requiresConfirmation: true }
      ]
    };
  }
  return undefined;
}
