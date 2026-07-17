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
      // Tree paths are unique across directory and file rows; reuse the existing
      // immutable path instead of allocating a prefixed identity for every row.
      projectedRows: 'transfer', identity: row => row.path
    }).rows;
  }
}

export function buildTreeRows<T extends { path: string }>(files: T[], options: TreeSortOptions, collapsedDirs: Set<string>): TreeRow<T>[] {
  if (!options.showFileTree) return files.map(file => ({ kind: 'file', path: file.path, label: file.path, depth: 0, file }));
  type Node = { path: string; part: string; sortKey: string; file?: T; children?: Node[]; childrenByPart?: Map<string, Node> };
  const normalize = options.fileTreeSortCaseSensitive
    ? (value: string) => value
    : (value: string) => {
        for (let index = 0; index < value.length; index++) {
          const code = value.charCodeAt(index);
          if ((code >= 65 && code <= 90) || code >= 128) return value.toLocaleLowerCase();
        }
        return value;
      };
  const root: Node = { path: '', part: '', sortKey: '', children: [], childrenByPart: new Map() };
  for (const file of files) {
    let node = root;
    let segmentStart = 0;
    while (segmentStart <= file.path.length) {
      const slash = file.path.indexOf('/', segmentStart);
      const isFile = slash === -1;
      const part = file.path.slice(segmentStart, isFile ? file.path.length : slash);
      const childrenByPart = node.childrenByPart ??= new Map();
      let next = childrenByPart.get(part);
      if (!next) {
        // Slice the original prefix instead of rebuilding from truthy parent paths:
        // empty segments (including a leading slash) are semantic tree identity.
        const pathValue = file.path.slice(0, isFile ? file.path.length : slash);
        next = isFile
          ? { path: pathValue, part, sortKey: normalize(pathValue), file }
          : { path: pathValue, part, sortKey: normalize(pathValue), children: [], childrenByPart: new Map() };
        childrenByPart.set(part, next);
        (node.children ??= []).push(next);
      }
      node = next;
      if (isFile) {
        node.file = file;
        break;
      }
      segmentStart = slash + 1;
    }
  }
  const cmp = (a: Node, b: Node) => {
    if (options.fileTreeSortOrder === 'foldersFirst' && Boolean(a.file) !== Boolean(b.file)) return a.file ? 1 : -1;
    if (options.fileTreeSortOrder === 'filesFirst' && Boolean(a.file) !== Boolean(b.file)) return a.file ? -1 : 1;
    return a.sortKey.localeCompare(b.sortKey);
  };
  const sort = (node: Node) => {
    if (!node.children) return;
    node.children.sort(cmp);
    for (const child of node.children) sort(child);
  };
  sort(root);
  const rows: TreeRow<T>[] = [];
  const render = (node: Node, visualDepth: number) => {
    if (node.file) { rows.push({ kind: 'file', path: node.path, label: node.part, depth: visualDepth, file: node.file }); return; }
    let visible = node;
    let label = node.part;
    while (visible.children?.length === 1 && !visible.children[0].file) {
      visible = visible.children[0];
      label += `/${visible.part}`;
    }
    const collapsed = collapsedDirs.has(visible.path);
    rows.push({ kind: 'dir', path: visible.path, label, depth: visualDepth, collapsed });
    if (!collapsed && visible.children) {
      for (const child of visible.children) render(child, visualDepth + 1);
    }
  };
  if (root.children) {
    for (const node of root.children) render(node, 0);
  }
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
