import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { cloneGitConfig } from './lazygitConfig';

export type ChangedFile = { xy: string; path: string; staged: boolean; untracked: boolean };
export type LazyGitGitRuntimeConfig = ReturnType<typeof cloneGitConfig>;
export type Branch = { name: string; label: string; current: boolean; kind: 'local' | 'remote' | 'tag' | 'worktree'; upstream: string; ahead: number; behind: number };
export type Tag = { name: string; date: string; subject: string };
export type Remote = { name: string; fetchUrl: string; pushUrl: string };
export type Commit = { hash: string; subject: string; refs: string; author: string; relativeDate: string; graph: string };
export type CommitFile = { status: string; path: string; oldPath?: string };
export type Stash = { ref: string; message: string };
export type StashFile = { status: string; path: string; oldPath?: string };
export type ConflictFile = { xy: string; path: string };
export type WorkspaceRepository = { path: string; name: string; branch: string; workspaceFolder: string; changeCount: number };

type VsCodeGitRepository = { rootUri?: vscode.Uri; state?: { HEAD?: { name?: string } } };
type VsCodeGitApi = { repositories?: VsCodeGitRepository[] };

let activeWorkspaceRoot: string | undefined;
let discoveredWorkspaceRepoCount = 0;

export function getActiveWorkspaceRoot(): string | undefined {
  return activeWorkspaceRoot;
}

export function setActiveWorkspaceRoot(root: string | undefined) {
  activeWorkspaceRoot = root;
}

export function workspaceRoot(): string {
  if (activeWorkspaceRoot) return activeWorkspaceRoot;
  if (discoveredWorkspaceRepoCount > 1 || (vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
    throw new Error('Select a Status repository before running Git actions in a multi-repo workspace.');
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Open a Git workspace first.');
  return folder.uri.fsPath;
}

export function git(args: string[], cwd = workspaceRoot()): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim())); else resolve(stdout);
    });
  });
}

export function gitInput(args: string[], input: string, cwd = workspaceRoot()): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim())); else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}

function gitMaybe(args: string[], cwd: string): Promise<string> {
  return new Promise(resolve => {
    cp.execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }, (_err, stdout) => resolve(String(stdout ?? '')));
  });
}

async function repoRootFor(folderPath: string): Promise<string | undefined> {
  const root = (await gitMaybe(['rev-parse', '--show-toplevel'], folderPath)).trim();
  return root || undefined;
}

async function currentBranchForRepo(repoPath: string): Promise<string> {
  const branch = (await gitMaybe(['branch', '--show-current'], repoPath)).trim();
  if (branch) return branch;
  const hash = (await gitMaybe(['rev-parse', '--short', 'HEAD'], repoPath)).trim();
  return hash || '(detached)';
}

async function pendingChangeCountForRepo(repoPath: string): Promise<number> {
  const out = await gitMaybe(['status', '--porcelain', '-z'], repoPath);
  let count = 0;
  const parts = out.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 3) continue;
    count++;
    const xy = entry.slice(0, 2);
    if (xy[0] === 'R' || xy[0] === 'C') i++;
  }
  return count;
}

async function addVsCodeGitRepositories(roots: Map<string, string>, branches: Map<string, string>): Promise<void> {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) return;
  if (!gitExtension.isActive) await gitExtension.activate();
  const api = gitExtension.exports?.getAPI?.(1) as VsCodeGitApi | undefined;
  const repositories = api ? api.repositories ?? [] : [];
  for (const repo of repositories) {
    const rootUri = repo.rootUri;
    const root = rootUri?.fsPath;
    if (!root || !rootUri) continue;
    roots.set(root, vscode.workspace.getWorkspaceFolder(rootUri)?.name ?? path.basename(root));
    const branch = repo.state?.HEAD?.name;
    if (branch) branches.set(root, branch);
  }
}

function repositoryScanMaxDepth(): number {
  const configured = vscode.workspace.getConfiguration('git').get<number>('repositoryScanMaxDepth', 1);
  return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 1;
}

