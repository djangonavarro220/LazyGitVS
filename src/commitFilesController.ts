import * as crypto from 'crypto';
import type { Commit, CommitFile, LazyGitGitRuntimeConfig } from './gitService';
export { LatestWinsAsyncGate } from './previewRequestGate';
import { LatestWinsAsyncGate } from './previewRequestGate';
import * as commitFileCheckout from './commitFileCheckout';
import * as commitFileClipboard from './commitFileClipboard';
import { discardCommitFileChanges } from './commitFileDiscard';
import { enterCommitFileHunkMode } from './commitFileHunk';
import type { CopyText, GitMenuItem, GitRunner } from './gitMenus';
import type { TreeSortOptions } from './panels';

export type CommitFilesSelectedRow =
  | { kind: 'dir'; path: string }
  | { kind: 'file'; file: { path: string; oldPath?: string; status?: string } };

export type CommitFilesOwner = Readonly<{
  repoPath: string;
  branchRef: string;
  head: string;
  commitHash: string;
  generation: number;
  selectionEpoch: number;
  selectedRowIdentity: string;
  filterText?: string;
  sessionId: string;
  capability?: string;
}>;

export type CommitFilesHostContext = Readonly<{
  liveRepo?: string;
  selectedCommitHash?: string;
  filterText?: string;
  selectionEpoch: number;
  activeViewPanel: string;
  physicalPanel?: string;
}>;

export function createCommitFilesHostContext(
  liveRepo: string | undefined,
  selectedCommitHash: string | undefined,
  filterText: string,
  selectionEpoch: number,
  activeViewPanel: string,
): CommitFilesHostContext {
  return { liveRepo, selectedCommitHash, filterText, selectionEpoch, activeViewPanel, physicalPanel: 'commits' };
}

export type CommitFilesLiveContext = Readonly<CommitFilesHostContext & {
  currentOwner?: CommitFilesOwner;
  generation: number;
  selectedRowIdentity?: string;
  capability?: string;
}>;

export type CommitFilesLoadToken = Readonly<{
  liveRepo: string;
  commitHash: string;
  generation: number;
  selectionEpoch: number;
  filterText: string;
}>;

export type CommitFilesOperationToken = Readonly<{
  sessionId: string;
  generation: number;
  selectionEpoch: number;
  repoPath: string;
  commitHash: string;
  selectedRowIdentity: string;
  capability?: string;
}>;

export type CommitFilesPreviewToken = Readonly<CommitFilesOperationToken & { previewEpoch: number }>;
export type CommitFilesHunkToken = Readonly<CommitFilesOperationToken & { editorModeId: string }>;
export type CommitFilesRunGit = (args: string[], cwd: string) => Promise<string>;

export type CommitFilesControllerOptions = Readonly<{
  getContext: () => CommitFilesHostContext;
  runGit: CommitFilesRunGit;
  loadFiles: (hash: string, repoPath: string) => Promise<CommitFile[]>;
  treeOptions: TreeSortOptions | (() => TreeSortOptions);
  capabilityFactory?: (kind: 'session' | 'render') => string;
}>;

function defaultCapability(kind: 'session' | 'render'): string {
  return `lgvs-commit-files-${kind}-${crypto.randomBytes(24).toString('base64url')}`;
}

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }

function rowIdentity(row: CommitFilesSelectedRow | undefined): string | undefined {
  if (!row) return undefined;
  return row.kind === 'dir' ? `dir:${row.path}` : `file:${row.file.path}`;
}

export const commitFilesRowIdentity = rowIdentity;

function repoState(repoPath: string, runGit: CommitFilesRunGit): Promise<{ branchRef: string; head: string }> {
  return Promise.all([
    runGit(['rev-parse', '--symbolic-full-name', 'HEAD'], repoPath),
    runGit(['rev-parse', '--verify', 'HEAD^{commit}'], repoPath),
  ]).then(([branchRef, head]) => {
    const state = { branchRef: branchRef.trim(), head: head.trim() };
    if (!state.branchRef || !state.head) throw new Error('LazyGitVS: cannot capture the current Commit-files repository state.');
    return freeze(state);
  });
}

