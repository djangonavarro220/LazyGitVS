export type DestructiveSeverity = 'discard' | 'history-rewrite' | 'nuke';

export type DestructiveGitMenuFields = {
  danger: true;
  confirm: string;
  destructiveSeverity: DestructiveSeverity;
};

export function dangerousGitMenuItem<T extends object>(item: T, confirm: string, destructiveSeverity: DestructiveSeverity): T & DestructiveGitMenuFields {
  return { ...item, danger: true, confirm, destructiveSeverity };
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
