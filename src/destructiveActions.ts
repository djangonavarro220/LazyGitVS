export type DestructiveSeverity = 'discard' | 'history-rewrite' | 'nuke';

export type DestructiveGitMenuFields = {
  danger: true;
  confirm: string;
  destructiveSeverity: DestructiveSeverity;
};

export type DestructiveGitActionReason =
  | 'amend'
  | 'cherry-pick'
  | 'clean'
  | 'conflict checkout'
  | 'delete branch'
  | 'delete tag'
  | 'discard'
  | 'drop stash'
  | 'force checkout'
  | 'force push'
  | 'merge'
  | 'pop stash'
  | 'rebase'
  | 'remove remote'
  | 'reset'
  | 'revert';

export function dangerousGitMenuItem<T extends object>(item: T, confirm: string, destructiveSeverity: DestructiveSeverity): T & DestructiveGitMenuFields {
  return { ...item, danger: true, confirm, destructiveSeverity };
}

export function destructiveGitActionReason(args: readonly string[] | undefined): DestructiveGitActionReason | undefined {
  if (!args?.length) return undefined;
  const [command, ...rest] = args;
  if (command === 'reset') return 'reset';
  if (command === 'clean') return 'clean';
  if (command === 'restore' && !rest.includes('--staged')) return 'discard';
  if (command === 'restore' && rest.includes('--worktree')) return 'discard';
  if (command === 'checkout' && rest.includes('-f')) return 'force checkout';
  if (command === 'checkout' && (rest.includes('--ours') || rest.includes('--theirs'))) return 'conflict checkout';
  if (command === 'branch' && (rest.includes('-d') || rest.includes('-D') || rest.includes('-dr'))) return 'delete branch';
  if (command === 'tag' && rest.includes('-d')) return 'delete tag';
  if (command === 'remote' && (rest[0] === 'remove' || rest[0] === 'rm')) return 'remove remote';
  if (command === 'stash' && rest[0] === 'drop') return 'drop stash';
  if (command === 'stash' && rest[0] === 'pop') return 'pop stash';
  if (command === 'merge' && !rest.includes('--ff-only')) return 'merge';
  if (command === 'rebase') return 'rebase';
  if (command === 'cherry-pick') return 'cherry-pick';
  if (command === 'revert') return 'revert';
  if (command === 'push' && rest.some(arg => arg === '--force' || arg === '-f' || arg === '--force-with-lease')) return 'force push';
  if (command === 'commit' && rest.includes('--amend')) return 'amend';
  return undefined;
}

export function discardConfirmation(target: string): string {
  return `Discard unstaged changes in ${target}?`;
}

export function discardAllConfirmation(target: string): string {
  return `Discard all staged and unstaged changes in ${target}?`;
}

export function resetConfirmation(ref: string, mode: 'soft' | 'mixed' | 'hard'): string {
  const prefix = mode[0].toUpperCase() + mode.slice(1);
  return mode === 'hard' ? `${prefix} reset to ${ref}? Not undoable here.` : `${prefix} reset to ${ref}?`;
}

export function nukeWorkingTreeConfirmation(): string {
  return '💣 Nuke working tree? This discards staged, unstaged and untracked changes. Not undoable.';
}
