import type { ChangedFile } from './gitService';

export type FileTreeRow =
  | { kind: 'dir'; path: string; label: string; depth: number; collapsed: boolean; file?: never }
  | { kind: 'file'; path: string; label: string; depth: number; file: ChangedFile };

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
