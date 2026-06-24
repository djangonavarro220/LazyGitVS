import * as vscode from 'vscode';
import { dangerousGitMenuItem, destructiveGitActionReason, discardAllConfirmation, discardConfirmation, nukeWorkingTreeConfirmation, resetConfirmation } from './destructiveActions';
import { applyHunk, discardUnstagedHunk } from './gitActions';
import { git, type ChangedFile, type Commit } from './gitService';
import { type Hunk } from './hunkPatch';
import { decorateMenuItems, findMenuItemByKey } from './lazygitMenu';

export type GitMenuItem = vscode.QuickPickItem & { key?: string; args?: string[]; danger?: boolean; confirm?: string; run?: () => Promise<void> };
export type CopyText = (text: string, label?: string) => Promise<void>;

async function upstreamBranch(): Promise<string | undefined> {
  return git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then(out => out.trim()).catch(() => undefined);
}

export async function originCommitUrl(hash: string): Promise<string | undefined> {
  const remote = (await git(['config', '--get', 'remote.origin.url']).catch(() => '')).trim();
  if (!remote) return undefined;
  let base = remote;
  const ssh = base.match(/^git@([^:]+):(.+)$/);
  if (ssh) base = `https://${ssh[1]}/${ssh[2]}`;
  base = base.replace(/\.git$/, '');
  if (!/^https?:\/\//.test(base)) return undefined;
  return `${base}/commit/${encodeURIComponent(hash)}`;
}

export async function runGitAction(title: string, args: string[]) {
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, async () => git(args));
  vscode.window.showInformationMessage(`LazyGitVS: ${title} done.`);
}

export async function executeGitMenuItem(item: GitMenuItem) {
  const destructiveReason = destructiveGitActionReason(item.args);
  if (item.danger || item.confirm || destructiveReason) {
    const ok = await vscode.window.showWarningMessage(item.confirm ?? `Run destructive Git action (${destructiveReason}) for ${item.label}?`, { modal: true }, 'Run');
    if (ok !== 'Run') return false;
  }
  if (item.run) await item.run();
  else if (item.args) await runGitAction(item.label.replace(/^([^ ]+\s+)?\$\([^)]*\)\s*/, '').replace(/^[^ ]+\s+/, ''), item.args);
  return true;
}

export async function pickGitAction(title: string, items: GitMenuItem[]) {
  const qp = vscode.window.createQuickPick<GitMenuItem>();
  qp.title = title;
  qp.placeholder = 'type the lazygit key or filter options';
  qp.items = decorateMenuItems(items) as GitMenuItem[];
  return await new Promise<boolean>(resolve => {
    let done = false;
    const finish = async (item?: GitMenuItem) => {
      if (done) return;
      done = true;
      qp.hide();
      if (!item || !('args' in item || 'run' in item)) { resolve(false); return; }
      resolve(await executeGitMenuItem(item));
    };
    qp.onDidChangeValue(value => {
      const item = findMenuItemByKey(items, value);
      if (item) void finish(item);
    });
    qp.onDidAccept(() => void finish(qp.selectedItems[0] ?? qp.activeItems[0]));
    qp.onDidHide(() => { if (!done) { done = true; resolve(false); } qp.dispose(); });
    qp.show();
  });
}

export async function showCommitResetMenu(commit: Commit) {
  await pickGitAction(`Reset to ${commit.hash}`, [
    dangerousGitMenuItem({ key: 's', label: '$(debug-restart) Soft reset to commit', description: 'keep index and working tree', args: ['reset', '--soft', commit.hash] }, resetConfirmation(commit.hash, 'soft'), 'history-rewrite'),
    dangerousGitMenuItem({ key: 'm', label: '$(debug-restart) Mixed reset to commit', description: 'keep working tree', args: ['reset', '--mixed', commit.hash] }, resetConfirmation(commit.hash, 'mixed'), 'history-rewrite'),
    dangerousGitMenuItem({ key: 'h', label: '$(warning) Hard reset to commit', description: 'discard index and working tree', args: ['reset', '--hard', commit.hash] }, resetConfirmation(commit.hash, 'hard'), 'history-rewrite')
  ]);
}

export async function showCommitCopyMenu(commit: Commit, copyText: CopyText) {
  await pickGitAction(`Copy commit ${commit.hash}`, [
    { key: 'h', label: '$(copy) Copy hash', description: commit.hash, run: async () => copyText(commit.hash, 'commit hash copied') },
    { key: 's', label: '$(copy) Copy subject', description: commit.subject, run: async () => copyText(commit.subject, 'commit subject copied') },
    { key: 'c', label: '$(copy) Copy hash + subject', description: `${commit.hash} ${commit.subject}`, run: async () => copyText(`${commit.hash} ${commit.subject}`, 'commit copied') }
  ]);
}