function repositoryScanIgnoredGlob(): string | undefined {
  const configured = vscode.workspace.getConfiguration('git').get<string[]>('repositoryScanIgnoredFolders', ['node_modules']);
  const ignored = Array.from(new Set([...(Array.isArray(configured) ? configured : []), 'node_modules', '.vscode-test', 'out', 'dist', 'dogfood-output']))
    .map(entry => entry.trim())
    .filter(Boolean);
  return ignored.length ? `**/{${ignored.join(',')}}/**` : undefined;
}

function repositoryScanHeadPatterns(maxDepth: number): string[] {
  const cappedDepth = Math.min(Math.max(maxDepth, 0), 12);
  return Array.from({ length: cappedDepth + 1 }, (_unused, depth) => `${'*/'.repeat(depth)}.git/HEAD`);
}

async function addWorkspaceScannedRepositories(roots: Map<string, string>): Promise<void> {
  const maxDepth = repositoryScanMaxDepth();
  const exclude = repositoryScanIgnoredGlob();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const pattern of repositoryScanHeadPatterns(maxDepth)) {
      let gitDirs: vscode.Uri[] = [];
      try { gitDirs = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern), exclude, 80); } catch { gitDirs = []; }
      for (const uri of gitDirs) {
        const candidate = path.dirname(path.dirname(uri.fsPath));
        const root = await repoRootFor(candidate).catch(() => undefined);
        if (root) roots.set(root, vscode.workspace.getWorkspaceFolder(uri)?.name ?? path.basename(root));
      }
    }
  }
}

export async function discoverWorkspaceRepositories(): Promise<WorkspaceRepository[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const roots = new Map<string, string>();
  const branchHints = new Map<string, string>();
  for (const folder of folders) {
    const root = await repoRootFor(folder.uri.fsPath).catch(() => undefined);
    if (root) roots.set(root, folder.name);
  }
  await addVsCodeGitRepositories(roots, branchHints).catch(() => undefined);
  await addWorkspaceScannedRepositories(roots).catch(() => undefined);
  discoveredWorkspaceRepoCount = roots.size;
  if (!activeWorkspaceRoot || !roots.has(activeWorkspaceRoot)) {
    activeWorkspaceRoot = roots.size === 1 ? roots.keys().next().value : undefined;
  }
  const repos = await Promise.all(Array.from(roots.entries()).map(async ([repoPath, workspaceFolder]) => ({
    path: repoPath,
    name: path.basename(repoPath),
    branch: branchHints.get(repoPath) ?? await currentBranchForRepo(repoPath),
    workspaceFolder,
    changeCount: await pendingChangeCountForRepo(repoPath)
  })));
  return repos.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

export async function changedFiles(gitConfig: LazyGitGitRuntimeConfig = cloneGitConfig()): Promise<ChangedFile[]> {
  const renameThreshold = Number(gitConfig.renameSimilarityThreshold);
  const renameArg = Number.isInteger(renameThreshold) && renameThreshold >= 0 && renameThreshold <= 100 ? `--find-renames=${renameThreshold}%` : '--find-renames=50%';
  const out = await git(['status', '--untracked-files=all', '--porcelain', '-z', renameArg]);
  const parts = out.split('\0').filter(Boolean);
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 3) continue;
    const xy = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++;
    files.push({ xy, path: filePath, staged: xy[0] !== ' ' && xy[0] !== '?', untracked: xy === '??' });
  }
  return files;
}

