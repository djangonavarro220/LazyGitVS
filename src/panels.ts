import type { ChangedFile } from './gitService';
import { ListModelCache } from './listModel';

export type TreeRow<T extends { path: string }> =
  | { kind: 'dir'; path: string; label: string; depth: number; collapsed: boolean; file?: never }
  | { kind: 'file'; path: string; label: string; depth: number; file: T };

export type FileTreeRow = TreeRow<ChangedFile>;

export type TreeSortOptions = { showFileTree: boolean; fileTreeSortOrder: string; fileTreeSortCaseSensitive: boolean };

export type FilePanelModelRequest = Readonly<{
  files: readonly ChangedFile[];
  selection: number;
  projectionKey: string;
  treeKey: string;
  project(files: readonly ChangedFile[]): ChangedFile[];
  options: TreeSortOptions;
  collapsedDirs: ReadonlySet<string>;
}>;

/** Production Files-panel seam. LGVS-005 must replace this local generation with its accepted refresh generation. */
export class FilePanelListModel {
  private readonly cache = new ListModelCache<ChangedFile, FileTreeRow, string>();
  private source: readonly ChangedFile[] | undefined;
  private projectionKey = '';
  private treeKey = '';
  private generation = 0;

  read(request: FilePanelModelRequest): readonly Readonly<FileTreeRow>[] {
    if (request.files !== this.source || request.projectionKey !== this.projectionKey || request.treeKey !== this.treeKey) {
      this.source = request.files;
      this.projectionKey = request.projectionKey;
      this.treeKey = request.treeKey;
      this.generation++;
    }
    return this.cache.read({
      modelId: 'production:files-panel', ownerGeneration: this.generation,
      sourceRevision: this.generation,
      projectionRevision: this.generation, treeRevision: this.generation,
      items: request.files, selection: request.selection,
      project: files => buildTreeRows(request.project(files).map(file => ({ ...file })), request.options, new Set(request.collapsedDirs)),
      projectedRows: 'transfer', identity: row => `${row.kind}:${row.path}`
    }).rows;
  }
}

export function buildTreeRows<T extends { path: string }>(files: T[], options: TreeSortOptions, collapsedDirs: Set<string>): TreeRow<T>[] {
  if (!options.showFileTree) return files.map(file => ({ kind: 'file', path: file.path, label: file.path, depth: 0, file }));
  type Node = { path: string; part: string; file?: T; children: Node[] };
  const root: Node = { path: '', part: '', children: [] };
  const child = (parent: Node, part: string, pathValue: string) => {
    let node = parent.children.find(c => c.part === part);
    if (!node) { node = { path: pathValue, part, children: [] }; parent.children.push(node); }
    return node;
  };
  for (const file of files) {
    let node = root;
    const parts = file.path.split('/');
    parts.forEach((part, index) => {
      node = child(node, part, parts.slice(0, index + 1).join('/'));
      if (index === parts.length - 1) node.file = file;
    });
  }
  const cmp = (a: Node, b: Node) => {
    const normalize = (value: string) => options.fileTreeSortCaseSensitive ? value : value.toLocaleLowerCase();
    if (options.fileTreeSortOrder === 'foldersFirst' && Boolean(a.file) !== Boolean(b.file)) return a.file ? 1 : -1;
    if (options.fileTreeSortOrder === 'filesFirst' && Boolean(a.file) !== Boolean(b.file)) return a.file ? -1 : 1;
    return normalize(a.path).localeCompare(normalize(b.path));
  };
  const sort = (node: Node) => { node.children.sort(cmp); node.children.forEach(sort); };
  sort(root);
  const rows: TreeRow<T>[] = [];
  const labelFromDepth = (node: Node, treeDepth: number) => node.path.split('/').slice(treeDepth).join('/');
  const render = (node: Node, treeDepth: number, visualDepth: number) => {
    if (node.file) { rows.push({ kind: 'file', path: node.path, label: labelFromDepth(node, treeDepth), depth: visualDepth, file: node.file }); return; }
    let visible = node;
    let compressedDepth = treeDepth;
    while (visible.children.length === 1 && !visible.children[0].file) { visible = visible.children[0]; compressedDepth++; }
    const collapsed = collapsedDirs.has(visible.path);
    rows.push({ kind: 'dir', path: visible.path, label: labelFromDepth(visible, treeDepth), depth: visualDepth, collapsed });
    if (!collapsed) visible.children.forEach(childNode => render(childNode, compressedDepth + 1, visualDepth + 1));
  };
  root.children.forEach(node => render(node, 0, 0));
  return rows;
}


export type Panel = 'status' | 'files' | 'hunks' | 'branches' | 'commits' | 'stash' | 'conflicts' | 'tags' | 'remotes';
export type ViewPanel = Exclude<Panel, 'hunks'>;
export type FocusArea = 'panel' | 'viewer' | 'editor-hunk' | 'editor-edit' | 'none';

export const REFRESH_INTERVAL_MS = 10_000;
export const STATE_KEY = 'lazygitvs.navigationState';
export const VIEW_IDS: Record<ViewPanel, string> = {
  status: 'lazygitvs.statusView',
  files: 'lazygitvs.filesView',
  branches: 'lazygitvs.branchesView',
  tags: 'lazygitvs.tagsView',
  remotes: 'lazygitvs.remotesView',
  commits: 'lazygitvs.commitsView',
  stash: 'lazygitvs.stashView',
  conflicts: 'lazygitvs.conflictsView'
};
export const PANEL_ORDER: ViewPanel[] = ['status', 'files', 'branches', 'commits', 'stash', 'conflicts', 'tags', 'remotes'];

export function isViewPanel(value: unknown): value is ViewPanel {
  return value === 'status' || value === 'files' || value === 'branches' || value === 'commits' || value === 'stash' || value === 'conflicts' || value === 'tags' || value === 'remotes';
}

export function isPanel(value: unknown): value is Panel {
  return isViewPanel(value) || value === 'hunks';
}