export async function isCommitFilesOwnerRepositoryCurrent(owner: CommitFilesOwner, runGit: CommitFilesRunGit): Promise<boolean> {
  try {
    const current = await repoState(owner.repoPath, runGit);
    return current.branchRef === owner.branchRef && current.head === owner.head;
  } catch {
    return false;
  }
}

export async function captureCommitFilesOwner(input: {
  repoPath: string;
  commitHash: string;
  generation: number;
  selectionEpoch: number;
  selectedRowIdentity: string;
  filterText?: string;
  runGit: CommitFilesRunGit;
}): Promise<CommitFilesOwner> {
  const state = await repoState(input.repoPath, input.runGit);
  return freeze({ ...state, repoPath: input.repoPath, commitHash: input.commitHash, generation: input.generation, selectionEpoch: input.selectionEpoch, selectedRowIdentity: input.selectedRowIdentity, filterText: input.filterText, sessionId: `captured-${input.generation}-${input.selectionEpoch}-${input.commitHash}` });
}

export function commitFilesOwnerWithRow(owner: CommitFilesOwner, selectionEpoch: number, row: CommitFilesSelectedRow): CommitFilesOwner {
  const selectedRowIdentity = rowIdentity(row);
  if (!selectedRowIdentity) throw new Error('LazyGitVS: Commit-files owner requires a selected row identity.');
  return freeze({ ...owner, selectionEpoch, selectedRowIdentity, capability: undefined });
}

export function commitFilesHostMessageAllowed(panel: string, context: CommitFilesLiveContext, capability = context.capability): boolean {
  return panel === 'commits' &&
    context.physicalPanel === 'commits' &&
    context.activeViewPanel === 'commits' &&
    !!context.currentOwner &&
    typeof capability === 'string' &&
    capability.length > 0 &&
    context.currentOwner.capability === capability &&
    context.capability === capability;
}

export function commitFilesOwnerIsCurrent(owner: CommitFilesOwner, context: CommitFilesLiveContext, requireActive = true): boolean {
  return !!context.currentOwner &&
    context.currentOwner === owner &&
    context.currentOwner.sessionId === owner.sessionId &&
    context.currentOwner.generation === owner.generation &&
    context.currentOwner.commitHash === owner.commitHash &&
    context.selectedCommitHash === owner.commitHash &&
    context.liveRepo === owner.repoPath &&
    context.generation === owner.generation &&
    context.selectionEpoch === owner.selectionEpoch &&
    context.selectedRowIdentity === owner.selectedRowIdentity &&
    (!requireActive || context.activeViewPanel === 'commits');
}

export function commitFilesOwnerSessionIsCurrent(owner: CommitFilesOwner, context: CommitFilesLiveContext, requireActive = true): boolean {
  return !!context.currentOwner &&
    context.currentOwner.sessionId === owner.sessionId &&
    context.currentOwner.generation === owner.generation &&
    context.currentOwner.commitHash === owner.commitHash &&
    context.selectedCommitHash === owner.commitHash &&
    context.liveRepo === owner.repoPath &&
    context.generation === owner.generation &&
    context.selectionEpoch === owner.selectionEpoch &&
    context.selectedRowIdentity === owner.selectedRowIdentity &&
    (!requireActive || context.activeViewPanel === 'commits');
}

export class CommitFilesController {
  private generationValue = 0;
  private serial = 0;
  private previewEpoch = 0;
  private editorModeSerial = 0;
  private pendingToken?: CommitFilesLoadToken;
  private ownerValue?: CommitFilesOwner;
  private commitValue?: Commit;
  private itemsValue: CommitFile[] = [];
  private selectedValue = 0;
  private collapsedDirsValue = new Set<string>();
  private readonly capabilityFactory: (kind: 'session' | 'render') => string;
  private readonly mutationTails = new Map<string, Promise<void>>();
  private readonly activationGate = new LatestWinsAsyncGate();

  constructor(readonly options: CommitFilesControllerOptions) {
    this.capabilityFactory = options.capabilityFactory ?? defaultCapability;
  }