export async function showPushMenu() { await pickGitAction('Push options', [
  { key: 'p', label: '$(cloud-upload) Push', description: 'git push', args: ['push'] },
  { key: 'P', label: '$(cloud-upload) Push current branch', description: 'git push origin HEAD', args: ['push', 'origin', 'HEAD'] },
  { key: 't', label: '$(tag) Push tags', description: 'git push --tags', args: ['push', '--tags'] },
  { key: 'f', label: '$(warning) Force push with lease', description: 'git push --force-with-lease', args: ['push', '--force-with-lease'], danger: true, confirm: 'Force push with lease? Safer than --force, still remote-changing.' },
  { key: 'u', label: '$(repo-push) Set upstream and push', description: 'git push -u origin HEAD', args: ['push', '-u', 'origin', 'HEAD'] }
]); }

export async function showPullMenu() { await pickGitAction('Pull / fetch options', [
  { key: 'p', label: '$(cloud-download) Pull', description: 'git pull', args: ['pull'] },
  { key: 'r', label: '$(git-compare) Pull --rebase', description: 'git pull --rebase', args: ['pull', '--rebase'] },
  { key: 'f', label: '$(sync) Fetch', description: 'git fetch', args: ['fetch'] },
  { key: 'a', label: '$(sync) Fetch all', description: 'git fetch --all --prune', args: ['fetch', '--all', '--prune'] },
  { key: 'P', label: '$(trash) Prune remotes', description: 'git remote prune origin', args: ['remote', 'prune', 'origin'] }
]); }

export async function showStashCreateMenu() { await pickGitAction('Stash options', [
  { key: 'a', label: '$(archive) Stash all changes', description: 'git stash push', args: ['stash', 'push'] },
  { key: 'i', label: '$(archive) Stash all changes and keep index', description: 'git stash push --keep-index', args: ['stash', 'push', '--keep-index'] },
  { key: 'U', label: '$(archive) Stash include untracked changes', description: 'git stash push -u', args: ['stash', 'push', '-u'] },
  { key: 's', label: '$(archive) Stash staged changes', description: 'git stash push --staged', args: ['stash', 'push', '--staged'] },
  { key: 'u', label: '$(archive) Stash unstaged changes', description: 'git stash push --keep-index', args: ['stash', 'push', '--keep-index'] }
]); }

export async function showResetMenu(onNuke?: () => void | Promise<void>) {
  const upstream = await upstreamBranch();
  const items: GitMenuItem[] = [
    dangerousGitMenuItem({ key: 's', label: '$(debug-restart) Soft reset to previous commit', description: 'keep index and working tree', args: ['reset', '--soft', 'HEAD~1'] }, resetConfirmation('HEAD~1', 'soft'), 'history-rewrite'),
    dangerousGitMenuItem({ key: 'm', label: '$(debug-restart) Mixed reset to previous commit', description: 'keep working tree', args: ['reset', '--mixed', 'HEAD~1'] }, resetConfirmation('HEAD~1', 'mixed'), 'history-rewrite'),
    dangerousGitMenuItem({ key: 'h', label: '$(warning) Hard reset to HEAD', description: 'discard working tree and index', args: ['reset', '--hard', 'HEAD'] }, resetConfirmation('HEAD', 'hard'), 'history-rewrite'),
  ];
  if (upstream) items.push(dangerousGitMenuItem({ key: 'u', label: '$(repo-pull) Reset to upstream', description: upstream, args: ['reset', '--hard', upstream] }, `Hard reset current branch to ${upstream}?`, 'history-rewrite'));
  items.push(dangerousGitMenuItem({ key: 'n', label: '💣 Nuke working tree', description: 'git reset --hard HEAD && git clean -fd', run: async () => { await onNuke?.(); await git(['reset', '--hard', 'HEAD']); await git(['clean', '-fd']); } }, nukeWorkingTreeConfirmation(), 'nuke'));
  await pickGitAction('Reset options', items);
}

export async function showDiscardFileMenu(file: ChangedFile, confirmKey = 'x') { await pickGitAction(`Discard changes · ${file.path}`, [
  dangerousGitMenuItem({ key: confirmKey, label: '$(warning) Discard all changes', description: 'unstage and restore file', run: async () => { await git(['restore', '--staged', '--', file.path]); await git(['restore', '--', file.path]); } }, discardAllConfirmation(file.path), 'discard'),
  dangerousGitMenuItem({ key: 'u', label: '$(discard) Discard unstaged changes', description: 'git restore -- file', args: ['restore', '--', file.path] }, discardConfirmation(file.path), 'discard')
]); }

export async function showDiscardHunkMenu(hunk: Hunk) { await pickGitAction('Hunk options', hunk.staged ? [
  { key: 'd', label: '$(remove) Unstage hunk', description: 'git apply --cached --reverse', run: () => applyHunk(hunk) }
] : [
  { key: 'd', label: '$(discard) Discard hunk', description: 'git apply --reverse', danger: true, confirm: 'Discard this unstaged hunk from the working tree?', run: () => discardUnstagedHunk(hunk) },
  { key: '<space>', label: '$(add) Stage hunk', description: 'git apply --cached', run: () => applyHunk(hunk) }
]); }
