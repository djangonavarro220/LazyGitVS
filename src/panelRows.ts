import type { Branch, ChangedFile, Commit } from './gitService';
import type { FileTreeRow } from './panels';

export function statusKind(ch: string): string {
  return ch === 'M' ? 'modified' : ch === 'A' ? 'added' : ch === 'D' ? 'deleted' : ch === 'R' ? 'renamed' : ch === 'C' ? 'copied' : ch === 'U' ? 'conflict' : ch === '?' ? 'untracked' : 'clean';
}

export function fileStateLabel(f: ChangedFile): string {
  if (f.untracked) return 'untracked';
  if (f.staged && f.xy[1] !== ' ') return 'staged + unstaged';
  if (f.staged) return 'staged';
  return 'unstaged';
}

export function fileStatusHtml(f: ChangedFile): string {
  const [index, worktree] = [f.xy[0] ?? ' ', f.xy[1] ?? ' '];
  const slot = (kind: 'index' | 'worktree', ch: string) => ch === ' '
    ? `<span class="slot empty ${kind}" aria-hidden="true"></span>`
    : `<span class="slot ${kind} ${statusKind(ch)}" title="${kind === 'index' ? 'index/staged' : 'worktree/unstaged'}: ${escapeHtml(ch)}">${escapeHtml(ch)}</span>`;
  return `<span class="status-pair" title="${escapeHtml(f.xy)} · ${escapeHtml(fileStateLabel(f))}">${slot('index', index)}${slot('worktree', worktree)}</span>`;
}

export function row(sel: boolean, klass: string, status: string, main: string, meta = '', index?: number): string {
  const data = typeof index === 'number' ? ` data-index="${index}"` : '';
  return `<div class="row ${sel ? 'sel' : ''} ${klass}" role="option" aria-selected="${sel ? 'true' : 'false'}"${data}><span class="cursor">${sel ? '›' : ' '}</span><span class="status">${escapeHtml(status)}</span><span class="path">${escapeHtml(main)}</span>${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}</div>`;
}

export function dirRow(sel: boolean, klass: string, row: FileTreeRow, index: number): string {
  const arrow = row.kind === 'dir' && row.collapsed ? '▶' : '▼';
  return `<div class="row ${sel ? 'sel' : ''} ${klass}" role="option" aria-selected="${sel ? 'true' : 'false'}" data-index="${index}" title="${escapeHtml(row.path)}"><span class="cursor">${sel ? '›' : ' '}</span><span class="path tree-line"><span class="tree-indent" style="--tree-indent:${row.depth * 2}ch"></span><span class="tree-arrow">${arrow}</span><span class="tree-name">${escapeHtml(row.label)}</span></span></div>`;
}

export function treeFileRow(sel: boolean, klass: string, file: ChangedFile, main: string, depth: number, index: number): string {
  return `<div class="row file tree ${sel ? 'sel' : ''} ${klass}" role="option" aria-selected="${sel ? 'true' : 'false'}" data-index="${index}" title="${escapeHtml(file.xy)} · ${escapeHtml(fileStateLabel(file))} · ${escapeHtml(file.path)}"><span class="cursor">${sel ? '›' : ' '}</span><span class="path tree-line"><span class="tree-indent" style="--tree-indent:${depth * 2}ch"></span>${fileStatusHtml(file)}<span class="tree-name">${escapeHtml(main)}</span></span></div>`;
}

export function fileRow(sel: boolean, klass: string, file: ChangedFile, main: string, index: number): string {
  return `<div class="row file ${sel ? 'sel' : ''} ${klass}" role="option" aria-selected="${sel ? 'true' : 'false'}" data-index="${index}" title="${escapeHtml(file.xy)} · ${escapeHtml(fileStateLabel(file))} · ${escapeHtml(file.path)}"><span class="cursor">${sel ? '›' : ' '}</span><span class="status">${fileStatusHtml(file)}</span><span class="path">${escapeHtml(main)}</span></div>`;
}

export function branchRow(sel: boolean, branch: Branch, index: number): string {
  const kindLabel = branch.kind === 'remote' ? 'R' : branch.kind === 'tag' ? 'T' : branch.kind === 'worktree' ? 'W' : 'L';
  const sync = `${branch.ahead ? `↑${branch.ahead}` : ''}${branch.ahead && branch.behind ? ' ' : ''}${branch.behind ? `↓${branch.behind}` : ''}`;
  const meta = sync || branch.upstream || branch.kind;
  const title = [branch.kind, branch.current ? 'current' : '', branch.upstream ? `upstream ${branch.upstream}` : '', sync].filter(Boolean).join(' · ');
  return `<div class="row branch-row ${sel ? 'sel' : ''} ${branch.current ? 'current' : ''} ${branch.kind}" role="option" aria-selected="${sel ? 'true' : 'false'}" data-index="${index}" title="${escapeHtml(title)}"><span class="cursor">${sel ? '›' : ' '}</span><span class="ref-kind">${branch.current ? '●' : kindLabel}</span><span class="path branch-name">${escapeHtml(branch.label)}</span>${meta ? `<span class="meta branch-meta">${escapeHtml(meta)}</span>` : ''}</div>`;
}

export function commitRow(sel: boolean, commit: Commit, index: number): string {
  const details = commit.relativeDate;
  const titleDetails = `${commit.refs ? ` · ${escapeHtml(commit.refs)}` : ''}${[commit.relativeDate, commit.author].filter(Boolean).map(escapeHtml).map(part => ` · ${part}`).join('')}`;
  return `<div class="row commit-row ${sel ? 'sel' : ''}" role="option" aria-selected="${sel ? 'true' : 'false'}" data-index="${index}" title="${escapeHtml(commit.hash)} · ${escapeHtml(commit.subject)}${titleDetails}"><span class="cursor">${sel ? '›' : ' '}</span><span class="hash-pill">${escapeHtml(commit.hash)}</span><span class="commit-main path">${escapeHtml(commit.subject)}</span>${details ? `<span class="meta commit-meta">${escapeHtml(details)}</span>` : ''}</div>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