function parseAheadBehind(track: string): { ahead: number; behind: number } {
  const ahead = Number(track.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(track.match(/behind (\d+)/)?.[1] ?? 0);
  return { ahead, behind };
}

export async function branches(): Promise<Branch[]> {
  const out = await git(['branch', '--all', '--format=%(HEAD)%09%(refname:short)%09%(upstream:short)%09%(upstream:track)']);
  const items: Branch[] = out.split('\n').filter(Boolean).map(line => {
    const [head, raw, upstream = '', track = ''] = line.split('\t');
    const kind = raw.startsWith('remotes/') ? 'remote' : 'local';
    const name = kind === 'remote' ? raw.replace(/^remotes\//, '') : raw;
    return { name, label: name, current: head.trim() === '*', kind, upstream, ...parseAheadBehind(track) };
  });
  const worktrees = await git(['worktree', 'list', '--porcelain']).catch(() => '');
  for (const line of worktrees.split('\n')) if (line.startsWith('branch ')) { const name = line.slice(7).replace(/^refs\/heads\//, ''); if (!items.some(b => b.kind === 'worktree' && b.name === name)) items.push({ name, label: name, current: false, kind: 'worktree', upstream: '', ahead: 0, behind: 0 }); }
  return items.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    const kindRank = (branch: Branch) => branch.kind === 'local' ? 0 : branch.kind === 'worktree' ? 1 : 2;
    return kindRank(a) - kindRank(b) || a.label.localeCompare(b.label);
  });
}

export async function tags(): Promise<Tag[]> {
  const out = await git(['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:short)%09%(subject)', 'refs/tags']);
  return out.split('\n').filter(Boolean).map(line => {
    const [name, date = '', ...subject] = line.split('\t');
    return { name, date, subject: subject.join('\t') };
  });
}

export async function remotes(): Promise<Remote[]> {
  const out = await git(['remote', '-v']);
  const map = new Map<string, Remote>();
  for (const line of out.split('\n').filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, kind] = match;
    const item = map.get(name) ?? { name, fetchUrl: '', pushUrl: '' };
    if (kind === 'fetch') item.fetchUrl = url; else item.pushUrl = url;
    map.set(name, item);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function commits(ref?: string): Promise<Commit[]> {
  const args = ['log', '--decorate=short', '--max-count=80', '--pretty=format:%h%x09%D%x09%s%x09%an%x09%ar'];
  if (ref) args.push(ref, '--');
  const out = await git(args);
  return out.split('\n').filter(Boolean).map(line => {
    const [hash, refs, subject = '', author = '', relativeDate = ''] = line.split('\t');
    return { hash, refs, subject, author, relativeDate, graph: '' };
  });
}

export function compactRefs(refs: string): string {
  if (!refs) return '';
  const parts = refs.split(',').map(ref => ref.trim().replace(/^HEAD -> /, '').replace(/^tag: /, '🏷 ')).filter(Boolean);
  const head = parts.find(ref => ref === 'HEAD') ?? parts.find(ref => !ref.includes('/')) ?? parts[0];
  return head ?? '';
}

export async function stashes(): Promise<Stash[]> {
  const out = await git(['stash', 'list', '--pretty=format:%gd%x09%s']);
  return out.split('\n').filter(Boolean).map(line => { const [ref, ...msg] = line.split('\t'); return { ref, message: msg.join('\t') }; });
}

export async function commitFiles(hash: string): Promise<CommitFile[]> {
  const out = await git(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', hash]);
  return out.split('\n').filter(Boolean).map(line => { const parts = line.split('\t'); return { status: parts[0], oldPath: parts.length > 2 ? parts[1] : undefined, path: parts[parts.length - 1] }; });
}

export async function stashFiles(ref: string): Promise<StashFile[]> {
  const out = await git(['stash', 'show', '--name-status', '--find-renames', ref]);
  return out.split('\n').filter(Boolean).map(line => { const parts = line.split('\t'); return { status: parts[0], oldPath: parts.length > 2 ? parts[1] : undefined, path: parts[parts.length - 1] }; });
}

export async function conflictFiles(): Promise<ConflictFile[]> {
  return (await changedFiles()).filter(f => f.xy.includes('U') || ['AA', 'DD'].includes(f.xy)).map(f => ({ xy: f.xy, path: f.path }));
}