  get active(): boolean { return !!this.ownerValue; }
  get owner(): CommitFilesOwner | undefined { return this.ownerValue; }
  get commit(): Commit | undefined { return this.commitValue; }
  get items(): readonly CommitFile[] { return this.itemsValue; }
  get selected(): number { return this.selectedValue; }
  get collapsedDirs(): ReadonlySet<string> { return this.collapsedDirsValue; }
  get generation(): number { return this.generationValue; }
  get pending(): CommitFilesLoadToken | undefined { return this.pendingToken; }

  private treeOptions(): TreeSortOptions {
    return typeof this.options.treeOptions === 'function' ? this.options.treeOptions() : this.options.treeOptions;
  }

  context(): CommitFilesLiveContext {
    const host = this.options.getContext();
    return {
      ...host,
      currentOwner: this.ownerValue,
      selectedCommitHash: this.commitValue?.hash ?? host.selectedCommitHash,
      selectedRowIdentity: this.currentRowIdentity(),
      filterText: this.ownerValue?.filterText ?? host.filterText,
      generation: this.generationValue,
      capability: this.ownerValue?.capability,
    };
  }

  rows(options = this.treeOptions()): commitFileCheckout.CommitFileTreeRow[] {
    const query = (this.ownerValue?.filterText ?? '').trim().toLocaleLowerCase();
    const items = query ? this.itemsValue.filter(file => `${file.status} ${file.oldPath ?? ''} ${file.path}`.toLocaleLowerCase().includes(query)) : this.itemsValue;
    return commitFileCheckout.projectCommitFileTreeRows(items, options, this.collapsedDirsValue);
  }

  currentRow(options = this.treeOptions()): commitFileCheckout.CommitFileTreeRow | undefined {
    return commitFileCheckout.selectedCommitFileTreeRow(this.rows(options), this.selectedValue);
  }

  currentFile(options = this.treeOptions()): CommitFile | undefined {
    return commitFileCheckout.selectedCommitFile(this.rows(options), this.selectedValue);
  }

  private currentRowIdentity(): string | undefined { return rowIdentity(this.currentRow()); }

  setSelected(index: number, selectionEpoch: number): void {
    const length = this.rows().length;
    this.selectedValue = length ? Math.max(0, Math.min(length - 1, index)) : 0;
    if (this.ownerValue) {
      this.invalidateTransient({ selectionEpoch, selectedRowIdentity: this.currentRowIdentity() });
    }
  }

  clampSelection(): void {
    const length = this.rows().length;
    this.selectedValue = length ? Math.max(0, Math.min(length - 1, this.selectedValue)) : 0;
  }

  toggleDirectory(selectionEpoch: number): boolean {
    const next = commitFileCheckout.toggledCommitFileCollapsedDirs(this.collapsedDirsValue, this.currentRow());
    if (!next) return false;
    this.collapsedDirsValue = next;
    this.selectedValue = Math.min(this.selectedValue, Math.max(0, this.rows().length - 1));
    if (this.ownerValue) this.invalidateTransient({ selectionEpoch, selectedRowIdentity: this.currentRowIdentity() });
    return true;
  }

  beginLoad(commitHash: string): CommitFilesLoadToken | undefined {
    const context = this.options.getContext();
    if (!context.liveRepo) return undefined;
    this.invalidate();
    const token = freeze({
      liveRepo: context.liveRepo,
      commitHash,
      generation: this.generationValue,
      selectionEpoch: context.selectionEpoch,
      filterText: context.filterText ?? '',
    });
    this.pendingToken = token;
    return token;
  }

  loadIsCurrent(token: CommitFilesLoadToken): boolean {
    const context = this.options.getContext();
    return this.pendingToken === token &&
      context.liveRepo === token.liveRepo &&
      context.selectedCommitHash === token.commitHash &&
      context.selectionEpoch === token.selectionEpoch &&
      (context.filterText ?? '') === token.filterText &&
      this.generationValue === token.generation &&
      context.activeViewPanel === 'commits';
  }

  async loadCommit(commit: Commit, activationCurrent: () => boolean = () => true): Promise<boolean> {
    const token = this.beginLoad(commit.hash);
    return !!token && await loadCommitFilesFor({ controller: this, token, commit, activationCurrent });
  }

  activateLoaded(token: CommitFilesLoadToken, commit: Commit, items: CommitFile[], state: { branchRef: string; head: string }): boolean {
    if (this.pendingToken !== token) return false;
    const rows = commitFileCheckout.projectCommitFileTreeRows(items, this.treeOptions(), this.collapsedDirsValue);
    const first = rows[0];
    if (!first) { this.pendingToken = undefined; return false; }
    this.pendingToken = undefined;
    this.commitValue = commit;
    this.itemsValue = items;
    this.selectedValue = 0;
    this.ownerValue = freeze({
      repoPath: token.liveRepo,
      branchRef: state.branchRef,
      head: state.head,
      commitHash: commit.hash,
      generation: token.generation,
      selectionEpoch: token.selectionEpoch,
      selectedRowIdentity: rowIdentity(first)!,
      filterText: token.filterText,
      sessionId: `session-${++this.serial}`,
      capability: this.capabilityFactory('session'),
    });
    this.previewEpoch += 1;
    this.editorModeSerial += 1;
    return true;
  }

  invalidate(): void {
    this.generationValue += 1;
    this.pendingToken = undefined;
    this.ownerValue = undefined;
    this.commitValue = undefined;
    this.itemsValue = [];
    this.selectedValue = 0;
    this.collapsedDirsValue.clear();
    this.previewEpoch += 1;
    this.editorModeSerial += 1;
  }

  invalidateTransient(input: { selectionEpoch: number; selectedRowIdentity?: string; filterText?: string }): void {
    this.generationValue += 1;
    this.pendingToken = undefined;
    this.previewEpoch += 1;
    this.editorModeSerial += 1;
    if (this.ownerValue) {
      this.ownerValue = freeze({
        ...this.ownerValue,
        generation: this.generationValue,
        selectionEpoch: input.selectionEpoch,
        selectedRowIdentity: input.selectedRowIdentity ?? this.ownerValue.selectedRowIdentity,
        filterText: input.filterText ?? this.ownerValue.filterText,
        capability: undefined,
      });
      if (input.filterText !== undefined) {
        this.clampSelection();
        this.ownerValue = freeze({ ...this.ownerValue, selectedRowIdentity: this.currentRowIdentity() ?? 'empty' });
      }
    }
  }

  capabilityForRender(): string | undefined {
    if (!this.ownerValue) return undefined;
    const capability = this.capabilityFactory('render');
    this.ownerValue = freeze({ ...this.ownerValue, capability });
    return capability;
  }

  ownerIsCurrent(owner = this.ownerValue, requireActive = true): boolean {
    return !!owner && commitFilesOwnerIsCurrent(owner, this.context(), requireActive);
  }

  sessionIsCurrent(owner = this.ownerValue, requireActive = true): boolean {
    return !!owner && commitFilesOwnerSessionIsCurrent(owner, this.context(), requireActive);
  }

  async revalidateOwner(owner = this.ownerValue): Promise<boolean> {
    return !!owner && this.sessionIsCurrent(owner) && await isCommitFilesOwnerRepositoryCurrent(owner, this.options.runGit) && this.sessionIsCurrent(owner);
  }

  operationToken(): CommitFilesOperationToken | undefined {
    const owner = this.ownerValue;
    if (!owner) return undefined;
    return freeze({ sessionId: owner.sessionId, generation: owner.generation, selectionEpoch: owner.selectionEpoch, repoPath: owner.repoPath, commitHash: owner.commitHash, selectedRowIdentity: owner.selectedRowIdentity, capability: owner.capability });
  }

  beginPreview(token = this.operationToken()): CommitFilesPreviewToken | undefined {
    return token ? freeze({ ...token, previewEpoch: ++this.previewEpoch }) : undefined;
  }

  private operationSessionIsCurrent(token: CommitFilesOperationToken, requireActive = true): boolean {
    const owner = this.ownerValue;
    const context = this.context();
    return !!owner &&
      owner.sessionId === token.sessionId &&
      owner.generation === token.generation &&
      owner.selectionEpoch === token.selectionEpoch &&
      owner.commitHash === token.commitHash &&
      context.liveRepo === token.repoPath &&
      context.selectedCommitHash === token.commitHash &&
      context.generation === token.generation &&
      context.selectionEpoch === token.selectionEpoch &&
      context.selectedRowIdentity === token.selectedRowIdentity &&
      (!requireActive || context.activeViewPanel === 'commits');
  }

  previewCurrent(token: CommitFilesPreviewToken): boolean {
    return token.previewEpoch === this.previewEpoch && this.operationSessionIsCurrent(token);
  }

  beginHunk(token = this.operationToken()): CommitFilesHunkToken | undefined {
    return token ? freeze({ ...token, editorModeId: `editor-${++this.editorModeSerial}` }) : undefined;
  }

  hunkCurrent(token: CommitFilesHunkToken): boolean {
    return this.editorModeSerial === Number(token.editorModeId.slice(7)) && this.operationSessionIsCurrent(token);
  }

  runActivation<T>(operation: (isCurrent: () => boolean) => Promise<T> | T): Promise<T | undefined> {
    return this.activationGate.request(operation);
  }

  async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const repoPath = this.ownerValue?.repoPath;
    if (!repoPath) throw new Error('LazyGitVS: no active Commit-files repository.');
    const previous = this.mutationTails.get(repoPath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.mutationTails.set(repoPath, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.mutationTails.get(repoPath) === current) this.mutationTails.delete(repoPath);
    }
  }

  checkoutCatalog(key: string, run: () => Promise<void>): GitMenuItem[] {
    return commitFileCheckout.commitFileCheckoutCatalog(this.commitValue?.hash, this.currentRow(), key, run);
  }

  async checkoutCurrent(input: { onSuccess?: () => Promise<void> } = {}): Promise<boolean> {
    const owner = this.ownerValue;
    if (!owner || !this.ownerIsCurrent(owner)) return false;
    const changed = await this.runMutation(() => commitFileCheckout.checkoutCommitFileTreeRow({
      repoPath: owner.repoPath,
      commitHash: owner.commitHash,
      row: this.currentRow(),
      runGit: this.options.runGit,
      isContextCurrent: () => this.revalidateOwner(owner),
      validateContext: () => this.revalidateOwner(owner),
      canMutate: () => this.ownerIsCurrent(owner),
    }));
    if (changed && this.sessionIsCurrent(owner)) await input.onSuccess?.();
    return changed;
  }

  async discardCurrent(input: {
    rangeMode: string;
    isLocalCommits: boolean;
    confirm: (title: string, prompt: string) => Promise<boolean>;
    onStart?: () => void;
    onSuccess?: () => Promise<void>;
    onOutcome?: (message: string) => Promise<void>;
    onError?: (error: Error) => Promise<void>;
    onFinally?: () => Promise<void>;
  }): Promise<void> {
    const owner = this.ownerValue;
    if (!owner || !this.ownerIsCurrent(owner)) return;
    try {
      const outcome = await this.runMutation(() => discardCommitFileChanges({
        repoPath: owner.repoPath,
        commitHash: owner.commitHash,
        commitFiles: [...this.itemsValue],
        row: this.currentRow(),
        rangeMode: input.rangeMode,
        isLocalCommits: input.isLocalCommits,
        confirm: input.confirm,
        onStart: input.onStart,
        isContextCurrent: () => this.revalidateOwner(owner),
        validateContext: () => this.revalidateOwner(owner),
        canMutate: () => this.ownerIsCurrent(owner),
      }));
      if (!this.sessionIsCurrent(owner)) return;
      if (outcome.kind === 'success') await input.onSuccess?.();
      else if (outcome.kind !== 'cancelled') await input.onOutcome?.(outcome.message);
    } catch (error) {
      if (this.sessionIsCurrent(owner)) await input.onError?.(error as Error);
    } finally {
      if (this.sessionIsCurrent(owner)) await input.onFinally?.();
    }
  }

  async copyCurrent(input: {
    gitConfig: LazyGitGitRuntimeConfig;
    copyText: CopyText;
    pickMenu: (title: string, items: GitMenuItem[]) => Promise<unknown>;
    restoreFocus?: () => Promise<void>;
  }): Promise<void> {
    const owner = this.ownerValue;
    if (!owner || !this.ownerIsCurrent(owner)) return;
    await commitFileClipboard.runCommitFileClipboardAction({
      commitHash: owner.commitHash,
      row: this.currentRow(),
      repoPath: owner.repoPath,
      gitConfig: input.gitConfig,
      runGit: this.options.runGit as GitRunner,
      copyText: input.copyText,
      isContextCurrent: () => this.revalidateOwner(owner),
      validateContext: () => this.revalidateOwner(owner),
      canPublish: () => this.ownerIsCurrent(owner),
    }, input.pickMenu, async () => {
      if (this.sessionIsCurrent(owner)) await input.restoreFocus?.();
    });
  }

  async enterHunk(file: CommitFile, input: {
    showArgs: (...args: string[]) => string[];
    useHunkModeInStagingView: boolean;
    applyHunkState: (patch: string, filePath: string) => void;
    setEditorHunkMode: (enabled: boolean, ownerId?: string, prepare?: () => void) => Promise<boolean>;
    clearHunkState?: () => void;
    render: () => void;
    showText: (title: string, content: string, preview: boolean, preserveFocus: boolean, isCurrent: () => boolean) => Promise<void>;
    forceEditorFocus: (isCurrent: () => boolean) => Promise<void>;
    revealEditorHunk: (isCurrent: () => boolean) => Promise<void>;
  }): Promise<void> {
    const owner = this.ownerValue;
    const selected = this.currentFile();
    const token = this.beginHunk();
    if (!owner || !selected || !token || selected.path !== file.path || !this.ownerIsCurrent(owner)) return;
    const hunkCurrent = () => this.hunkCurrent(token);
    await enterCommitFileHunkMode({
      owner,
      file,
      selectedFile: selected,
      hunkToken: token,
      isOwnerCurrent: () => this.sessionIsCurrent(owner),
      isHunkCurrent: hunkCurrent,
      revalidateOwner: () => this.revalidateOwner(owner),
      showArgs: input.showArgs,
      runGit: this.options.runGit,
      useHunkModeInStagingView: input.useHunkModeInStagingView,
      applyHunkState: input.applyHunkState,
      setEditorHunkMode: input.setEditorHunkMode,
      clearHunkState: input.clearHunkState,
      render: () => { if (hunkCurrent()) input.render(); },
      showText: async (title, content, preview, preserveFocus, isCurrent) => { if (hunkCurrent()) await input.showText(title, content, preview, preserveFocus, isCurrent); },
      forceEditorFocus: async isCurrent => { if (hunkCurrent()) await input.forceEditorFocus(isCurrent); },
      revealEditorHunk: async isCurrent => { if (hunkCurrent()) await input.revealEditorHunk(isCurrent); },
    });
  }
}

export async function loadCommitFilesFor(input: {
  controller: CommitFilesController;
  token: CommitFilesLoadToken;
  commit: Commit;
  activationCurrent?: () => boolean;
}): Promise<boolean> {
  const { controller, token, commit } = input;
  const activationCurrent = input.activationCurrent ?? (() => true);
  if (!activationCurrent() || !controller.loadIsCurrent(token)) return false;
  const state = await repoState(token.liveRepo, controller.options.runGit);
  if (!activationCurrent() || !controller.loadIsCurrent(token)) return false;
  const items = await controller.options.loadFiles(commit.hash, token.liveRepo);
  if (!activationCurrent() || !controller.loadIsCurrent(token)) return false;
  const finalState = await repoState(token.liveRepo, controller.options.runGit);
  if (!activationCurrent() || !controller.loadIsCurrent(token) || finalState.branchRef !== state.branchRef || finalState.head !== state.head) return false;
  return controller.activateLoaded(token, commit, items, finalState);
}

export { commitFileCheckout, commitFileClipboard };
export const COMMIT_FILE_RANGE_MESSAGE = commitFileCheckout.COMMIT_FILE_RANGE_MESSAGE;
export const canInspectSingleCommit = commitFileCheckout.canInspectSingleCommit;
export const readOnlyCommitFileHunkState = commitFileCheckout.readOnlyCommitFileHunkState;
export type { CommitFileTreeRow } from './commitFileCheckout';
