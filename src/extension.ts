import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { cloneGitConfig, cloneGuiConfig, cloneKeymap, readLazyGitConfig } from './lazygitConfig';
import { branches, changedFiles, commitFiles, commits, conflictsFromChangedFiles, discoverWorkspaceRepositories, getActiveWorkspaceRoot, git, remotes, setActiveWorkspaceRoot, stashes, stashFiles, tags, workspaceRoot, type Branch, type ChangedFile, type Commit, type CommitFile, type ConflictFile, type Remote, type Stash, type StashFile, type Tag, type WorkspaceRepository } from './gitService';
import { applyHunk, applyLine, discardUnstagedLine, gitDiffConfigArgs, hunksForFile, toggleStage, toggleStageAll, toggleStageSelected } from './gitActions';
import { normalizeWebviewMessage, scriptJson, webviewContentSecurityPolicy } from './webviewSecurity';
import { hunkBodyLines, hunkChangedEditorLine, hunkSelectableLineIndexes, hunkStartLine, type Hunk } from './hunkPatch';
import { EMPTY_PREVIEW_SCHEME, EmptyProvider, VIRTUAL_PREVIEW_SCHEME, VirtualPreviewProvider } from './previewDocuments';
import { FilePanelListModel, FocusArea, isPanel, isViewPanel, PANEL_ORDER, REFRESH_INTERVAL_MS, STATE_KEY, VIEW_IDS, type FileTreeRow, type Panel, type ViewPanel } from './panels';
import { RefreshCoordinator } from './refreshCoordinator';
import { activeDescendantId, branchRow, commitRow, dirRow, escapeHtml, fileRow, fileStateLabel, fileStatusHtml, row, treeFileRow } from './panelRows';
import { originCommitUrl, pickGitAction, runGitAction, executeGitMenuItem, showCommitCopyMenu, showCommitResetMenu, showDiscardFileMenu, showDiscardHunkMenu, showPullMenu, showPushMenu, showResetMenu, showResetToUpstreamMenu, showStashCreateMenu, type GitMenuItem } from './gitMenus';
import { findMenuItemByKey } from './lazygitMenu';
import { runBisectOptions, type BisectQuickPickItem } from './bisectOptions';
import { dangerousGitMenuItem } from './destructiveActions';
import { showGitOperationOptions } from './statusGitOperation';
import { appendIgnore, branchLogArgs, closeLazyGitVSPreviewTabsIfSingle, commitFlow, copyText, editPath, openPath, previewCommitFileDiff, previewDiff, previewStashFileDiff, reconcileCommitFilePreviewPublication, revealVisibleEditorLine, showCommitPreview, showStashPreview } from './workspaceActions';
import { deletedGhostDecorations, editorLineRange, excludeRangeLines, hunkChangedEditorRanges, rangeLineSet } from './hunkEditorDecorations';
import { planAndPerformReflogAction, type ReflogDirection } from './undoRedo';
import { panelBlockNavigationBindings } from './panelKeyboardRouter';
import { gutterBadge } from './gutterBadge'; import { LatestWinsAsyncGate } from './previewRequestGate';
import { COMMIT_FILE_RANGE_MESSAGE, CommitFilesController, canInspectSingleCommit, commitFilesFocusMessageAllowed, commitFilesHostMessageAllowed, commitFilesRowIdentity, createCommitFilesHostContext, isCommitFilesOwnerRepositoryCurrent, readOnlyCommitFileHunkState } from './commitFilesController';
import { EMPTY_COMMIT_RANGE, clampCommitRange, extendNonStickyCommitRange, findCommitIndexByHash, hasVisibleCopiedCommit, isCommitInRange, moveCommitSelection, pasteCopiedCommits as pasteCherryPickBuffer, resetCherryPickBuffer, toggleCopiedCommitRange, toggleStickyCommitRange, type CherryPickBuffer, type CommitRangeSelection } from './commitCherryPick'; import { dropSelectedCommits } from './commitDrop'; import { discardCommitFileChanges } from './commitFileDiscard'; import { FIXUP_MENU_ITEMS, FIXUP_MENU_TITLE, fixupSelectedCommits } from './commitFixup'; import { nativeCreateFixupCommitMenuItem } from './commitCreateFixupUi'; import { squashSelectedCommits } from './commitSquash';
import { chooseApplyFixupCommitsAction, commitAutosquashMenuItem } from './commitAutosquash'; import { commitEditMenuItem } from './commitEdit'; import { commitMoveMenuItem } from './commitMove'; import { commitRewordMenuItem } from './commitReword';
import { showChangedFilesQuickPick } from './changedFilesQuickPick';
import { recordDogfoodBoundary, repoChangeDescription, repoDescription, statusClass, statusIcon, statusRepositoryLabel } from './viewFormatting';
const virtualPreviewProvider = new VirtualPreviewProvider();
class PanelViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly app: LazyGitVSController, private readonly panel: ViewPanel) {} resolveWebviewView(view: vscode.WebviewView) { this.app.attach(this.panel, view); }
}
class StatusTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onChange.event;
  constructor(private readonly app: LazyGitVSController) {}
  refresh() { this.onChange.fire(); }
  dispose() { this.onChange.dispose(); }
  getTreeItem(item: vscode.TreeItem) { return item; }
  getChildren() { return this.app.statusTreeItems(); }
}
class LazyGitVSController {
  private views = new Map<ViewPanel, vscode.WebviewView>();
  private statusTree?: vscode.TreeView<vscode.TreeItem>;
  private statusTreeProvider?: StatusTreeProvider;
  private files: ChangedFile[] = [];
  private allHunks: Hunk[] = [];
  private hunks: Hunk[] = [];
  private branchItems: Branch[] = [];
  private tagItems: Tag[] = [];
  private remoteItems: Remote[] = [];
  private workspaceRepos: WorkspaceRepository[] = [];
  private commitItems: Commit[] = [];
  private readonly commitFilesController = new CommitFilesController({
    getContext: () => createCommitFilesHostContext(getActiveWorkspaceRoot() ?? undefined, this.currentCommit()?.hash, this.filterText, this.selectionEpoch, this.activeViewPanel()),
    runGit: (args, cwd) => git(args, cwd),
    loadFiles: (hash, repoPath) => commitFiles(hash, repoPath),
    treeOptions: () => this.lazygitGui,
  });
  private commitListForBranch: Branch | undefined;
  private cherryPickBuffer: CherryPickBuffer = resetCherryPickBuffer(); private commitRange: CommitRangeSelection = EMPTY_COMMIT_RANGE;
  private stashItems: Stash[] = [];
  private stashFileItems: StashFile[] = [];
  private stashFilesFor: Stash | undefined;
  private conflictItems: ConflictFile[] = [];
  private selected = 0;
  private fileRangeAnchor: number | undefined;
  private fileRangeSelected = new Set<number>();
  private collapsedFileDirs = new Set<string>();

  private hunkSelected = 0;
  private branchSelected = 0;
  private tagSelected = 0;
  private remoteSelected = 0;
  private commitSelected = 0;
  private stashSelected = 0;

  private stashFileSelected = 0;
  private conflictSelected = 0;
  private filterText = '';
  private fileStatusFilter: 'all' | 'staged' | 'unstaged' | 'tracked' | 'untracked' = 'all';
  private branchSortMode: 'default' | 'name' | 'recent' = 'default';
  private fileSortMode: 'config' | 'name' | 'status' = 'config';
  private activePanel: Panel = 'files';
  private previousPanel: Panel = 'files';
  private hunkSide: 'unstaged' | 'staged' = 'unstaged';
  private hunkSelectionMode: 'hunk' | 'line' = 'hunk';
  private hunkLineSelected = 0;
  private ownsModeStatus = false;
  private focusArea: FocusArea = 'none';
  private webviewKeyboardOwner = false;
  private editorHunkMode = false;
  private editorEditMode = false;
  private readOnlyHunkMode = false;
  private editorModeFilePath: string | undefined; private editorModeOwnerId: string | undefined; private readonly editorModeGate = new LatestWinsAsyncGate(); private readonly editorPublicationGate = new LatestWinsAsyncGate(); private readonly focusPublicationGate = new LatestWinsAsyncGate();
  private refreshTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  private pendingFilesPreviewTimer?: ReturnType<typeof setTimeout>; private filesPreviewEpoch = 0;
  private readonly refreshCoordinator = new RefreshCoordinator();
  private readonly filePanelListModel = new FilePanelListModel();
  private windowFocused = vscode.window.state.focused; private refreshDirtyWhileUnfocused = false;
  private selectionEpoch = 0;
  private explosion = false;
  private statusLine = '';
  private readonly unstagedHunkDecoration: vscode.TextEditorDecorationType;
  private readonly stagedHunkDecoration: vscode.TextEditorDecorationType;
  private readonly activeUnstagedHunkDecoration: vscode.TextEditorDecorationType;
  private readonly activeStagedHunkDecoration: vscode.TextEditorDecorationType;
  private readonly activeUnstagedLineDecoration: vscode.TextEditorDecorationType;
  private readonly activeStagedLineDecoration: vscode.TextEditorDecorationType;
  private readonly deletedGhostDecoration: vscode.TextEditorDecorationType;
  private readonly unstagedGutterDecoration: vscode.TextEditorDecorationType;
  private readonly stagedGutterDecoration: vscode.TextEditorDecorationType;
  private readonly modeStatusBarItem: vscode.StatusBarItem;
  private lazygitKeymap = cloneKeymap();
  private lazygitGui = cloneGuiConfig();
  private lazygitGit = cloneGitConfig();
  private lazygitConfigFiles: string[] = [];
  private suppressWebviewAutoFocusUntil = 0;
  private pendingWebviewAutoFocus = false;
  private pendingPanelFocusTransition?: { from: ViewPanel; to: ViewPanel }; private defaultPanelsRevealed = false;
  constructor(private readonly context: vscode.ExtensionContext) {

    this.unstagedHunkDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(210, 153, 34, 0.13)', borderWidth: '0 0 0 2px', borderStyle: 'solid', borderColor: '#d29922' });
    this.stagedHunkDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(46, 160, 67, 0.13)', borderWidth: '0 0 0 2px', borderStyle: 'solid', borderColor: '#2ea043' });
    this.activeUnstagedHunkDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(210, 153, 34, 0.22)', overviewRulerColor: '#d29922', overviewRulerLane: vscode.OverviewRulerLane.Right, borderWidth: '1px 1px 1px 4px', borderStyle: 'solid', borderColor: '#d29922' });
    this.activeStagedHunkDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(46, 160, 67, 0.22)', overviewRulerColor: '#2ea043', overviewRulerLane: vscode.OverviewRulerLane.Right, borderWidth: '1px 1px 1px 4px', borderStyle: 'solid', borderColor: '#2ea043' });
    this.activeUnstagedLineDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(210, 153, 34, 0.32)', border: '1px solid #d29922' });
    this.activeStagedLineDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(46, 160, 67, 0.30)', border: '1px solid #2ea043' });
    this.deletedGhostDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true });
    this.unstagedGutterDecoration = vscode.window.createTextEditorDecorationType({ gutterIconPath: gutterBadge('U', '#d29922'), gutterIconSize: 'contain' });
    this.stagedGutterDecoration = vscode.window.createTextEditorDecorationType({ gutterIconPath: gutterBadge('S', '#2ea043'), gutterIconSize: 'contain' });
    context.subscriptions.push(this.unstagedHunkDecoration, this.stagedHunkDecoration, this.activeUnstagedHunkDecoration, this.activeStagedHunkDecoration, this.activeUnstagedLineDecoration, this.activeStagedLineDecoration, this.deletedGhostDecoration, this.unstagedGutterDecoration, this.stagedGutterDecoration);
    this.modeStatusBarItem = vscode.window.createStatusBarItem('primary', vscode.StatusBarAlignment.Left, Number.MIN_SAFE_INTEGER);
    this.modeStatusBarItem.name = 'Vim Command Line';
    context.subscriptions.push(this.modeStatusBarItem);
    this.loadLazyGitConfig();
    this.restoreNavigationState();
    void this.updateActiveViewContext();
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    watcher.onDidChange(() => this.scheduleRefresh(), null, context.subscriptions);
    watcher.onDidCreate(() => this.scheduleRefresh(), null, context.subscriptions);
    watcher.onDidDelete(() => this.scheduleRefresh(), null, context.subscriptions);
    context.subscriptions.push(watcher);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('lazygitvs.showStatusBarMode')) this.updateModeStatusBar();
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => this.handleActiveTextEditorChanged(editor)));
    context.subscriptions.push(vscode.window.onDidChangeWindowState(state => this.handleWindowStateChanged(state)));
  }
  private async updateActiveViewContext() {
    const viewPanel = this.activeViewPanel();
    await Promise.all([
      vscode.commands.executeCommand('setContext', 'lazygitvs.activeView', viewPanel),
      vscode.commands.executeCommand('setContext', 'lazygitvs.statusViewVisible', viewPanel === 'status')
    ]);
  }
  attach(panel: ViewPanel, view: vscode.WebviewView) {
    this.views.set(panel, view);
    view.webview.options = { enableScripts: true };
    view.onDidChangeVisibility(() => { if (view.visible) this.scheduleRefresh(0); else if (!this.visible()) this.clearRuntimeTimers(); }, null, this.context.subscriptions);
    view.webview.onDidReceiveMessage(async rawMessage => {
      try {
        const message = normalizeWebviewMessage(rawMessage);
        if (!message) return;
        const type = message.type;
        const requestedCapability = typeof message.capability === 'string' ? message.capability : undefined;
        const commitFilesRequestAllowed = () => commitFilesHostMessageAllowed(panel, { ...this.commitFilesController.context(), capability: requestedCapability }, requestedCapability); const commitFilesFocusRequestAllowed = () => commitFilesFocusMessageAllowed(panel, { ...this.commitFilesController.context(), capability: requestedCapability }, requestedCapability);
        if (!this.commitFilesController.active && requestedCapability) return;
        if (this.commitFilesController.active && panel === 'commits' && !(type === 'focusArea' ? commitFilesFocusRequestAllowed() : commitFilesRequestAllowed())) return;
        if (['checkoutCommitFile', 'discardCommitFile', 'copyCommitFileInfo'].includes(type) && !commitFilesRequestAllowed()) return;
        if (type === 'dogfoodBoundary') recordDogfoodBoundary(String(message.event ?? 'unknown'), { panel, key: String(message.key ?? '') });
        if (type === 'focusArea') { if (message.area === 'panel' && this.activeViewPanel() !== panel) { const previousViewPanel = this.activeViewPanel(); this.ownsModeStatus = true; this.webviewKeyboardOwner = true; this.activePanel = panel; this.setFocusArea('panel'); void vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', true); void this.updateActiveViewContext(); this.persistNavigationState(); if (previousViewPanel !== panel) this.render(previousViewPanel); } else this.setFocusArea(message.area === 'panel' ? 'panel' : 'none'); const transition = this.pendingPanelFocusTransition; if (message.area === 'panel' && transition?.to === panel) { recordDogfoodBoundary('panelFocus', { ...transition, activeView: this.activeViewPanel() }); this.pendingPanelFocusTransition = undefined; } }
        if (type === 'commandPalette') await this.openCommandPalette();
        if (type === 'move') await this.move(panel, message.delta);
        if (type === 'moveTo') await this.moveTo(panel, message.position);
        if (type === 'rangeToggle') await this.toggleRange(panel);
        if (type === 'rangeMove') await this.rangeMove(panel, message.delta);
        if (type === 'select') await this.select(panel, Number(message.index)); if (type === 'activateRow') await this.activateRow(panel, Number(message.index), requestedCapability);
        if (type === 'switchPanel') { if (this.webviewKeyboardOwner && this.focusArea === 'panel' && this.ownsModeStatus && !this.editorHunkMode && !this.editorEditMode) await this.focusPanel(message.panel); return; }
        if (type === 'toggle') await this.toggle(panel);
        if (type === 'enter') await this.enter(panel);
        if (type === 'openDiff') await this.openCurrent(panel, false);
        if (type === 'openFile') await this.editCurrent(panel);
        if (type === 'editFile') await this.editCurrent(panel);
        if (type === 'copyPath') await this.copyCurrentPath(panel);
        if (type === 'copyInfo') await this.copyCurrentInfo(panel);
        if (type === 'ignoreMenu') await this.ignoreCurrentFile();
        if (type === 'fetch') await this.fetch();
        if (type === 'statusMenu') await this.statusMenu();
        if (type === 'repoMenu') await this.recentReposMenu();
        if (type === 'operationOptions') await this.openOperationOptions();
        if (type === 'helpMenu') await this.helpMenu(panel);
        if (type === 'reflogUndo') recordDogfoodBoundary('reflogUndo:handler', { panel, root: getActiveWorkspaceRoot() });
        if (type === 'reflogUndo') await this.reflogUndo();
        if (type === 'reflogRedo') await this.reflogRedo();
        if (type === 'commitAction') await this.runCommitCommand(String(message.key ?? ''));
        if (type === 'checkoutCommitFile' && commitFilesHostMessageAllowed(panel, this.commitFilesController.context())) await this.checkoutCurrentCommitFile(); if (type === 'discardCommitFile' && commitFilesHostMessageAllowed(panel, this.commitFilesController.context())) await this.discardCurrentCommitFile(); if (type === 'copyCommitFileInfo' && commitFilesHostMessageAllowed(panel, this.commitFilesController.context())) await this.copyCurrentCommitFileInfo();
        if (type === 'panelAction') await this.runPanelCommand(panel, String(message.key ?? ''));
        if (type === 'moveBlock') await this.moveBlock(panel, message.delta);
        if (type === 'focusMainView') await this.focusMainView(panel);
        if (type === 'stageAll') await this.stageAll();
        if (type === 'commit') await this.commit();
        if (type === 'commitNoVerify') await this.commit('noVerify');
        if (type === 'amendLastCommit') await this.commit('amendNoEdit');
        if (type === 'commitWithEditor') await this.commit('body');
        if (type === 'push') await this.push();
        if (type === 'pull') await this.pull();
        if (type === 'pushMenu') await this.runMenu(showPushMenu, panel);
        if (type === 'pullMenu') await this.runMenu(showPullMenu, panel);
        if (type === 'stashAll') await this.stashAll();
        if (type === 'stashMenu') await this.runMenu(showStashCreateMenu, panel);
        if (type === 'discardMenu') await this.discardMenu(panel);
        if (type === 'resetMenu') await this.runMenu(() => showResetMenu(() => this.animateExplosion()), panel); if (type === 'resetToUpstreamMenu') await this.resetToUpstreamMenu(panel);
        if (type === 'search') await this.searchPanel();
        if (type === 'clearFilter') await this.clearFilterOrBack(panel);
        if (type === 'statusFilter') await this.statusFilterMenu();
        if (type === 'diffingMenu') await this.diffingMenu();
        if (type === 'refresh') await this.refresh(true);
        if (type === 'close') await this.close();
        if (type === 'back') await this.back(panel);
        if (type === 'togglePanel') await this.toggleHunkPanel();
        if (type === 'toggleHunkSelection') this.showPendingLineMode();
      } catch (e: any) { vscode.window.showErrorMessage(e.message); }
    }, null, this.context.subscriptions);
    if (!this.intervalTimer) {
      this.ensureRuntimeInterval();
    }
    this.render(panel);
    this.scheduleRefresh(0);
  }
  attachStatusTree(provider: StatusTreeProvider, tree: vscode.TreeView<vscode.TreeItem>) {
    this.statusTreeProvider = provider;
    this.statusTree = tree;
    tree.onDidChangeVisibility(() => { if (tree.visible) this.scheduleRefresh(0); else if (!this.visible()) this.clearRuntimeTimers(); }, null, this.context.subscriptions);
    provider.refresh();
  }
  statusTreeItems(): vscode.TreeItem[] {
    const repos = this.workspaceRepos;
    if (!repos.length) {
      const item = new vscode.TreeItem('Select repository', vscode.TreeItemCollapsibleState.None);
      item.tooltip = 'Enter: discover and switch to a workspace repository';
      item.command = { command: 'lazygitvs.statusEnter', title: 'Switch to workspace repository' };
      item.contextValue = 'lazygitvs.statusRepo';
      return [item];
    }
    const current = getActiveWorkspaceRoot();
    return repos.map(repo => {
      const isCurrent = repo.path === current;
      const item = new vscode.TreeItem(statusRepositoryLabel(repo), vscode.TreeItemCollapsibleState.None);
      item.id = repo.path;
      item.description = repoDescription(repo, isCurrent);
      item.tooltip = repo.path;
      if (isCurrent) item.iconPath = new vscode.ThemeIcon('check');
      item.command = { command: 'lazygitvs.statusEnter', title: 'Select repository', arguments: [repo.path] };
      item.contextValue = isCurrent ? 'lazygitvs.statusRepo.current' : 'lazygitvs.statusRepo';
      return item;
    });
  }
  openRecentRepos() { return this.recentReposMenu(); }
  async statusEnter(target?: string | { repoPath?: string; operationOptions?: boolean }) {
    if (typeof target === 'object' && target.operationOptions) return this.openOperationOptions(target);
    const repoPath = typeof target === 'string' ? target : target?.repoPath;
    const selected = this.statusTree?.selection?.[0];
    const selectedRepoPath = repoPath ?? (typeof selected?.id === 'string' ? selected.id : undefined);
    const selectedRepo = this.workspaceRepos.find(repo => repo.path === selectedRepoPath);
    if (selectedRepoPath && selectedRepoPath === getActiveWorkspaceRoot() && selectedRepo?.operation) return this.openOperationOptions(selectedRepoPath);
    if (selectedRepoPath) return this.selectRepository(selectedRepoPath);
    return this.recentReposMenu();
  }
  async openOperationOptions(target?: string | { repoPath?: string }) {
    // Status acts on its highlighted repository. Other panels act only on the
    // explicitly active repository, never the first folder in a multi-repo UI.
    const selected = this.activeViewPanel() === 'status' ? this.statusTree?.selection?.[0] : undefined;
    const explicitRepoPath = typeof target === 'string' ? target : target?.repoPath;
    const repoPath = explicitRepoPath ?? (typeof selected?.id === 'string' ? selected.id : getActiveWorkspaceRoot());
    if (!repoPath) return;
    const isAvailable = () => fs.existsSync(repoPath);
    if (!isAvailable()) return;
    await showGitOperationOptions(repoPath, isAvailable, () => this.refresh(true));
  }
  async enterSelected() {
    if (this.editorHunkMode || this.editorEditMode) return;
    const panel = this.activeViewPanel();
    if (panel === 'status') return this.statusEnter();
    this.ownsModeStatus = true;
    this.webviewKeyboardOwner = true;
    this.setFocusArea('panel');
    void vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', true);
    return this.enter(panel);
  }
  async enterCurrentFileHunkMode() {
    if (this.editorHunkMode || this.editorEditMode) return;
    this.activePanel = 'files';
    this.ownsModeStatus = false;
    this.webviewKeyboardOwner = false;
    this.setFocusArea('viewer');
    void vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', false);
    return this.enterHunks();
  }
  private loadLazyGitConfig() {
    const config = readLazyGitConfig();
    this.lazygitKeymap = config.keymap;
    this.lazygitGui = config.gui;
    this.lazygitGit = config.git;
    this.lazygitConfigFiles = config.files;
  }
  private restoreNavigationState() {
    const state = this.context.workspaceState.get<Partial<Record<string, unknown>>>(STATE_KEY, {});
    const panel = state.activePanel;
    if (isPanel(panel)) this.activePanel = panel;
    const previousPanel = state.previousPanel;
    if (isViewPanel(previousPanel)) this.previousPanel = previousPanel;
    this.selected = typeof state.selected === 'number' ? state.selected : this.selected;
    this.hunkSelected = typeof state.hunkSelected === 'number' ? state.hunkSelected : this.hunkSelected;
    this.branchSelected = typeof state.branchSelected === 'number' ? state.branchSelected : this.branchSelected;
    this.tagSelected = typeof state.tagSelected === 'number' ? state.tagSelected : this.tagSelected;
    this.remoteSelected = typeof state.remoteSelected === 'number' ? state.remoteSelected : this.remoteSelected;
    this.commitSelected = typeof state.commitSelected === 'number' ? state.commitSelected : this.commitSelected;
    this.stashSelected = typeof state.stashSelected === 'number' ? state.stashSelected : this.stashSelected;
    this.conflictSelected = typeof state.conflictSelected === 'number' ? state.conflictSelected : this.conflictSelected;
    this.filterText = typeof state.filterText === 'string' ? state.filterText : this.filterText;
    const fileStatusFilter = state.fileStatusFilter;
    if (fileStatusFilter === 'all' || fileStatusFilter === 'staged' || fileStatusFilter === 'unstaged' || fileStatusFilter === 'tracked' || fileStatusFilter === 'untracked') this.fileStatusFilter = fileStatusFilter;
    if (state.hunkSide === 'staged' || state.hunkSide === 'unstaged') this.hunkSide = state.hunkSide;
    if (state.hunkSelectionMode === 'hunk' || state.hunkSelectionMode === 'line') this.hunkSelectionMode = state.hunkSelectionMode;
  }
  private persistNavigationState() {
    void this.context.workspaceState.update(STATE_KEY, {
      activePanel: this.activePanel,
      previousPanel: this.previousPanel,
      selected: this.selected,
      hunkSelected: this.hunkSelected,
      branchSelected: this.branchSelected,
      tagSelected: this.tagSelected,
      remoteSelected: this.remoteSelected,
      commitSelected: this.commitSelected,
      stashSelected: this.stashSelected,
      conflictSelected: this.conflictSelected,
      filterText: this.filterText,
      fileStatusFilter: this.fileStatusFilter,
      hunkSide: this.hunkSide,
      hunkSelectionMode: this.hunkSelectionMode
    });
  }
  async focus() {
    this.loadLazyGitConfig();
    await this.revealDefaultOpenPanels();
    return this.focusPanel(this.activeViewPanel());
  }
  private async revealDefaultOpenPanels() {
    if (this.defaultPanelsRevealed) return;
    this.defaultPanelsRevealed = true;
    for (const panel of PANEL_ORDER.filter((panel): panel is ViewPanel => panel !== 'status')) {
      await this.revealPanelView(panel).catch(() => undefined);
    }
  }
  async focusNumberPanel(index: number) {
    const panel = PANEL_ORDER[index - 1];
    if (!panel) return;
    if (this.editorHunkMode || this.editorEditMode) await this.setEditorHunkMode(false);
    await this.focusPanel(panel);
  }
  async close() {
    await this.setEditorHunkMode(false);
    void vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', false);
    this.ownsModeStatus = false;
    this.setFocusArea('none');
    this.statusLine = '';
    this.activePanel = this.activeViewPanel();
    this.updateModeStatusBar();
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
  }
  async resetState() {
    this.clearRuntimeTimers();
    await this.releaseEditorOwnership();
    await vscode.commands.executeCommand('setContext', 'lazygitvs.panelFocus', false);
    await vscode.commands.executeCommand('setContext', 'lazygitvs.viewerFocus', false);
    await vscode.commands.executeCommand('setContext', 'lazygitvs.focusArea', 'none');
    this.activePanel = 'files';
    this.previousPanel = 'files';
    this.hunkSide = 'unstaged';
    this.hunkSelectionMode = 'hunk';
    this.hunkSelected = 0;
    this.hunkLineSelected = 0;
    this.fileRangeSelected.clear(); this.commitRange = EMPTY_COMMIT_RANGE; this.cherryPickBuffer = resetCherryPickBuffer();
    this.pendingWebviewAutoFocus = false;
    this.suppressWebviewAutoFocusUntil = Date.now() + 2500;
    this.selectionEpoch++;
    this.persistNavigationState();
    this.renderAll();
    vscode.window.showInformationMessage('LazyGitVS: state reset.');
  }
  private healthSnapshot() {
    return {
      activePanel: this.activePanel,
      activeViewPanel: this.activeViewPanel(),
      previousPanel: this.previousPanel,
      focusArea: this.focusArea,
      ownsModeStatus: this.ownsModeStatus,
      webviewKeyboardOwner: this.webviewKeyboardOwner,
      editorHunkMode: this.editorHunkMode,
      editorEditMode: this.editorEditMode,
      readOnlyHunkMode: this.readOnlyHunkMode,
      hunkSide: this.hunkSide,
      hunkSelectionMode: this.hunkSelectionMode,
      selections: {
        files: this.selected,
        hunks: this.hunkSelected,
        hunkLine: this.hunkLineSelected,
        branches: this.branchSelected,
        commits: this.commitSelected,
        stash: this.stashSelected,
        conflicts: this.conflictSelected,
        tags: this.tagSelected,
        remotes: this.remoteSelected
      },
      counts: {
        views: this.views.size,
        workspaceRepos: this.workspaceRepos.length,
        files: this.files.length,
        hunks: this.hunks.length,
        allHunks: this.allHunks.length,
        branches: this.branchItems.length,
        commits: this.commitItems.length,
        stash: this.stashItems.length,
        conflicts: this.conflictItems.length,
        tags: this.tagItems.length,
        remotes: this.remoteItems.length
      },
      timers: {
        refreshTimerActive: Boolean(this.refreshTimer),
        intervalTimerActive: Boolean(this.intervalTimer),
        refreshInFlight: this.refreshCoordinator.isInFlight, refreshPending: this.refreshCoordinator.hasPending,
        windowFocused: this.windowFocused, refreshDirtyWhileUnfocused: this.refreshDirtyWhileUnfocused
      },
      webviewAutofocus: {
        pending: this.pendingWebviewAutoFocus,
        suppressUntil: this.suppressWebviewAutoFocusUntil,
        suppressActive: Date.now() < this.suppressWebviewAutoFocusUntil
      },
      config: {
        files: this.lazygitConfigFiles,
        showStatusBarMode: vscode.workspace.getConfiguration('lazygitvs').get<boolean>('showStatusBarMode', false),
        previewTabs: vscode.workspace.getConfiguration('lazygitvs').get<string>('previewTabs', 'single')
      },
      workspace: {
        root: workspaceRoot(),
        activeRoot: getActiveWorkspaceRoot()
      }
    };
  }
  async dumpHealth() {
    const snapshot = this.healthSnapshot();
    await showText('LazyGitVS Health', JSON.stringify(snapshot, null, 2), false, true);
  }
  private async focusPanel(panel: ViewPanel, transition?: { from: ViewPanel; to: ViewPanel }) {
    const previousViewPanel = this.activeViewPanel();
    this.ownsModeStatus = true;
    this.webviewKeyboardOwner = true;
    this.setFocusArea('panel');
    void vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', true);
    this.activePanel = panel;
    await this.updateActiveViewContext();
    this.requestWebviewAutoFocus();
    this.persistNavigationState();
    this.updateModeStatusBar();
    if (panel === 'status' || this.activeLength(panel) === 0) await this.refresh(false).catch(() => undefined);
    this.renderFocusedPanels(previousViewPanel, panel);
    await this.revealPanelView(panel);
    if (panel === 'status') await this.revealCurrentStatusRepo().catch(() => undefined);
    this.ensureRuntimeInterval();
    await this.openCurrent(panel, true).catch(() => undefined);
    this.requestWebviewAutoFocus();
    this.renderActivePanel(panel);
    await this.revealPanelView(panel);
    if (panel === 'status') await this.revealCurrentStatusRepo().catch(() => undefined);
    if (transition) this.pendingPanelFocusTransition = transition;
    await new Promise(resolve => setTimeout(resolve, 50)); await this.views.get(panel)?.webview.postMessage({ type: 'focusBody' });
  }
  private async restorePanelFocusAfterModal(viewPanel: ViewPanel, shouldContinue: () => boolean = () => true) {
    await this.focusPublicationGate.request(async isCurrent => {
      if (this.editorHunkMode || this.editorEditMode || !shouldContinue() || !isCurrent()) return;
      this.ownsModeStatus = true; this.webviewKeyboardOwner = true; this.activePanel = this.panelForView(viewPanel); await this.updateActiveViewContext();
      if (!isCurrent() || !shouldContinue()) return;
      this.setFocusArea('panel'); void vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', true); this.requestWebviewAutoFocus(); this.persistNavigationState(); this.updateModeStatusBar(); this.setWebviewKeyboardEnabled(true); this.renderAll(); await this.revealPanelView(this.activeViewPanel());
      if (!isCurrent() || !shouldContinue()) return;
      this.requestWebviewAutoFocus(); this.setWebviewKeyboardEnabled(true); this.renderAll();
    });
  }
  private async revealPanelView(panel: ViewPanel) {
    const viewId = VIEW_IDS[panel];
    const reveal = async () => {
      if (!this.visible()) {
        try { await vscode.commands.executeCommand('workbench.view.scm'); } catch { /* ignore */ }
      }
      try { this.views.get(panel)?.show(false); } catch { /* ignore */ }
      try { await vscode.commands.executeCommand(`${viewId}.focus`, { preserveFocus: false }); } catch { /* ignore */ }
    };
    await reveal();
  }
  private async revealCurrentStatusRepo() {
    this.statusTreeProvider?.refresh();
    const items = this.statusTreeItems();
    const item = items.find(item => item.id === getActiveWorkspaceRoot()) ?? items[0];
    if (item) await this.statusTree?.reveal(item, { select: true, focus: true }).then(undefined, () => undefined);
  }
  private requestWebviewAutoFocus() {
    this.pendingWebviewAutoFocus = true;
    this.suppressWebviewAutoFocusUntil = 0;
  }
  private consumeWebviewAutoFocus(viewPanel: ViewPanel): boolean {
    if (!this.pendingWebviewAutoFocus) return false;
    if (this.activeViewPanel() !== viewPanel) return false;
    if (this.editorHunkMode || this.editorEditMode) return false;
    if (Date.now() <= this.suppressWebviewAutoFocusUntil) return false;
    this.pendingWebviewAutoFocus = false;
    return true;
  }
  private async openCommandPalette() {
    this.pendingWebviewAutoFocus = false;
    this.suppressWebviewAutoFocusUntil = Date.now() + 2500;
    this.setFocusArea('none');
    await vscode.commands.executeCommand('workbench.action.quickOpen', '>');
  }
  private visible() { return Array.from(this.views.values()).some(view => view.visible) || !!this.statusTree?.visible; }
  private ensureRuntimeInterval() {
    if (!this.windowFocused || !this.visible()) return;
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => this.scheduleRefresh(0), REFRESH_INTERVAL_MS);
    this.context.subscriptions.push({ dispose: () => { if (this.intervalTimer) clearInterval(this.intervalTimer); } });
  }
  private clearRuntimeTimers() { if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = undefined; } if (this.intervalTimer) { clearInterval(this.intervalTimer); this.intervalTimer = undefined; } this.cancelFilesPreview(); }
  private scheduleRefresh(delayMs = 250) { if (!this.visible()) { this.clearRuntimeTimers(); return; } this.updateModeStatusBar(); if (!this.windowFocused) { this.refreshDirtyWhileUnfocused = true; return; } if (this.refreshTimer) clearTimeout(this.refreshTimer); this.refreshTimer = setTimeout(() => this.refresh(false).catch(err => vscode.window.showErrorMessage(err.message)), delayMs); }
  private handleWindowStateChanged(state: vscode.WindowState) {
    this.windowFocused = state.focused;
    if (!state.focused) { this.clearRuntimeTimers(); return; }
    if (this.visible()) { this.ensureRuntimeInterval(); this.refreshDirtyWhileUnfocused = false; this.scheduleRefresh(0); }
  }
  private cancelFilesPreview() { if (this.pendingFilesPreviewTimer) clearTimeout(this.pendingFilesPreviewTimer); this.pendingFilesPreviewTimer = undefined; this.filesPreviewEpoch++; }
  private scheduleFilesPreview(viewPanel: ViewPanel) { if (this.pendingFilesPreviewTimer) clearTimeout(this.pendingFilesPreviewTimer); const epoch = ++this.filesPreviewEpoch; const filePath = this.currentFile()?.path; this.pendingFilesPreviewTimer = setTimeout(() => { this.pendingFilesPreviewTimer = undefined; if (epoch !== this.filesPreviewEpoch) return; void this.openCurrent(viewPanel, true, true, { epoch, filePath }).catch(() => undefined); }, 180); }
  private async setEditorHunkMode(active: boolean, ownerId?: string, prepare?: () => void): Promise<boolean> {
    const applied = await this.editorModeGate.request(async isCurrent => {
      if (active) { if (ownerId && this.editorModeOwnerId && this.editorModeOwnerId !== ownerId && !this.editorModeOwnerId.startsWith('editor-')) return false; this.editorModeOwnerId = ownerId; this.webviewKeyboardOwner = false; prepare?.(); }
      else { if (ownerId && this.editorModeOwnerId !== ownerId) return false; this.editorModeOwnerId = undefined; }
      this.setWebviewKeyboardEnabled(!active && this.ownsModeStatus && this.webviewKeyboardOwner); this.editorHunkMode = active;
      if (!active) { this.editorEditMode = false; this.readOnlyHunkMode = false; this.editorModeFilePath = undefined; }
      this.setFocusArea(active ? 'editor-hunk' : this.ownsModeStatus ? 'panel' : 'viewer');
      for (const [key, value] of [['lazygitvs.editorHunkMode', active], ['lazygitvs.editorEditMode', false], ['vim.active', active ? false : true] ] as const) { await vscode.commands.executeCommand('setContext', key, value); if (!isCurrent()) return; }
      if (!active) this.clearEditorHunkDecorations(); else this.updateEditorHunkDecorations(); this.updateModeStatusBar(); return true;
    });
    return applied === true;
  }
  private setWebviewKeyboardEnabled(enabled: boolean) {
    for (const view of this.views.values()) void view.webview.postMessage({ type: 'keyboardEnabled', enabled });
  }
  private isLGVSOwnedEditor(editor: vscode.TextEditor | undefined): boolean {
    if (!editor) return false;
    const uri = editor.document.uri;
    if (uri.scheme === VIRTUAL_PREVIEW_SCHEME || uri.scheme === EMPTY_PREVIEW_SCHEME) return true;
    const ownedPath = this.editorModeFilePath ?? (this.focusArea === 'viewer' ? this.currentFilePath(this.activeViewPanel()) : undefined);
    return !!ownedPath && uri.scheme === 'file' && uri.fsPath === path.join(workspaceRoot(), ownedPath);
  }
  private handleActiveTextEditorChanged(editor: vscode.TextEditor | undefined) {
    if (!editor) {
      if (this.focusArea === 'viewer' || this.editorEditMode) void this.releaseEditorOwnership();
      else this.updateModeStatusBar();
      return;
    }
    if ((this.editorHunkMode || this.focusArea === 'viewer' || this.editorEditMode) && !this.isLGVSOwnedEditor(editor)) {
      void this.releaseEditorOwnership();
      return;
    }
    this.updateEditorHunkDecorations();
    this.updateModeStatusBar();
  }
  private async releaseEditorOwnership() {
    const ownerId = this.editorModeOwnerId;
    if (!await this.setEditorHunkMode(false, ownerId) && ownerId) return;
    this.setWebviewKeyboardEnabled(false);
    this.editorHunkMode = false;
    this.editorEditMode = false;
    this.readOnlyHunkMode = false;
    this.editorModeFilePath = undefined;
    this.editorModeOwnerId = undefined;
    this.statusLine = '';
    this.ownsModeStatus = false;
    this.webviewKeyboardOwner = false;
    this.setFocusArea('none');
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorHunkMode', false);
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorEditMode', false);
    await vscode.commands.executeCommand('setContext', 'lazygitvs.keyboardMode', false);
    await vscode.commands.executeCommand('setContext', 'vim.active', true);
    this.clearEditorHunkDecorations();
    this.modeStatusBarItem.hide();
    this.suppressWebviewAutoFocusUntil = Date.now() + 2500;
  }
  private setFocusArea(area: FocusArea) {
    this.focusArea = area;
    void vscode.commands.executeCommand('setContext', 'lazygitvs.panelFocus', area === 'panel');
    void vscode.commands.executeCommand('setContext', 'lazygitvs.viewerFocus', area === 'viewer');
    void vscode.commands.executeCommand('setContext', 'lazygitvs.focusArea', area);
    this.updateModeStatusBar();
  }
  private focusLabel(): string {
    if (this.focusArea === 'panel') return 'LG';
    if (this.focusArea === 'viewer') return 'VIEW';
    if (this.focusArea === 'editor-hunk') return 'HUNK';
    if (this.focusArea === 'editor-edit') return 'EDIT';
    return '—';
  }
  private focusHint(): string {
    if (this.focusArea === 'panel') return 'Focus: LG panel';
    if (this.focusArea === 'viewer') return 'Focus: file viewer · editor keys belong to VS Code/Vim';
    if (this.focusArea === 'editor-hunk') return 'Focus: editor HUNK/LINE · Esc returns to LGVS Files';
    if (this.focusArea === 'editor-edit') return 'Focus: file editor · VS Code/Vim owns keys';
    return 'Focus: outside LGVS';
  }
  private updateModeStatusBar() {
    const showConfigured = vscode.workspace.getConfiguration('lazygitvs').get<boolean>('showStatusBarMode', false);
    if (!showConfigured && !this.editorHunkMode && this.focusArea === 'none') { this.modeStatusBarItem.hide(); return; }
    const h = this.hunks[this.hunkSelected];
    const changed = h ? hunkSelectableLineIndexes(h) : [];
    const side = this.hunkSide === 'staged' ? 'S' : 'U';
    const mode = this.editorEditMode ? 'EDIT' : this.editorHunkMode ? `${this.hunkSelectionMode.toUpperCase()} ${side} ${this.hunkSelectionMode === 'line' ? `${Math.min(this.hunkLineSelected + 1, Math.max(1, changed.length))}/${Math.max(1, changed.length)} in ` : ''}${Math.min(this.hunkSelected + 1, Math.max(1, this.hunks.length))}/${Math.max(1, this.hunks.length)}` : `${this.activePanel.toUpperCase()} · ${this.focusLabel()}`;
    this.modeStatusBarItem.text = `-- ${mode} --`;
    this.modeStatusBarItem.tooltip = this.editorHunkMode ? this.focusHint() : `LazyGitVS mode · ${this.focusHint()}`;
    if ((this.visible() && (this.ownsModeStatus || this.focusArea === 'viewer' || this.focusArea === 'panel')) || this.editorHunkMode || this.editorEditMode) this.modeStatusBarItem.show(); else this.modeStatusBarItem.hide();
  }
  private async refresh(updatePreview: boolean) {
    await this.refreshCoordinator.request(updatePreview, async refreshPreview => {
      const refreshSelectionEpoch = this.selectionEpoch;
      const refreshPanel = this.activePanel;
      const refreshEditorMode = this.editorHunkMode || this.editorEditMode;
      const previousPath = this.currentFile()?.path;
      this.workspaceRepos = await discoverWorkspaceRepositories().catch(() => []);
      const liveRootAfterDiscovery = getActiveWorkspaceRoot(), sessionOwner = this.commitFilesController.owner, pendingLoad = this.commitFilesController.pending;
      if ((sessionOwner && (!liveRootAfterDiscovery || liveRootAfterDiscovery !== sessionOwner.repoPath || !fs.existsSync(sessionOwner.repoPath))) || (pendingLoad && liveRootAfterDiscovery !== pendingLoad.liveRepo)) await this.resetCommitFilesState(false);
      else if (sessionOwner && !await isCommitFilesOwnerRepositoryCurrent(sessionOwner, (args, cwd) => git(args, cwd))) await this.resetCommitFilesState(false);
      if (this.workspaceRepos.length > 1 && !getActiveWorkspaceRoot()) {
        this.files = []; this.branchItems = []; this.tagItems = []; this.remoteItems = [];
        this.commitItems = []; this.stashItems = []; this.conflictItems = [];
        this.statusLine = 'Select a repository in 1 Status'; this.clampSelections(); this.updateModeStatusBar(); this.renderAll();
        return;
      }
      const [files, branchItems, tagItems, remoteItems, commitItems, stashItems] = await Promise.all([changedFiles(this.lazygitGit), branches().catch(() => []), tags().catch(() => []), remotes().catch(() => []), commits(this.commitListForBranch?.name).catch(() => []), stashes().catch(() => [])]);
      const liveRootBeforePublication = getActiveWorkspaceRoot(), ownerBeforePublication = this.commitFilesController.owner;
      if (ownerBeforePublication && (!liveRootBeforePublication || liveRootBeforePublication !== ownerBeforePublication.repoPath || !fs.existsSync(ownerBeforePublication.repoPath) || !await isCommitFilesOwnerRepositoryCurrent(ownerBeforePublication, (args, cwd) => git(args, cwd)))) { await this.resetCommitFilesState(false); return; }
      this.files = files; this.branchItems = branchItems; this.tagItems = tagItems; this.remoteItems = remoteItems; this.commitItems = commitItems; this.stashItems = stashItems;
      this.conflictItems = conflictsFromChangedFiles(files);
      if (previousPath && this.selectionEpoch === refreshSelectionEpoch) { const i = this.fileTreeRows().findIndex(row => row.kind === 'file' && row.file.path === previousPath); if (i >= 0) this.selected = i; }
      this.clampSelections();
      if (this.activePanel === 'hunks' || this.editorHunkMode) await this.loadHunks(false);
      this.updateModeStatusBar();
      this.updateEditorHunkDecorations();
      this.renderAll();
      if (
        refreshPreview &&
        this.selectionEpoch === refreshSelectionEpoch &&
        this.activePanel === refreshPanel &&
        !refreshEditorMode &&
        !this.editorHunkMode &&
        !this.editorEditMode
      ) await this.openCurrent(this.activeViewPanel(), true).catch(() => undefined);
    });
  }
  private activeViewPanel(): ViewPanel { return this.activePanel === 'hunks' ? 'files' : this.activePanel; }
  private panelForView(panel: ViewPanel): Panel { return panel === 'files' ? this.activePanel === 'hunks' ? 'hunks' : 'files' : panel; }
  private clampSelections() {
    this.selected = clamp(this.selected, this.fileTreeRows().length);
    this.hunkSelected = clamp(this.hunkSelected, this.hunks.length);
    this.branchSelected = clamp(this.branchSelected, this.filteredBranches().length);
    this.tagSelected = clamp(this.tagSelected, this.filteredTags().length);
    this.remoteSelected = clamp(this.remoteSelected, this.filteredRemotes().length);
    this.commitSelected = clamp(this.commitSelected, this.filteredCommits().length); this.commitRange = clampCommitRange(this.commitRange, this.filteredCommits().length);
    this.commitFilesController.clampSelection();
    this.stashSelected = clamp(this.stashSelected, this.filteredStashes().length);
    this.stashFileSelected = clamp(this.stashFileSelected, this.stashFileItems.length);
    this.conflictSelected = clamp(this.conflictSelected, this.filteredConflicts().length);
    this.hunkLineSelected = clamp(this.hunkLineSelected, this.hunks[this.hunkSelected] ? hunkSelectableLineIndexes(this.hunks[this.hunkSelected]).length : 0);
  }
  private activeIndex(panel: Panel): number { return panel === 'hunks' ? (this.hunkSelectionMode === 'line' ? this.hunkLineSelected : this.hunkSelected) : panel === 'branches' ? this.branchSelected : panel === 'tags' ? this.tagSelected : panel === 'remotes' ? this.remoteSelected : panel === 'commits' ? (this.commitFilesController.active ? this.commitFilesController.selected : this.commitSelected) : panel === 'stash' ? (this.stashFilesFor ? this.stashFileSelected : this.stashSelected) : panel === 'conflicts' ? this.conflictSelected : this.selected; }
  private setActiveIndex(panel: Panel, value: number) { if (panel === 'hunks') { if (this.hunkSelectionMode === 'line') this.hunkLineSelected = value; else this.hunkSelected = value; } else if (panel === 'branches') this.branchSelected = value; else if (panel === 'tags') this.tagSelected = value; else if (panel === 'remotes') this.remoteSelected = value; else if (panel === 'commits') { if (this.commitFilesController.active) this.commitFilesController.setSelected(value, this.selectionEpoch); else this.commitSelected = value; } else if (panel === 'stash') { if (this.stashFilesFor) this.stashFileSelected = value; else this.stashSelected = value; } else if (panel === 'conflicts') this.conflictSelected = value; else this.selected = value; }
  private activeLength(panel: Panel): number { return panel === 'status' ? 0 : panel === 'hunks' ? (this.hunkSelectionMode === 'line' ? (this.hunks[this.hunkSelected] ? hunkSelectableLineIndexes(this.hunks[this.hunkSelected]).length : 0) : this.hunks.length) : panel === 'branches' ? this.filteredBranches().length : panel === 'tags' ? this.filteredTags().length : panel === 'remotes' ? this.filteredRemotes().length : panel === 'commits' ? (this.commitFilesController.commit ? this.commitFilesController.rows(this.lazygitGui).length : this.filteredCommits().length) : panel === 'stash' ? (this.stashFilesFor ? this.stashFileItems.length : this.filteredStashes().length) : panel === 'conflicts' ? this.filteredConflicts().length : this.fileTreeRows().length; }
  private filteredFiles(): ChangedFile[] {
    let items = this.files;
    if (this.fileStatusFilter === 'staged') items = items.filter(f => f.staged);
    if (this.fileStatusFilter === 'unstaged') items = items.filter(f => f.xy[1] !== ' ' || f.untracked);
    if (this.fileStatusFilter === 'tracked') items = items.filter(f => !f.untracked);
    if (this.fileStatusFilter === 'untracked') items = items.filter(f => f.untracked);
    return this.sortFilesByLazyGitConfig(this.applyTextFilter(items, f => f.path));
  }
  private fileTreeRows(): readonly Readonly<FileTreeRow>[] { return this.filePanelListModel.read({ files: this.files, selection: this.selected, projectionKey: `${this.fileStatusFilter}\0${this.filterText}\0${this.fileSortMode}\0${this.lazygitGui.fileTreeSortOrder}\0${this.lazygitGui.fileTreeSortCaseSensitive}`, treeKey: `${this.lazygitGui.showFileTree}\0${Array.from(this.collapsedFileDirs).sort().join('\0')}`, project: () => this.filteredFiles(), options: this.lazygitGui, collapsedDirs: this.collapsedFileDirs }); }
  private currentFileTreeRow(): FileTreeRow | undefined { return this.fileTreeRows()[this.selected]; }
  private filesUnderFileTreeDir(dirPath: string): ChangedFile[] { return this.filteredFiles().filter(file => file.path === dirPath || file.path.startsWith(`${dirPath}/`)); }
  private selectFilePathInFilesPanel(filePath: string | undefined) {
    if (!filePath) return;
    let rows = this.fileTreeRows();
    let index = rows.findIndex(row => row.kind === 'file' && row.file.path === filePath);
    if (index < 0) {
      const parts = filePath.split('/');
      for (let i = 1; i < parts.length; i++) this.collapsedFileDirs.delete(parts.slice(0, i).join('/'));
      rows = this.fileTreeRows();
      index = rows.findIndex(row => row.kind === 'file' && row.file.path === filePath);
    }
    if (index >= 0) this.selected = index;
  }
  private allFileTreeDirs(): string[] { return Array.from(new Set(this.filteredFiles().flatMap(file => file.path.split('/').slice(0, -1).map((_part, index, parts) => file.path.split('/').slice(0, index + 1).join('/'))))).filter(Boolean); }
  private async toggleCurrentFileTreeNode() {
    const row = this.currentFileTreeRow();
    if (row?.kind !== 'dir') return false;
    if (this.collapsedFileDirs.has(row.path)) this.collapsedFileDirs.delete(row.path); else this.collapsedFileDirs.add(row.path);
    this.clampSelections();
    this.renderAll();
    await this.restorePanelFocusAfterModal('files');
    return true;
  }
  private async toggleCurrentCommitFileTreeNode() {
    if (!this.commitFilesController.toggleDirectory(++this.selectionEpoch)) return false;
    this.clampSelections(); this.renderAll(); await this.restorePanelFocusAfterModal('commits');
    return true;
  }
  private async collapseAllFileTree() { this.collapsedFileDirs = new Set(this.allFileTreeDirs()); this.clampSelections(); this.renderAll(); await this.restorePanelFocusAfterModal('files'); }
  private async expandAllFileTree() { this.collapsedFileDirs.clear(); this.clampSelections(); this.renderAll(); await this.restorePanelFocusAfterModal('files'); }
  private filteredBranches(): Branch[] {
    const items = this.applyTextFilter(this.branchItems, b => b.label);
    if (this.branchSortMode === 'name') return [...items].sort((a, b) => a.label.localeCompare(b.label));
    if (this.branchSortMode === 'recent') return [...items].sort((a, b) => Number(b.current) - Number(a.current) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
    return items;
  }
  private filteredTags(): Tag[] { return this.applyTextFilter(this.tagItems, t => `${t.name} ${t.subject}`); }
  private filteredRemotes(): Remote[] { return this.applyTextFilter(this.remoteItems, r => `${r.name} ${r.fetchUrl} ${r.pushUrl}`); }
  private filteredCommits(): Commit[] { return this.applyTextFilter(this.commitItems, c => `${c.hash} ${c.subject} ${c.refs}`); }
  private filteredStashes(): Stash[] { return this.applyTextFilter(this.stashItems, s => `${s.ref} ${s.message}`); }
  private filteredConflicts(): ConflictFile[] { return this.applyTextFilter(this.conflictItems, f => f.path); }
  private applyTextFilter<T>(items: T[], text: (item: T) => string): T[] { const q = this.filterText.trim().toLowerCase(); return q ? items.filter(item => text(item).toLowerCase().includes(q)) : items; }
  private sortFilesByLazyGitConfig(items: ChangedFile[]): ChangedFile[] {
    if (this.fileSortMode === 'name') return [...items].sort((a, b) => a.path.localeCompare(b.path));
    if (this.fileSortMode === 'status') return [...items].sort((a, b) => a.xy.localeCompare(b.xy) || a.path.localeCompare(b.path));
    const order = this.lazygitGui.fileTreeSortOrder;
    const normalize = (value: string) => this.lazygitGui.fileTreeSortCaseSensitive ? value : value.toLocaleLowerCase();
    const weight = (filePath: string) => filePath.includes('/') ? 1 : 0;
    return [...items].sort((a, b) => {
      if (order === 'filesFirst' || order === 'foldersFirst') {
        const aw = weight(a.path), bw = weight(b.path);
        if (aw !== bw) return order === 'filesFirst' ? aw - bw : bw - aw;
      }
      return normalize(a.path).localeCompare(normalize(b.path));
    });
  }
  private currentFile(): ChangedFile | undefined { return this.currentFileTreeRow()?.file; }
  private currentBranch(): Branch | undefined { return this.filteredBranches()[this.branchSelected]; }
  private currentTag(): Tag | undefined { return this.filteredTags()[this.tagSelected]; }
  private currentRemote(): Remote | undefined { return this.filteredRemotes()[this.remoteSelected]; }
  private currentCommit(): Commit | undefined { return this.filteredCommits()[this.commitSelected]; }
  private currentStash(): Stash | undefined { return this.filteredStashes()[this.stashSelected]; }
  private currentConflict(): ConflictFile | undefined { return this.filteredConflicts()[this.conflictSelected]; }
  private async select(viewPanel: ViewPanel, index: number) {
    const panel = this.panelForView(viewPanel);
    const len = this.activeLength(panel);
    if (!Number.isFinite(index) || !len) return;
    this.ownsModeStatus = true;
    this.activePanel = panel;
    this.selectionEpoch++;
    this.setActiveIndex(panel, clamp(index, len));
    if (panel === 'files') { this.fileRangeAnchor = undefined; this.fileRangeSelected.clear(); } else if (panel === 'commits' && !this.commitFilesController.commit) this.commitRange = EMPTY_COMMIT_RANGE;
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.renderActivePanel(viewPanel);
    if (panel === 'files') this.scheduleFilesPreview(viewPanel); else await this.openCurrent(viewPanel, true).catch(() => undefined);
  }
  private async activateRow(viewPanel: ViewPanel, index: number, capability?: string) {
    await this.commitFilesController.runActivation(async isCurrent => {
      if (capability && !commitFilesHostMessageAllowed(viewPanel, this.commitFilesController.context(), capability)) return;
      const panel = this.panelForView(viewPanel), len = this.activeLength(panel); if (!Number.isFinite(index) || !len) return;
      this.ownsModeStatus = true; this.activePanel = panel; this.selectionEpoch++; this.setActiveIndex(panel, clamp(index, len));
      if (panel === 'files') { this.fileRangeAnchor = undefined; this.fileRangeSelected.clear(); } else if (panel === 'commits' && !this.commitFilesController.commit) this.commitRange = EMPTY_COMMIT_RANGE;
      this.persistNavigationState(); this.updateModeStatusBar(); this.renderActivePanel(viewPanel); if (isCurrent()) await this.enter(viewPanel, isCurrent);
    });
  }
  private async move(viewPanel: ViewPanel, delta: number) {
    this.ownsModeStatus = true;
    const panel = this.panelForView(viewPanel);
    this.activePanel = panel;
    this.updateModeStatusBar();
    const len = this.activeLength(panel);
    if (!len) return;
    this.selectionEpoch++;
    if (panel === 'commits' && !this.commitFilesController.commit) { const moved = moveCommitSelection(this.commitRange, this.commitSelected, delta, len); this.commitRange = moved.range; this.commitSelected = moved.selected; } else this.setActiveIndex(panel, Math.max(0, Math.min(len - 1, this.activeIndex(panel) + delta)));
    this.persistNavigationState();
    this.renderActivePanel(viewPanel);
    if (panel === 'files') this.scheduleFilesPreview(viewPanel); else await this.openCurrent(viewPanel, true).catch(() => undefined);
  }
  private async moveTo(viewPanel: ViewPanel, position: 'top' | 'bottom') {
    const panel = this.panelForView(viewPanel);
    const len = this.activeLength(panel);
    if (!len) return;
    this.ownsModeStatus = true;
    this.activePanel = panel;
    this.selectionEpoch++;
    const nextIndex = position === 'top' ? 0 : len - 1; if (panel === 'commits' && !this.commitFilesController.commit) { const moved = moveCommitSelection(this.commitRange, this.commitSelected, nextIndex - this.commitSelected, len); this.commitRange = moved.range; this.commitSelected = moved.selected; } else this.setActiveIndex(panel, nextIndex);
    if (panel === 'files') { this.fileRangeAnchor = undefined; this.fileRangeSelected.clear(); }
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.renderActivePanel(viewPanel);
    if (panel === 'files') this.scheduleFilesPreview(viewPanel); else await this.openCurrent(viewPanel, true).catch(() => undefined);
  }
  private selectFileRange(anchor: number, head: number) {
    this.fileRangeSelected.clear();
    const [start, end] = [Math.min(anchor, head), Math.max(anchor, head)];
    for (let i = start; i <= end; i++) this.fileRangeSelected.add(i);
  }
  private async toggleRange(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    if (panel === 'commits' && !this.commitFilesController.commit) { this.commitRange = toggleStickyCommitRange(this.commitRange, this.commitSelected); this.renderAll(); return; }
    if (panel !== 'files') return;
    if (this.fileRangeAnchor === undefined) { this.fileRangeAnchor = this.selected; this.fileRangeSelected.add(this.selected); }
    else { this.fileRangeAnchor = undefined; this.fileRangeSelected.clear(); }
    this.renderAll();
  }
  private async rangeMove(viewPanel: ViewPanel, delta: number) {
    const panel = this.panelForView(viewPanel);
    if (panel === 'commits' && !this.commitFilesController.commit) { this.ownsModeStatus = true; this.activePanel = panel; this.updateModeStatusBar(); const len = this.activeLength(panel); if (!len) return; this.selectionEpoch++; const moved = extendNonStickyCommitRange(this.commitRange, this.commitSelected, delta, len); this.commitRange = moved.range; this.commitSelected = moved.selected; this.persistNavigationState(); this.renderActivePanel(viewPanel); await this.openCurrent(viewPanel, true).catch(() => undefined); return; }
    if (panel !== 'files') return this.move(viewPanel, delta);
    if (this.fileRangeAnchor === undefined) this.fileRangeAnchor = this.selected;
    await this.move(viewPanel, delta);
    this.selectFileRange(this.fileRangeAnchor, this.selected);
    this.renderAll();
  }
  private async moveBlock(viewPanel: ViewPanel, delta: number) {
    const current = this.activeViewPanel() || viewPanel;
    const currentIndex = PANEL_ORDER.indexOf(current);
    const next = PANEL_ORDER[((currentIndex >= 0 ? currentIndex : 0) + delta + PANEL_ORDER.length) % PANEL_ORDER.length];
    this.ownsModeStatus = true; await this.focusPanel(next, { from: current, to: next });
  }
  private async toggle(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    this.activePanel = panel;
    this.updateModeStatusBar();
    if (panel === 'hunks') { const h = this.hunks[this.hunkSelected]; if (!h) return; if (this.hunkSelectionMode === 'line') { const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected]; if (line === undefined) return; await applyLine(h, line); } else await applyHunk(h); await this.loadHunks(false); await this.refresh(true); return; }
    if (panel === 'files') {
      const row = this.currentFileTreeRow();
      if (row?.kind === 'dir') { const files = this.filesUnderFileTreeDir(row.path); if (!files.length) return; await toggleStageSelected(files); await this.refresh(true); return; }
      const ranged = Array.from(this.fileRangeSelected).map(i => this.fileTreeRows()[i]?.file).filter((file): file is ChangedFile => !!file);
      if (ranged.length > 1) { await toggleStageSelected(ranged); this.fileRangeAnchor = undefined; this.fileRangeSelected.clear(); await this.refresh(true); return; }
      const f = this.currentFile(); if (!f) return; await toggleStage(f); await this.refresh(true);
    }
    else await this.enter(viewPanel);
  }
  private async enter(viewPanel: ViewPanel, activationCurrent: () => boolean = () => true) {
    const panel = this.panelForView(viewPanel);
    this.activePanel = panel;
    this.updateModeStatusBar();
    if (panel === 'status') return this.recentReposMenu();
    if (panel === 'files') { if (await this.toggleCurrentFileTreeNode()) return; return this.enterHunks(); }
    if (panel === 'hunks') return this.openCurrent('files', false);
    if (panel === 'branches') return this.enterBranchCommits();
    if (panel === 'tags') return this.tagMenu();
    if (panel === 'remotes') return this.remoteMenu();
    if (panel === 'commits') return this.enterCommit(activationCurrent);
    if (panel === 'stash') return this.enterStash();
    if (panel === 'conflicts') return this.conflictMenu();
  }
  private async back(viewPanel: ViewPanel) {
    if (viewPanel === 'files' && this.activePanel === 'hunks') { this.activePanel = 'files'; this.updateModeStatusBar(); this.renderAll(); return; }
    if (viewPanel === 'commits' && this.commitFilesController.active) { await this.resetCommitFilesState(false); this.renderAll(); await this.openCurrent('commits', true).catch(() => undefined); return; }
    if (viewPanel === 'stash' && this.stashFilesFor) { this.stashFilesFor = undefined; this.stashFileItems = []; this.stashFileSelected = 0; this.renderAll(); await this.openCurrent('stash', true).catch(() => undefined); return; }
    await this.focusPanel(viewPanel);
  }
  private async focusMainView(viewPanel: ViewPanel) {
    this.ownsModeStatus = false;
    this.webviewKeyboardOwner = false;
    this.setWebviewKeyboardEnabled(false);
    this.setFocusArea('viewer');
    this.renderAll();
    await this.openCurrent(viewPanel, false);
  }
  private async editCurrent(viewPanel: ViewPanel) { const file = this.currentFilePath(viewPanel); if (file) { await this.releaseEditorOwnership(); await editPath(file); } }
  private currentFilePath(viewPanel: ViewPanel): string | undefined { if (viewPanel === 'conflicts') return this.conflictItems[this.conflictSelected]?.path; return this.currentFile()?.path; }
  private async copyCurrentPath(viewPanel: ViewPanel) { const file = this.currentFilePath(viewPanel); if (file) await copyText(file, 'path copied'); }
  private async copyCurrentInfo(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    if (panel === 'files' || panel === 'hunks') { const f = this.currentFile(); if (f) await copyText(`${f.xy} ${f.path}`, 'file info copied'); }
    else if (panel === 'branches') { const b = this.currentBranch(); if (b) await copyText(b.name, 'branch copied'); }
    else if (panel === 'tags') { const t = this.currentTag(); if (t) await copyText(t.name, 'tag copied'); }
    else if (panel === 'remotes') { const r = this.currentRemote(); if (r) await copyText(r.name, 'remote copied'); }
    else if (panel === 'commits') { const c = this.currentCommit(); if (c) await copyText(`${c.hash} ${c.subject}`, 'commit copied'); }
   
    if (panel === 'stash') { const st = this.currentStash(); if (st) await copyText(`${st.ref} ${st.message}`, 'stash copied'); }
  }
  private async ignoreCurrentFile() {
    const f = this.currentFile(); if (!f) return;
    await pickGitAction(`Ignore / exclude · ${f.path}`, [
      { key: 'i', label: '$(file) Ignore file', description: '.gitignore', run: async () => appendIgnore('.gitignore', f.path) },
      { key: 'e', label: '$(eye-closed) Exclude file locally', description: '.git/info/exclude', run: async () => appendIgnore('.git/info/exclude', f.path) }
    ]);
    await this.refresh(true);
  }
  private async resetCommitFilesState(clearCommitList = true) { const ownerId = this.editorModeOwnerId; this.commitFilesController.invalidate(); if (ownerId || this.editorHunkMode) await this.setEditorHunkMode(false, ownerId).catch(() => false); await Promise.all([this.editorPublicationGate.request(async isCurrent => { if (isCurrent()) await closeLazyGitVSPreviewTabsIfSingle(); }), this.focusPublicationGate.request(async () => undefined), reconcileCommitFilePreviewPublication()]); this.commitListForBranch = clearCommitList ? undefined : this.commitListForBranch; }
  private async toggleFileTree() {
    this.lazygitGui.showFileTree = !this.lazygitGui.showFileTree;
    this.statusLine = `File tree ${this.lazygitGui.showFileTree ? 'on' : 'off'}`;
    this.renderAll();
    await this.restorePanelFocusAfterModal('files');
  }
  private async fileSortMenu() {
    const picked = await vscode.window.showQuickPick([
      { label: 'config', description: 'Use lazygit gui.fileTreeSortOrder', mode: 'config' as const },
      { label: 'name', description: 'Sort by path/name', mode: 'name' as const },
      { label: 'status', description: 'Sort by Git short status', mode: 'status' as const }
    ], { title: 'Files sort order' });
    if (!picked) return;
    this.fileSortMode = picked.mode;
    this.statusLine = `Files sort: ${picked.label}`;
    this.renderAll();
    await this.restorePanelFocusAfterModal('files');
  }
  private statusCommandCatalog(): GitMenuItem[] {
    return [
      { key: 'o', label: '$(go-to-file) Open lazygit config', description: this.lazygitConfigFiles[0] ?? 'No config loaded', run: async () => { const cfg = this.lazygitConfigFiles[0]; if (cfg) await vscode.env.openExternal(vscode.Uri.file(cfg)); else vscode.window.showInformationMessage('LazyGitVS: lazygit config not found; using defaults.'); } },
      { key: 'e', label: '$(edit) Edit lazygit config', description: this.lazygitConfigFiles[0] ?? 'No config loaded', run: async () => { const cfg = this.lazygitConfigFiles[0]; if (cfg) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(cfg)), { preview: false }); else vscode.window.showInformationMessage('LazyGitVS: lazygit config not found; using defaults.'); } },
      { key: 'a', label: '$(git-commit) Show all branch log', description: 'git log --all --graph', run: async () => showText('LazyGitVS All Branch Log', await git(['log', '--all', '--graph', '--decorate=short', '--oneline', '--max-count=200'])) },
      { key: 'A', label: '$(git-commit) Show all branch log reversed', description: 'git log --all --graph --reverse', run: async () => showText('LazyGitVS All Branch Log', await git(['log', '--all', '--graph', '--decorate=short', '--oneline', '--reverse', '--max-count=200'])) },
      { key: 'u', label: '$(cloud-download) Check for updates', description: 'Use VS Code extension updates', run: async () => { await vscode.window.showInformationMessage('LazyGitVS updates are handled by VS Code / Marketplace.'); } },
      { key: '<enter>', label: '$(repo) Switch to workspace repository', description: this.workspaceRepos.length ? `${this.workspaceRepos.length} repos available` : 'No repos discovered', run: async () => this.recentReposMenu() },
    ];
  }
  private async recentReposMenu() {
    const repos = await discoverWorkspaceRepositories();
    this.workspaceRepos = repos;
    if (!repos.length) { vscode.window.showInformationMessage('LazyGitVS: no Git repositories found in this workspace.'); return; }
    const current = getActiveWorkspaceRoot();
    const items = repos.map(repo => ({
      label: `${repo.path === current ? '$(check) ' : ''}${repo.name}`,
      description: repoChangeDescription(repo),
      detail: `${repo.branch} · ${repo.path}`,
      repo
    }));
    const qp = vscode.window.createQuickPick<typeof items[number]>();
    qp.title = 'Recent repositories';
    qp.placeholder = 'Switch to a workspace repository';
    qp.items = items;
    qp.activeItems = items.filter(item => item.repo.path === current).slice(0, 1);
    const picked = await new Promise<typeof items[number] | undefined>(resolve => {
      let settled = false;
      qp.onDidAccept(() => { settled = true; resolve(qp.activeItems[0]); qp.hide(); });
      qp.onDidHide(() => { if (!settled) resolve(undefined); qp.dispose(); });
      qp.show();
    });
    if (!picked) return;
    await this.selectRepository(picked.repo.path);
  }
  private async selectRepository(repoPath: string) { const repos = this.workspaceRepos.length ? this.workspaceRepos : await discoverWorkspaceRepositories();
    const repo = repos.find(repo => repo.path === repoPath);
    if (!repo) return this.recentReposMenu();
    const clearedCopiedCommits = !!this.cherryPickBuffer.sourceRepoPath && this.cherryPickBuffer.sourceRepoPath !== repo.path; if (clearedCopiedCommits) this.cherryPickBuffer = resetCherryPickBuffer();
    this.cancelFilesPreview(); this.commitRange = EMPTY_COMMIT_RANGE; await this.resetCommitFilesState(); if (this.editorHunkMode || this.editorEditMode) await this.setEditorHunkMode(false);
    setActiveWorkspaceRoot(repo.path); this.selectionEpoch++; this.workspaceRepos = repos; this.statusLine = `Repository: ${repo.name}${clearedCopiedCommits ? ' · copied commits cleared' : ''}`;
    await this.refresh(true); await this.focusPanel('status');
  }
  private async statusMenu() {
    await pickGitAction('Status options', this.statusCommandCatalog());
  }
  private keyLabel(value: string | string[] | undefined): string { return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''); }
  private reflogCommandCatalog(): GitMenuItem[] {
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    return [
      { key: key(this.lazygitKeymap.universal.undo) || 'z', label: '$(discard) Undo', description: 'The reflog will be used to determine what git command to run to undo the last git command. This does not include changes to the working tree; only commits are taken into consideration.', run: async () => this.reflogUndo() },
      { key: key(this.lazygitKeymap.universal.redo) || 'Z', label: '$(redo) Redo', description: 'The reflog will be used to determine what git command to run to redo the last git command. This does not include changes to the working tree; only commits are taken into consideration.', run: async () => this.reflogRedo() }
    ];
  }
  private filesCommandCatalog(viewPanel: ViewPanel): GitMenuItem[] {
    const u = this.lazygitKeymap.universal, f = this.lazygitKeymap.files, k = this.lazygitKeymap.commits;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    return [
      { key: key(f.openStatusFilter) || 'F', label: '$(filter) File status filter', run: async () => this.statusFilterMenu() },
      { key: key((f as any).toggleTreeView) || '`', label: '$(list-tree) Toggle file tree', run: async () => this.toggleFileTree() },
      { key: key((f as any).collapseAll) || '-', label: '$(fold) Collapse all files', run: async () => this.collapseAllFileTree() },
      { key: key((f as any).expandAll) || '=', label: '$(unfold) Expand all files', run: async () => this.expandAllFileTree() },
      { key: key(u.pushFiles) || key(u.push) || 'P', label: '$(cloud-upload) Push', run: async () => this.push() },
      { key: key(u.pullFiles) || key(u.pull) || 'p', label: '$(cloud-download) Pull', run: async () => this.pull() },
      { key: key(f.toggleStagedAll) || 'a', label: '$(check-all) Toggle stage all files', run: async () => this.stageAll() },
      { key: key(f.commitChanges) || 'c', label: '$(git-commit) Commit', run: async () => this.commit() },
      { key: key(f.commitChangesWithoutHook) || 'w', label: '$(shield) Commit without pre-commit hook', run: async () => this.commit('noVerify') },
      { key: key(f.amendLastCommit) || 'A', label: '$(history) Amend last commit', run: async () => this.commit('amendNoEdit') },
      { key: key(f.commitChangesWithEditor) || 'C', label: '$(edit) Commit with body', run: async () => this.commit('body') },
      { key: key(f.stashAllChanges) || 's', label: '$(archive) Stash all changes', run: async () => this.stashAll() },
      { key: key(f.viewStashOptions) || 'S', label: '$(archive) Stash options', run: async () => this.runMenu(showStashCreateMenu, viewPanel) },
      { key: key(u.remove) || 'd', label: '$(trash) Discard menu', run: async () => this.discardMenu(viewPanel) },
      { key: key(k.viewResetOptions) || 'g', label: '$(debug-restart) Reset to @{upstream}', description: 'mixed / soft / hard', run: async () => this.resetToUpstreamMenu(viewPanel) }, { key: key(f.viewResetOptions) || 'D', label: '$(debug-restart) Reset / nuke menu', run: async () => this.runMenu(() => showResetMenu(() => this.animateExplosion()), viewPanel) },
    ];
  }
  private hunkCommandCatalog(viewPanel: ViewPanel): GitMenuItem[] {
    const u = this.lazygitKeymap.universal, m = this.lazygitKeymap.main;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    return [
      { key: key(u.select) || '<space>', label: '$(add) Stage/unstage selected hunk or line', run: async () => this.toggle(viewPanel) },
      { key: key(u.togglePanel) || '<tab>', label: '$(split-horizontal) Toggle staged/unstaged', run: async () => this.toggleHunkPanel() },
      { key: key(m.toggleSelectHunk) || 'a', label: '$(list-selection) Toggle hunk/line mode', run: async () => this.showPendingLineMode() },
      { key: key(u.remove) || 'd', label: '$(trash) Discard/unstage selected hunk', run: async () => this.discardMenu(viewPanel) }
    ];
  }
  private branchCommandCatalog(): GitMenuItem[] {
    const b = this.currentBranch();
    const k = this.lazygitKeymap.branches, u = this.lazygitKeymap.universal;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    const items: GitMenuItem[] = [];
    if (b) items.push({ key: key(u.select) || '<space>', label: '$(git-branch) Checkout branch', description: b.name, run: async () => { await git(['checkout', b.name]); } });
    items.push({ key: key(k.checkoutBranchByName) || 'c', label: '$(symbol-key) Checkout by name', description: "enter '-' for previous branch", run: async () => { const name = await vscode.window.showInputBox({ title: 'Checkout branch by name', placeHolder: "branch name or '-'" }); if (name?.trim()) await git(['checkout', name.trim()]); } });
    items.push({ key: key(k.checkoutPreviousBranch) || '-', label: '$(history) Checkout previous branch', description: 'git checkout -', args: ['checkout', '-'] });
    items.push({ key: key(u.new) || 'n', label: '$(add) New branch', description: 'git checkout -b <name>', run: async () => { const name = await vscode.window.showInputBox({ title: 'New branch', validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['checkout', '-b', name.trim()]); } });
    if (b && b.kind === 'local') items.push({ key: key(k.renameBranch) || 'R', label: '$(edit) Rename branch', description: b.name, run: async () => { const name = await vscode.window.showInputBox({ title: `Rename ${b.name}`, value: b.name, validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['branch', '-m', b.name, name.trim()]); } });
    if (b && !b.current) items.push({ key: key(k.mergeIntoCurrentBranch) || 'M', label: '$(git-merge) Merge into current branch', description: b.name, danger: true, confirm: `Merge ${b.name} into current branch?`, args: ['merge', b.name] });
    if (b && !b.current) items.push({ key: key(k.rebaseBranch) || 'r', label: '$(debug-restart) Rebase current branch onto selected', description: b.name, danger: true, confirm: `Rebase current branch onto ${b.name}?`, args: ['rebase', b.name] });
    if (b && !b.current) items.push({ key: key(k.forceCheckoutBranch) || 'F', label: '$(warning) Force checkout branch', description: b.name, danger: true, confirm: `Force checkout ${b.name} and discard local changes?`, args: ['checkout', '-f', b.name] });
    if (b && b.kind === 'local') items.push({ key: key(k.setUpstream) || 'u', label: '$(repo-push) Set upstream', description: `origin/${b.name}`, args: ['branch', '--set-upstream-to', `origin/${b.name}`, b.name] });
    if (b && b.kind === 'local') items.push({ key: key(k.fastForward) || 'f', label: '$(repo-pull) Fast-forward from upstream', description: b.name, args: ['merge', '--ff-only', `origin/${b.name}`] });
    if (b) items.push({ key: key(k.createTag) || 'T', label: '$(tag) Create tag here', description: b.name, run: async () => { const tag = await vscode.window.showInputBox({ title: `Create tag at ${b.name}`, validateInput: v => v.trim() ? undefined : 'Tag name required.' }); if (tag?.trim()) await git(['tag', tag.trim(), b.name]); } });
    items.push({ key: key(k.sortOrder) || 's', label: '$(sort-precedence) Sort branches', description: this.branchSortMode, run: async () => this.branchSortMenu() });
    if (b && !b.current) items.push({ key: key(u.remove) || 'd', label: '$(trash) Delete branch', description: b.name, danger: true, confirm: `Delete branch ${b.name}?`, run: async () => { await git(['branch', b.kind === 'remote' ? '-dr' : '-d', b.name]); } });
    return items;
  }
  private async branchSortMenu() {
    const picked = await vscode.window.showQuickPick([
      { label: 'default', description: 'lazygit-style local/worktree/remote grouping', mode: 'default' as const },
      { label: 'name', description: 'Alphabetical', mode: 'name' as const },
      { label: 'recent', description: 'Current first, then kind/name', mode: 'recent' as const }
    ], { title: 'Branch sort order' });
    if (!picked) return;
    this.branchSortMode = picked.mode;
    this.statusLine = `Branch sort: ${picked.label}`;
    this.renderAll();
    await this.restorePanelFocusAfterModal('branches');
  }
  private tagCommandCatalog(): GitMenuItem[] {
    const t = this.currentTag();
    const k = this.lazygitKeymap.branches, u = this.lazygitKeymap.universal;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    const items: GitMenuItem[] = [
      { key: key(k.createTag) || 'T', label: '$(tag) Create tag at HEAD', description: 'git tag <name>', run: async () => { const name = await vscode.window.showInputBox({ title: 'Create tag at HEAD', validateInput: v => v.trim() ? undefined : 'Tag name required.' }); if (name?.trim()) await git(['tag', name.trim()]); } }
    ];
    if (!t) return items;
    items.unshift({ key: key(u.select) || '<space>', label: '$(debug-step-over) Checkout tag detached', description: t.name, danger: true, confirm: `Checkout ${t.name} as detached HEAD?`, args: ['checkout', t.name] });
    items.push(
      { key: key(u.new) || 'n', label: '$(git-branch) New branch from tag', description: t.name, run: async () => { const name = await vscode.window.showInputBox({ title: `New branch from ${t.name}`, validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['checkout', '-b', name.trim(), t.name]); } },
      { key: key(k.pushTag) || 'P', label: '$(repo-push) Push tag', description: t.name, args: ['push', 'origin', t.name] },
      { key: key(u.remove) || 'd', label: '$(trash) Delete tag', description: t.name, danger: true, confirm: `Delete tag ${t.name}?`, args: ['tag', '-d', t.name] }
    );
    return items;
  }
  private remoteCommandCatalog(): GitMenuItem[] {
    const r = this.currentRemote();
    const k = this.lazygitKeymap.branches, u = this.lazygitKeymap.universal;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    const items: GitMenuItem[] = [
      { key: key(u.new) || 'n', label: '$(add) Add remote', description: 'git remote add <name> <url>', run: async () => { const name = await vscode.window.showInputBox({ title: 'Add remote name', validateInput: v => v.trim() ? undefined : 'Remote name required.' }); if (!name?.trim()) return; const url = await vscode.window.showInputBox({ title: `URL for remote ${name.trim()}`, validateInput: v => v.trim() ? undefined : 'Remote URL required.' }); if (url?.trim()) await git(['remote', 'add', name.trim(), url.trim()]); } }
    ];
    if (!r) return items;
    items.unshift({ key: key(k.fetchRemote) || 'f', label: '$(sync) Fetch remote', description: r.name, args: ['fetch', r.name] });
    items.push(
      { key: key(u.edit) || 'e', label: '$(edit) Edit remote URL', description: r.fetchUrl || r.pushUrl, run: async () => { const url = await vscode.window.showInputBox({ title: `Set URL for ${r.name}`, value: r.fetchUrl || r.pushUrl, validateInput: v => v.trim() ? undefined : 'Remote URL required.' }); if (url?.trim()) await git(['remote', 'set-url', r.name, url.trim()]); } },
      { key: key(k.addForkRemote) || 'F', label: '$(repo-forked) Add fork remote', description: 'git remote add <name> <url>', run: async () => { const name = await vscode.window.showInputBox({ title: 'Fork remote name', placeHolder: 'fork', validateInput: v => v.trim() ? undefined : 'Remote name required.' }); if (!name?.trim()) return; const url = await vscode.window.showInputBox({ title: `URL for fork remote ${name.trim()}`, validateInput: v => v.trim() ? undefined : 'Remote URL required.' }); if (url?.trim()) await git(['remote', 'add', name.trim(), url.trim()]); } },
      { key: key(u.remove) || 'd', label: '$(trash) Remove remote', description: r.name, danger: true, confirm: `Remove remote ${r.name}?`, args: ['remote', 'remove', r.name] }
    );
    return items;
  } private commitListContext(): string { return this.commitListForBranch ? `branch:${this.commitListForBranch.name}` : 'local'; }
  private isCommitRangeSelected(index: number): boolean { return !this.commitFilesController.commit && this.commitRange.mode !== 'none' && isCommitInRange(this.commitRange, this.commitSelected, index, this.filteredCommits().length); } private isVisibleCopiedCommit(commit: Commit): boolean { const repoPath = getActiveWorkspaceRoot(); return !!repoPath && hasVisibleCopiedCommit(this.cherryPickBuffer, { repoPath, listContext: this.commitListContext(), hash: commit.hash }); }
  private copyCurrentCommitRange() { if (this.commitFilesController.commit) return; const repoPath = workspaceRoot(), visibleCommits = this.filteredCommits(); if (!visibleCommits.length) return; this.cherryPickBuffer = toggleCopiedCommitRange(this.cherryPickBuffer, { repoPath, listContext: this.commitListContext(), newestFirstHashes: visibleCommits.map(commit => commit.hash), range: this.commitRange, selectedIndex: this.commitSelected }); this.statusLine = this.cherryPickBuffer.hashes.length ? `Copied ${this.cherryPickBuffer.hashes.length} commit(s) for cherry-pick` : 'Copied commits cleared'; this.renderAll(); } private resetCopiedCommits() { if (this.commitFilesController.commit) return; this.cherryPickBuffer = resetCherryPickBuffer(); this.statusLine = 'Copied commits cleared'; this.renderAll(); }
  private async pasteCopiedCommits() { if (this.commitFilesController.commit) return; const targetRepoPath = workspaceRoot(), previousTargetHash = this.currentCommit()?.hash; try { const outcome = await pasteCherryPickBuffer({ buffer: this.cherryPickBuffer, targetRepoPath, runGit: (args, cwd) => git(args, cwd), confirm: async (title, prompt) => await vscode.window.showWarningMessage(prompt, { modal: true, detail: title }, title) === title }); if (outcome.kind === 'success') { this.cherryPickBuffer = outcome.buffer; this.statusLine = `Cherry-picked ${outcome.buffer.hashes.length} copied commit(s)`; await this.refresh(false); this.commitSelected = findCommitIndexByHash(this.filteredCommits().map(commit => commit.hash), previousTargetHash, this.commitSelected); this.renderAll(); await this.openCurrent('commits', true).catch(() => undefined); return; } if (outcome.kind === 'cancelled') return; if (outcome.kind === 'source-mismatch') this.cherryPickBuffer = outcome.buffer; vscode.window.showWarningMessage(outcome.message); this.renderAll(); } catch (error) { await this.refresh(false).catch(() => undefined); throw error; } } private async dropCurrentCommitRange() { if (this.commitFilesController.commit) return; const repoPath = workspaceRoot(), visibleCommits = this.filteredCommits(); if (!visibleCommits.length) return; const outcome = await dropSelectedCommits({ repoPath, visibleHashes: visibleCommits.map(commit => commit.hash), selectedIndex: this.commitSelected, range: this.commitRange, viewBranch: this.commitListForBranch?.name, confirm: async (title, prompt) => await vscode.window.showWarningMessage(prompt, { modal: true, detail: title }, title) === title }); if (outcome.kind === 'success') { this.statusLine = `Dropped ${outcome.hashes.length} commit(s)`; await this.refresh(false); this.commitSelected = clamp(outcome.startIndex, this.filteredCommits().length); this.commitRange = EMPTY_COMMIT_RANGE; this.renderAll(); await this.openCurrent('commits', true).catch(() => undefined); return; } if (outcome.kind === 'rebase-active') { this.statusLine = 'Drop stopped during rebase; recover from Status'; await this.refresh(false); vscode.window.showWarningMessage(outcome.message); return; } if (outcome.kind === 'blocked') vscode.window.showWarningMessage(outcome.message); } private async squashCurrentCommitRange() { if (this.commitFilesController.commit) return; const repoPath = workspaceRoot(), visibleCommits = this.filteredCommits(); if (!visibleCommits.length) return; try { const outcome = await squashSelectedCommits({ repoPath, visibleHashes: visibleCommits.map(commit => commit.hash), selectedIndex: this.commitSelected, range: this.commitRange, viewBranch: this.commitListForBranch?.name, confirm: async (title, prompt) => await vscode.window.showWarningMessage(prompt, { modal: true, detail: title }, title) === title, onStart: () => { this.statusLine = 'Squashing'; this.renderAll(); } }); if (outcome.kind === 'success') { this.statusLine = `Squashed ${outcome.hashes.length} commit(s)`; await this.refresh(false); this.commitSelected = clamp(outcome.startIndex, this.filteredCommits().length); this.commitRange = EMPTY_COMMIT_RANGE; this.renderAll(); await this.openCurrent('commits', true).catch(() => undefined); return; } if (outcome.kind === 'rebase-active') { this.statusLine = 'Squash stopped during rebase; recover from Status'; await this.refresh(false); vscode.window.showWarningMessage(outcome.message); return; } if (outcome.kind === 'blocked') vscode.window.showWarningMessage(outcome.message); } finally { if (this.statusLine === 'Squashing') { this.statusLine = ''; this.renderAll(); } } } private async fixupCurrentCommitRange() { if (this.commitFilesController.commit) return; const repoPath = workspaceRoot(), visibleCommits = this.filteredCommits(); if (!visibleCommits.length) return; try { const outcome = await fixupSelectedCommits({ repoPath, visibleHashes: visibleCommits.map(commit => commit.hash), selectedIndex: this.commitSelected, range: this.commitRange, viewBranch: this.commitListForBranch?.name, chooseAction: async () => { let actionFlag: '' | '-C' | undefined; await pickGitAction(FIXUP_MENU_TITLE, FIXUP_MENU_ITEMS.map(action => ({ key: action.key, label: action.label, description: action.tooltip, run: async () => { actionFlag = action.actionFlag; } }))); return actionFlag; }, onStart: () => { this.statusLine = 'Fixing up'; this.renderAll(); } }); if (outcome.kind === 'success') { this.statusLine = `Fixed up ${outcome.hashes.length} commit(s)`; await this.refresh(false); this.commitSelected = clamp(outcome.startIndex, this.filteredCommits().length); this.commitRange = EMPTY_COMMIT_RANGE; this.renderAll(); await this.openCurrent('commits', true).catch(() => undefined); return; } if (outcome.kind === 'rebase-active') { this.statusLine = 'Fixup stopped during rebase; recover from Status'; await this.refresh(false); vscode.window.showWarningMessage(outcome.message); return; } if (outcome.kind === 'blocked') vscode.window.showWarningMessage(outcome.message); } finally { if (this.statusLine === 'Fixing up') { this.statusLine = ''; this.renderAll(); } } }
  private commitHistoryActionInput() {
    return { repoPath: workspaceRoot(), visibleHashes: this.filteredCommits().map(commit => commit.hash), selectedIndex: this.commitSelected, range: this.commitRange,
      isLocalCommits: !this.commitListForBranch, onStatus: (status: string) => { this.statusLine = status; this.renderAll(); }, onMessage: (message: string) => { vscode.window.showWarningMessage(message); } };
  }
  private commitRewordItem(key: string): GitMenuItem {
    return commitRewordMenuItem({ ...this.commitHistoryActionInput(), key, prompt: async (title, initialSummary) => vscode.window.showInputBox({ title, value: initialSummary, validateInput: value => value.trim() && !/[\r\n]/.test(value) ? undefined : 'Commit summary required.' }) });
  }
  private commitCommandCatalog(): GitMenuItem[] {
    if (this.commitFilesController.commit) return this.commitFilesController.checkoutCatalog(this.keyLabel(this.lazygitKeymap.commitFiles.checkoutCommitFile) || 'c', async () => this.checkoutCurrentCommitFile());
    const u = this.lazygitKeymap.universal, k = this.lazygitKeymap.commits;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    const c = this.currentCommit();
    if (!c) return [];
    return [
      { key: key(u.goInto) || '<enter>', label: '$(list-unordered) View files in commit', description: c.subject, run: async () => this.enterCommit() },
      { key: key(k.copyCommitAttributeToClipboard) || key(u.copyToClipboard) || 'y', label: '$(copy) Copy commit attribute', description: 'hash / subject / both', run: async () => showCommitCopyMenu(c, copyText) },
      { key: key(k.checkoutCommit) || '<space>', label: '$(debug-step-over) Checkout commit detached', description: c.hash, danger: true, confirm: `Checkout ${c.hash} as detached HEAD?`, args: ['checkout', c.hash] },
      { key: key(k.newBranch) || 'n', label: '$(git-branch) New branch off commit', description: c.hash, run: async () => { const name = await vscode.window.showInputBox({ title: `New branch at ${c.hash}`, validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['checkout', '-b', name.trim(), c.hash]); } },
      this.commitRewordItem(key(k.renameCommit) || 'r'),
      commitEditMenuItem({ ...this.commitHistoryActionInput(), key: key(u.edit) || 'e' }),
      { key: key(k.amendToCommit) || 'A', label: '$(history) Amend HEAD with staged changes', description: 'git commit --amend --no-edit', danger: true, confirm: 'Amend HEAD with staged changes?', args: ['commit', '--amend', '--no-edit'] },
      nativeCreateFixupCommitMenuItem({ ...this.commitHistoryActionInput(), key: key(k.createFixupCommit) || 'F', label: '$(tools) Create fixup commit', onSuccess: outcome => { this.commitSelected = outcome.selectionIndex; this.commitRange = EMPTY_COMMIT_RANGE; } }),
      { key: key(k.markCommitAsFixup) || 'f', label: '$(combine) Fixup selected commit(s)', description: c.hash, run: async () => this.fixupCurrentCommitRange() },
      { key: key(u.remove) || 'd', label: '$(trash) Drop selected commit(s)', description: c.hash, run: async () => this.dropCurrentCommitRange() },
      { key: key(k.squashDown) || 's', label: '$(combine) Squash selected commit(s)', description: c.hash, run: async () => this.squashCurrentCommitRange() },
      commitAutosquashMenuItem({ ...this.commitHistoryActionInput(), key: key(k.squashAboveCommits) || 'S', chooseAction: () => chooseApplyFixupCommitsAction(pickGitAction), onSuccess: outcome => { this.commitSelected = outcome.selectedIndex; this.commitRange = EMPTY_COMMIT_RANGE; } }),
      commitMoveMenuItem({ ...this.commitHistoryActionInput(), key: key(k.moveDownCommit) || '<ctrl+j>', direction: 'down', onSuccess: outcome => { this.commitSelected = outcome.selectedIndex; this.commitRange = outcome.range; } }),
      commitMoveMenuItem({ ...this.commitHistoryActionInput(), key: key(k.moveUpCommit) || '<ctrl+k>', direction: 'up', onSuccess: outcome => { this.commitSelected = outcome.selectedIndex; this.commitRange = outcome.range; } }),
      { key: key(k.cherryPickCopy) || 'C', label: '$(copy) Copy/toggle commit range for cherry-pick', description: c.hash, run: async () => this.copyCurrentCommitRange() }, { key: key(k.pasteCommits) || 'V', label: '$(git-pull-request-go-to-changes) Paste copied commits', description: this.cherryPickBuffer.hashes.join(' '), run: async () => this.pasteCopiedCommits() }, { key: key(k.resetCherryPick) || '<ctrl+r>', label: '$(clear-all) Reset copied (cherry-picked) commits selection', description: 'clear copied commits without changing Git', run: async () => this.resetCopiedCommits() },
      { key: key(k.revertCommit) || 't', label: '$(reply) Revert commit', description: c.hash, danger: true, confirm: `Create a revert commit for ${c.hash}?`, args: ['revert', c.hash] },
      { key: key(k.createTag) || key(k.tagCommit) || 'T', label: '$(tag) Tag commit', description: c.hash, run: async () => { const tag = await vscode.window.showInputBox({ title: `Tag ${c.hash}`, validateInput: v => v.trim() ? undefined : 'Tag name required.' }); if (tag?.trim()) await git(['tag', tag.trim(), c.hash]); } }, { key: key(k.viewBisectOptions) || 'b', label: '$(git-compare) View bisect options', description: c.hash, run: async () => { await this.openBisectOptions(c).catch(error => vscode.window.showErrorMessage(error.message)); } },
      { key: key(k.viewResetOptions) || 'g', label: '$(debug-restart) Reset options', description: c.hash, run: async () => showCommitResetMenu(c) },
      { key: key(k.openInBrowser) || 'o', label: '$(globe) Open commit in browser', description: 'origin remote URL', run: async () => { const url = await originCommitUrl(c.hash); if (url) await vscode.env.openExternal(vscode.Uri.parse(url)); else vscode.window.showInformationMessage('LazyGitVS: no browser URL for origin remote.'); } },
      { key: key(k.openLogMenu) || '<ctrl+l>', label: '$(git-commit) Commit preview', description: 'rich stat + patch', run: async () => showCommitPreview(c, this.lazygitGit, false) }
    ];
  }
  private async openBisectOptions(commit: Commit): Promise<boolean> { const repoPath = workspaceRoot(); const changed = await runBisectOptions({ repoPath, selectedHash: commit.hash, runGit: (args, cwd) => git(args, cwd), createQuickPick: () => vscode.window.createQuickPick<BisectQuickPickItem>(), showInputBox: options => vscode.window.showInputBox(options), confirm: async prompt => await vscode.window.showWarningMessage(prompt, { modal: true }, 'Reset') === 'Reset' }); if (changed) { const selectionEpoch = this.selectionEpoch; const previousCommitHash = commit.hash; await this.refresh(false); if (selectionEpoch === this.selectionEpoch) { const i = this.filteredCommits().findIndex(candidate => candidate.hash === previousCommitHash); if (i >= 0) { this.commitSelected = i; this.renderAll(); await this.openCurrent('commits', true).catch(() => undefined); } } } return changed; }
  private stashCommandCatalog(): GitMenuItem[] {
    const s = this.currentStash();
    if (!s) return [{ key: 'a', label: '$(archive) Stash all changes', description: 'git stash push', args: ['stash', 'push'] }];
    const k = this.lazygitKeymap.stash;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    return [
      { key: '<enter>', label: '$(eye) Show stash', description: s.message, run: async () => showStashPreview(s, this.lazygitGit, false) },
      { key: key(k.apply) || '<space>', label: '$(archive) Apply stash', description: s.ref, args: ['stash', 'apply', s.ref] },
      { key: key(k.popStash) || 'g', label: '$(archive) Pop stash', description: s.ref, args: ['stash', 'pop', s.ref] },
      { key: key(k.newBranch) || 'n', label: '$(git-branch) New branch from stash', description: s.ref, run: async () => { const name = await vscode.window.showInputBox({ title: `New branch from ${s.ref}`, validateInput: v => v.trim() ? undefined : 'Branch name required.' }); if (name?.trim()) await git(['stash', 'branch', name.trim(), s.ref]); } },
      dangerousGitMenuItem({ key: key(k.renameStash) || 'r', label: '$(edit) Rename stash', description: 'store new message and drop old ref', run: async () => { const msg = await vscode.window.showInputBox({ title: `Rename ${s.ref}`, value: s.message, validateInput: v => v.trim() ? undefined : 'Stash message required.' }); if (!msg?.trim()) return; const sha = (await git(['rev-parse', s.ref])).trim(); await git(['stash', 'store', '-m', msg.trim(), sha]); await git(['stash', 'drop', s.ref]); } }, `Rename ${s.ref}? This drops the old stash ref.`, 'discard'),
      dangerousGitMenuItem({ key: 'd', label: '$(trash) Drop stash', description: s.ref, args: ['stash', 'drop', s.ref] }, `Drop ${s.ref}?`, 'discard')
    ];
  }
  private conflictCommandCatalog(): GitMenuItem[] {
    const f = this.currentConflict();
    if (!f) return [];
    return [
      { key: '<enter>', label: '$(merge) Open merge editor', description: f.path, run: async () => { await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(workspaceRoot(), f.path)), 'mergeEditor'); } },
      { key: 'o', label: '$(file) Open file', description: f.path, run: async () => { await editPath(f.path); } },
      { key: '1', label: '$(arrow-left) Choose ours', description: 'git checkout --ours', danger: true, confirm: `Accept ours for ${f.path}?`, args: ['checkout', '--ours', '--', f.path] },
      { key: '2', label: '$(arrow-right) Choose theirs', description: 'git checkout --theirs', danger: true, confirm: `Accept theirs for ${f.path}?`, args: ['checkout', '--theirs', '--', f.path] },
      { key: 'b', label: '$(split-horizontal) Keep both / manual merge', description: 'open merge editor for both sides', run: async () => { await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(workspaceRoot(), f.path)), 'mergeEditor'); } },
      { key: 'm', label: '$(check) Mark resolved', description: 'git add', args: ['add', '--', f.path] }
    ];
  }
  private commandRegistry(viewPanel: ViewPanel): GitMenuItem[] {
    const panel = this.panelForView(viewPanel);
    let contextual: GitMenuItem[] = [];
    if (panel === 'status') contextual = this.statusCommandCatalog();
    else if (panel === 'files') contextual = this.filesCommandCatalog(viewPanel);
    else if (panel === 'hunks') contextual = this.hunkCommandCatalog(viewPanel);
    else if (panel === 'branches') contextual = this.branchCommandCatalog();
    else if (panel === 'tags') contextual = this.tagCommandCatalog();
    else if (panel === 'remotes') contextual = this.remoteCommandCatalog();
    else if (panel === 'commits') contextual = this.commitCommandCatalog();
    else if (panel === 'stash') contextual = this.stashCommandCatalog();
    else if (panel === 'conflicts') return this.conflictCommandCatalog();
    return [...this.reflogCommandCatalog(), ...contextual];
  }
  async helpCurrentPanel() { await this.helpMenu(this.activeViewPanel()); }
  private async helpMenu(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    const items = this.commandRegistry(viewPanel);
    if (!items.length) {
      vscode.window.showInformationMessage(`LazyGitVS: ${this.title(panel)} has no extra contextual commands.`);
      await this.focusPanel(this.activeViewPanel()).catch(() => undefined);
      return;
    }
    await pickGitAction(`${this.title(panel)} commands`, items.filter(item => item.key));
    await this.focusPanel(this.activeViewPanel()).catch(() => undefined);
  }
  private async stageAll() { if (!this.files.length) return; await toggleStageAll(this.files); await this.refresh(true); }
  private async commit(mode?: 'commit' | 'body' | 'amend' | 'amendNoEdit' | 'noVerify') { await commitFlow(mode); await this.refresh(true); }
  private async push() { await runGitAction('Push', ['push']); await this.refresh(true); }
  private async pull() { await runGitAction('Pull', ['pull']); await this.refresh(true); }
  private async fetch() { await runGitAction('Fetch', ['fetch']); await this.refresh(true); }
  async reflogUndo() { if (!this.reflogActionBlockedOnCurrentSurface()) return this.runReflogAction('undo'); }
  async reflogRedo() { if (!this.reflogActionBlockedOnCurrentSurface()) return this.runReflogAction('redo'); }
  private reflogActionBlockedOnCurrentSurface(): boolean { return this.editorHunkMode || this.editorEditMode || this.panelForView(this.activeViewPanel()) === 'conflicts'; }
  private async runReflogAction(direction: ReflogDirection) {
    this.loadLazyGitConfig();
    try {
      const root = workspaceRoot();
      recordDogfoodBoundary('reflogAction:planned', { direction, root });
      const changed = await planAndPerformReflogAction(root, direction, async (prompt, title) => { recordDogfoodBoundary('reflogAction:modal', { direction, root, prompt, title }); const accepted = await vscode.window.showWarningMessage(prompt, { modal: true }, title) === title; if (accepted) { this.statusLine = direction === 'undo' ? 'Undoing' : 'Redoing'; this.renderAll(); } return accepted; });
      if (changed) await this.refresh(true);
    } finally { this.statusLine = ''; this.renderAll(); }
  }
  private async runCommitCommand(typed: string) {
    const commit = this.currentCommit();
    const k = this.lazygitKeymap.commits, u = this.lazygitKeymap.universal;
    const key = (value: string | string[] | undefined) => this.keyLabel(value);
    if (commit && findMenuItemByKey([{ key: key(k.viewBisectOptions) || 'b', label: 'View bisect options' }], typed)) { try { await this.openBisectOptions(commit); } finally { await this.restorePanelFocusAfterModal('commits'); } return; }
    const cherryPickBufferAction = !!findMenuItemByKey([{ key: key(k.cherryPickCopy) || 'C', label: 'Copy/toggle commit range' }, { key: key(k.pasteCommits) || 'V', label: 'Paste copied commits' }, { key: key(k.resetCherryPick) || '<ctrl+r>', label: 'Reset copied commits' }], typed); const dropAction = !!findMenuItemByKey([{ key: key(u.remove) || 'd', label: 'Drop selected commit(s)' }], typed); const squashAction = !!findMenuItemByKey([{ key: key(k.squashDown) || 's', label: 'Squash selected commit(s)' }], typed); const fixupAction = !!findMenuItemByKey([{ key: key(k.markCommitAsFixup) || 'f', label: 'Fixup selected commit(s)' }], typed); const autosquashAction = !!findMenuItemByKey([{ key: key(k.squashAboveCommits) || 'S', label: 'Apply fixup commits' }], typed); const moveAction = !!findMenuItemByKey([{ key: key(k.moveDownCommit) || '<ctrl+j>', label: 'Move commit down one' }, { key: key(k.moveUpCommit) || '<ctrl+k>', label: 'Move commit up one' }], typed); const editAction = !!findMenuItemByKey([{ key: key(u.edit) || 'e', label: 'Edit selected commit(s)' }], typed); if ((cherryPickBufferAction || dropAction || squashAction || fixupAction || autosquashAction) && this.commitFilesController.commit) return; if (moveAction && this.commitFilesController.commit) return; if (editAction && this.commitFilesController.commit) return; const item = findMenuItemByKey(this.commitCommandCatalog(), typed); if (!item) return;
    try {
      await executeGitMenuItem(item);
      if (!cherryPickBufferAction && !dropAction && !squashAction && !fixupAction) await this.refresh(false);
    } finally {
      await this.restorePanelFocusAfterModal('commits');
    }
  }
  private async runPanelCommand(viewPanel: ViewPanel, typed: string) {
    const item = findMenuItemByKey(this.commandRegistry(viewPanel), typed);
    if (!item) return;
    try {
      if (this.panelForView(viewPanel) === 'branches') await this.resetCommitFilesState(false);
      await executeGitMenuItem(item);
      await this.refresh(false);
    } finally {
      await this.restorePanelFocusAfterModal(viewPanel);
    }
  }
  private async stashAll() { await runGitAction('Stash all changes', ['stash', 'push']); await this.refresh(true); }
  private async runMenu(menu: () => Promise<unknown>, viewPanel: ViewPanel = this.activeViewPanel()) { try {
      await menu();
      await this.refresh(false);
    } finally {
      await this.restorePanelFocusAfterModal(viewPanel);
    }
  }
  private async resetToUpstreamMenu(viewPanel: ViewPanel) { const repoPath = workspaceRoot(); await this.runMenu(() => showResetToUpstreamMenu(repoPath), viewPanel); }
  private async discardMenu(viewPanel: ViewPanel) {
    const panel = this.panelForView(viewPanel);
    try {
      if (panel === 'hunks') { const h = this.hunks[this.hunkSelected]; if (!h) return; if (this.hunkSelectionMode === 'line') { const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected]; if (line !== undefined) { if (h.staged) await applyLine(h, line); else { const ok = await vscode.window.showWarningMessage('Discard selected line?', { modal: true }, 'Discard'); if (ok !== 'Discard') return; await discardUnstagedLine(h, line); } } } else await showDiscardHunkMenu(h); await this.loadHunks(false); await this.refresh(false); return; }
      if (panel === 'files') { const f = this.currentFile(); if (!f) return; await showDiscardFileMenu(f, String(this.lazygitKeymap.files.confirmDiscard ?? 'x')); await this.refresh(false); }
    } finally {
      await this.restorePanelFocusAfterModal(viewPanel);
    }
  }
  private async enterHunks() {
    const file = this.currentFile();
    if (!file) return;
    this.previousPanel = 'files'; this.activePanel = 'files'; this.ownsModeStatus = false; this.editorEditMode = false; this.editorModeFilePath = file.path; this.hunkSide = 'unstaged'; this.hunkSelectionMode = this.lazygitGui.useHunkModeInStagingView ? 'hunk' : 'line'; this.hunkSelected = 0; this.hunkLineSelected = 0; await this.loadHunks(true);
    if (!this.hunks.length && this.allHunks.some(h => h.staged)) { this.hunkSide = 'staged'; this.filterHunks(); }
    await vscode.commands.executeCommand('setContext', 'lazygitvs.editorEditMode', false);
    await this.setEditorHunkMode(true);
    this.statusLine = 'Editor HUNK mode: j/k move · space stage · a line · tab staged · d discard · Esc back';
    this.persistNavigationState();
    this.renderAll();
    await editPath(file.path);
    await this.forceEditorFocus();
    await this.revealEditorHunk();
    setTimeout(() => void this.forceEditorFocus().then(() => this.revealEditorHunk()), 80);
  }
  async editorNextHunk(delta: number) {
    if (!this.editorHunkMode) return;
    const wrap = (value: number, length: number) => length ? ((value % length) + length) % length : 0;
    if (this.hunkSelectionMode === 'line') {
      const h = this.hunks[this.hunkSelected];
      const len = h ? hunkSelectableLineIndexes(h).length : 0;
      if (len && this.hunkLineSelected + delta >= 0 && this.hunkLineSelected + delta < len) this.hunkLineSelected += delta;
      else { this.hunkSelected = wrap(this.hunkSelected + delta, this.hunks.length); this.hunkLineSelected = delta > 0 ? 0 : Math.max(0, (this.hunks[this.hunkSelected] ? hunkSelectableLineIndexes(this.hunks[this.hunkSelected]).length : 1) - 1); }
    } else {
      this.hunkSelected = wrap(this.hunkSelected + delta, this.hunks.length);
    }
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.renderAll();
    await this.revealEditorHunk();
  }
  async editorToggleHunk() {
    if (!this.editorHunkMode) return;
    if (this.readOnlyHunkMode) { this.statusLine = 'Commit diff is read-only: j/k move · a line · Esc back'; this.updateModeStatusBar(); this.renderAll(); return; }
    const h = this.hunks[this.hunkSelected]; if (!h) return;
    let preferredEditorLine: number | undefined;
    if (this.hunkSelectionMode === 'line') {
      const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected];
      if (line === undefined) return;
      preferredEditorLine = hunkChangedEditorLine(h, line);
      await applyLine(h, line);
    } else await applyHunk(h);
    await this.loadHunks(false);
    await this.refresh(false);
    if (preferredEditorLine !== undefined) this.selectNearestLineToEditorLine(preferredEditorLine);
    await this.revealEditorHunk();
  }
  async editorDiscardHunk() {
    if (!this.editorHunkMode) return;
    if (this.readOnlyHunkMode) { this.statusLine = 'Commit diff is read-only: j/k move · a line · Esc back'; this.updateModeStatusBar(); this.renderAll(); return; }
    const h = this.hunks[this.hunkSelected]; if (!h) return;
    let preferredEditorLine: number | undefined;
    if (h.staged && this.hunkSelectionMode === 'line') {
      const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected];
      if (line === undefined) return;
      preferredEditorLine = hunkChangedEditorLine(h, line);
      await applyLine(h, line);
    } else if (h.staged) { await applyHunk(h); }
    else if (this.hunkSelectionMode === 'line') {
      const line = hunkSelectableLineIndexes(h)[this.hunkLineSelected];
      if (line === undefined) return;
      preferredEditorLine = hunkChangedEditorLine(h, line);
      const ok = await vscode.window.showWarningMessage('Discard selected line?', { modal: true }, 'Discard');
      if (ok !== 'Discard') return;
      await discardUnstagedLine(h, line);
    } else await showDiscardHunkMenu(h);
    await this.loadHunks(false);
    await this.refresh(false);
    if (preferredEditorLine !== undefined) this.selectNearestLineToEditorLine(preferredEditorLine);
    await this.revealEditorHunk();
  }
  async editorToggleHunkSelectionMode() {
    if (!this.editorHunkMode) return;
    this.hunkSelectionMode = this.hunkSelectionMode === 'hunk' ? 'line' : 'hunk';
    this.hunkLineSelected = 0;
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.updateEditorHunkDecorations();
    await this.revealEditorHunk();
  }
  async editorHunkHelp() {
    if (!this.editorHunkMode) return;
    await pickGitAction('HUNK/LINE commands', this.hunkCommandCatalog(this.activeViewPanel()).filter(item => item.key));
    await this.forceEditorFocus();
  }
  async editorToggleHunkSide() {
    if (!this.editorHunkMode) return;
    this.hunkSide = this.hunkSide === 'unstaged' ? 'staged' : 'unstaged';
    this.hunkSelected = 0; this.hunkLineSelected = 0;
    this.filterHunks();
    this.statusLine = `${this.hunkSide === 'staged' ? 'Staged' : 'Unstaged'} changes${this.hunks.length ? '' : ': none'}`;
    this.persistNavigationState();
    this.updateModeStatusBar();
    this.updateEditorHunkDecorations();
    this.renderAll();
    await this.revealEditorHunk();
  }
  async enterEditorEditMode() {
    if (!this.editorHunkMode) return;
    const filePath = this.editorModeFilePath ?? this.currentFile()?.path;
    await this.releaseEditorOwnership();
    if (filePath) await editPath(filePath);
    await this.forceEditorFocus();
    await this.placeCursorAtEditorHunkStart();
    setTimeout(() => void this.forceEditorFocus().then(() => this.placeCursorAtEditorHunkStart()), 80);
    setTimeout(() => void this.forceEditorFocus().then(() => this.placeCursorAtEditorHunkStart()), 220);
    setTimeout(() => void this.forceEditorFocus().then(() => this.placeCursorAtEditorHunkStart()), 450);
    setTimeout(() => { if (!this.editorHunkMode && !this.editorEditMode) this.suppressWebviewAutoFocusUntil = 0; }, 2600);
  }
  async editorHunkNoop() {}
  private async forceEditorFocus(shouldContinue: () => boolean = () => true) {
    if (!shouldContinue()) return;
    try { await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'); } catch { /* ignore */ }
    if (!shouldContinue()) return;
    const editor = vscode.window.activeTextEditor;
    if (editor) await vscode.window.showTextDocument(editor.document, editor.viewColumn ?? vscode.ViewColumn.Active, false);
    if (!shouldContinue()) return;
  }
  async exitEditorHunkMode() {
    const filePath = this.editorModeFilePath ?? this.currentFile()?.path;
    if (this.readOnlyHunkMode && this.commitFilesController.commit) { this.activePanel = 'commits'; this.ownsModeStatus = true; this.setFocusArea('panel'); await this.setEditorHunkMode(false); await this.updateActiveViewContext(); this.requestWebviewAutoFocus(); this.renderAll(); await this.revealPanelView('commits'); this.updateModeStatusBar(); return; }
    this.activePanel = 'files';
    this.ownsModeStatus = true;
    this.setFocusArea('panel');
    await this.setEditorHunkMode(false);
    this.selectFilePathInFilesPanel(filePath);
    await this.updateActiveViewContext();
    this.requestWebviewAutoFocus();
    this.statusLine = '';
    this.renderAll();
    await this.revealPanelView('files');
    this.ownsModeStatus = true;
    this.setFocusArea('panel');
    this.requestWebviewAutoFocus();
    this.renderAll();
    setTimeout(() => {
      if (this.editorHunkMode || this.activePanel !== 'files') return;
      this.ownsModeStatus = true;
      this.setFocusArea('panel');
      this.requestWebviewAutoFocus();
      this.renderAll();
    }, 120);
  }
  private selectNearestLineToEditorLine(targetLine: number) {
    const h = this.hunks[this.hunkSelected];
    const changed = h ? hunkSelectableLineIndexes(h) : [];
    if (!h || !changed.length) { this.hunkLineSelected = 0; return; }
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    changed.forEach((diffIndex, index) => {
      const distance = Math.abs(hunkChangedEditorLine(h, diffIndex) - targetLine);
      if (distance < bestDistance) { best = index; bestDistance = distance; }
    });
    this.hunkLineSelected = best;
  }
  private async revealEditorHunk(shouldContinue: () => boolean = () => true) {
    if (!shouldContinue()) return;
    const h = this.hunks[this.hunkSelected];
    if (!h) { this.updateEditorHunkDecorations(); return; }
    const editor = vscode.window.activeTextEditor;
    if (!editor || !shouldContinue()) return;
    const changed = hunkSelectableLineIndexes(h);
    const targetLine = changed.length ? hunkChangedEditorLine(h, changed[clamp(this.hunkLineSelected, changed.length)]) : hunkStartLine(h);
    const line = Math.min(targetLine, Math.max(0, editor.document.lineCount - 1));
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    if (shouldContinue()) this.updateEditorHunkDecorations();
  }
  private async placeCursorAtEditorHunkStart() {
    const h = this.hunks[this.hunkSelected];
    const editor = vscode.window.activeTextEditor;
    if (!h || !editor) return;
    const changed = hunkSelectableLineIndexes(h);
    const targetLine = changed.length ? hunkChangedEditorLine(h, changed[clamp(this.hunkLineSelected, changed.length)]) : hunkStartLine(h);
    const line = Math.min(targetLine, Math.max(0, editor.document.lineCount - 1));
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  private clearEditorHunkDecorations() {
    for (const editor of vscode.window.visibleTextEditors) this.clearEditorHunkDecorationsFor(editor);
  }
  private clearEditorHunkDecorationsFor(editor: vscode.TextEditor) {
    editor.setDecorations(this.unstagedHunkDecoration, []);
    editor.setDecorations(this.stagedHunkDecoration, []);
    editor.setDecorations(this.activeUnstagedHunkDecoration, []);
    editor.setDecorations(this.activeStagedHunkDecoration, []);
    editor.setDecorations(this.activeUnstagedLineDecoration, []);
    editor.setDecorations(this.activeStagedLineDecoration, []);
    editor.setDecorations(this.deletedGhostDecoration, []);
    editor.setDecorations(this.unstagedGutterDecoration, []);
    editor.setDecorations(this.stagedGutterDecoration, []);
  }
  private updateEditorHunkDecorations() {
    const editor = vscode.window.activeTextEditor;
    this.clearEditorHunkDecorations();
    if (!editor) return;
    const previewFile = this.activePanel === 'files' && !this.editorEditMode ? this.currentFile()?.path : undefined;
    const targetFile = this.editorModeFilePath ?? previewFile;
    const shouldDecorate = this.editorHunkMode;
    if (!shouldDecorate) return;
    if (targetFile && editor.document.uri.fsPath !== path.join(workspaceRoot(), targetFile)) return;
    const active = this.hunks[this.hunkSelected];
    const blockedByUnstaged = active?.staged ? rangeLineSet(this.allHunks.filter(h => !h.staged).flatMap(h => hunkChangedEditorRanges(h, editor))) : new Set<number>();
    const hunkRanges = excludeRangeLines(this.hunks.flatMap(h => hunkChangedEditorRanges(h, editor)), blockedByUnstaged);
    const rawActiveRange = active ? hunkChangedEditorRanges(active, editor) : [];
    const activeRange = active?.staged ? excludeRangeLines(rawActiveRange, blockedByUnstaged) : rawActiveRange;
    const changed = active ? hunkSelectableLineIndexes(active) : [];
    const activeLineIndex = active && changed.length ? hunkChangedEditorLine(active, changed[clamp(this.hunkLineSelected, changed.length)]) : undefined;
    const rawActiveLine = activeLineIndex !== undefined ? [editorLineRange(editor, activeLineIndex)] : [];
    const activeLine = active?.staged ? excludeRangeLines(rawActiveLine, blockedByUnstaged) : rawActiveLine;
    editor.setDecorations(this.unstagedHunkDecoration, active?.staged ? [] : hunkRanges);
    editor.setDecorations(this.stagedHunkDecoration, active?.staged ? hunkRanges : []);
    editor.setDecorations(this.activeUnstagedHunkDecoration, !active?.staged && this.hunkSelectionMode !== 'line' ? activeRange : []);
    editor.setDecorations(this.activeStagedHunkDecoration, active?.staged && this.hunkSelectionMode !== 'line' ? activeRange : []);
    editor.setDecorations(this.activeUnstagedLineDecoration, !active?.staged && this.hunkSelectionMode === 'line' ? activeLine : []);
    editor.setDecorations(this.activeStagedLineDecoration, active?.staged && this.hunkSelectionMode === 'line' ? activeLine : []);
    editor.setDecorations(this.deletedGhostDecoration, this.hunks.flatMap(h => deletedGhostDecorations(h, editor)));
    if (!this.editorHunkMode) return;
    const markerLine = activeLine[0]?.start.line ?? activeRange[0]?.start.line;
    const marker = active && markerLine !== undefined ? [{ range: new vscode.Range(markerLine, 0, markerLine, 0), hoverMessage: `${active.staged ? 'S staged' : 'U unstaged'} · ${this.hunkSelectionMode.toUpperCase()}` }] : [];
    editor.setDecorations(this.unstagedGutterDecoration, active?.staged ? [] : marker);
    editor.setDecorations(this.stagedGutterDecoration, active?.staged ? marker : []);
  }
  private async toggleHunkPanel() { if (this.activePanel !== 'hunks' && !this.editorHunkMode) return; this.hunkSide = this.hunkSide === 'unstaged' ? 'staged' : 'unstaged'; this.hunkSelected = 0; this.hunkLineSelected = 0; this.filterHunks(); this.updateModeStatusBar(); this.updateEditorHunkDecorations(); this.renderAll(); }
  private showPendingLineMode() { if (this.activePanel !== 'hunks' && !this.editorHunkMode) return; this.hunkSelectionMode = this.hunkSelectionMode === 'hunk' ? 'line' : 'hunk'; this.hunkLineSelected = 0; this.statusLine = this.hunkSelectionMode === 'line' ? 'Line mode' : 'Hunk mode'; this.updateModeStatusBar(); this.updateEditorHunkDecorations(); this.renderAll(); }
  private async loadHunks(showMessage: boolean) { const f = this.currentFile(); this.allHunks = f ? await hunksForFile(f, this.lazygitGit) : []; this.filterHunks(); this.hunkSelected = clamp(this.hunkSelected, this.hunks.length); if (showMessage && f?.untracked) vscode.window.showInformationMessage('LazyGitVS: untracked file has no hunks yet; space stages whole file.'); }
  private filterHunks() { this.hunks = this.allHunks.filter(h => this.hunkSide === 'staged' ? h.staged : !h.staged); }
  private async openCurrent(viewPanel: ViewPanel, preserveFocus: boolean, forceListPreview = false, scheduledFilesPreview?: { epoch: number; filePath?: string }) {
    if (!scheduledFilesPreview) this.cancelFilesPreview();
    if (!preserveFocus) { this.ownsModeStatus = false; this.setFocusArea('viewer'); this.renderAll(); }
    const panel = this.panelForView(viewPanel);
    if ((this.editorHunkMode || this.editorEditMode) && (panel === 'files' || panel === 'hunks')) {
      if (!forceListPreview) return;
      await this.setEditorHunkMode(false);
      this.statusLine = '';
      this.activePanel = 'files';
    }
    if (panel === 'files' || panel === 'hunks') {
      const f = this.currentFile();
      if (f) { if (scheduledFilesPreview && (scheduledFilesPreview.epoch !== this.filesPreviewEpoch || f.path !== scheduledFilesPreview.filePath)) return;
        const previewHunks = await hunksForFile(f, this.lazygitGit).catch(() => []); if (scheduledFilesPreview && (scheduledFilesPreview.epoch !== this.filesPreviewEpoch || this.currentFile()?.path !== scheduledFilesPreview.filePath)) return;
        this.allHunks = previewHunks;
        this.hunkSide = previewHunks.some(h => !h.staged) ? 'unstaged' : 'staged';
        this.filterHunks();
        this.hunkSelected = 0;
        this.hunkLineSelected = 0;
        const shown = await previewDiff(f, preserveFocus, () => !scheduledFilesPreview || (scheduledFilesPreview.epoch === this.filesPreviewEpoch && this.currentFile()?.path === scheduledFilesPreview.filePath));
        if (!shown) return;
        const firstHunk = previewHunks[0];
        if (firstHunk) revealVisibleEditorLine(f.path, hunkStartLine(firstHunk));
        this.updateEditorHunkDecorations();
      }
    }
    else if (panel === 'branches') { const b = this.currentBranch(); if (b) await showText(`LazyGitVS Branch ${b.name}`, await git(branchLogArgs(this.lazygitGit, b.name)), preserveFocus, preserveFocus); }
    else if (panel === 'conflicts') { const f = this.currentConflict(); if (f) await previewDiff(f, preserveFocus); }
    else if (panel === 'commits') {
      if (this.commitFilesController.active) {
        const f = this.commitFilesController.currentFile(this.lazygitGui);
        const owner = this.commitFilesController.owner;
        const previewToken = this.commitFilesController.beginPreview();
        if (f && owner && previewToken && this.commitFilesController.commit) await previewCommitFileDiff(this.commitFilesController.commit, f, preserveFocus, () => this.commitFilesController.previewCurrent(previewToken), owner.repoPath);
      } else {
        const c = this.currentCommit();
        if (c) await showCommitPreview(c, this.lazygitGit, preserveFocus);
      }
    }
    if (panel === 'stash') {
      if (this.stashFilesFor) {
        const f = this.stashFileItems[this.stashFileSelected];
        if (f) await previewStashFileDiff(this.stashFilesFor, f, preserveFocus);
      } else {
        const s = this.currentStash();
        if (s) await showStashPreview(s, this.lazygitGit, preserveFocus);
      }
    }
  }
  private diffArgs(...args: string[]): string[] { return ['diff', ...gitDiffConfigArgs(this.lazygitGit, true), ...args]; }
  private showArgs(...args: string[]): string[] { return ['show', ...gitDiffConfigArgs(this.lazygitGit, true), ...args]; }
  private async enterBranchCommits() {
    const b = this.currentBranch();
    if (!b) return;
    await this.resetCommitFilesState(false); this.commitListForBranch = b;
    this.commitSelected = 0;
    this.commitItems = await commits(b.name);
    this.statusLine = `Commits for ${b.name}`;
    this.renderAll();
    await this.focusPanel('commits');
    await this.openCurrent('commits', true).catch(() => undefined);
  }
  private async enterCommit(activationCurrent: () => boolean = () => true) {
    if (this.commitFilesController.active) { if (await this.toggleCurrentCommitFileTreeNode()) return; const f = this.commitFilesController.currentFile(this.lazygitGui); if (f) return this.enterCommitFileHunkMode(f); return; }
    const c = this.currentCommit(); if (!c) return; if (!canInspectSingleCommit(this.commitRange.mode)) return void vscode.window.showErrorMessage(COMMIT_FILE_RANGE_MESSAGE);
    if (!await this.commitFilesController.loadCommit(c, activationCurrent)) return;
    this.renderAll(); await this.openCurrent('commits', true);
  }
  private async checkoutCurrentCommitFile() {
    const owner = this.commitFilesController.owner; if (!owner || !this.commitFilesController.ownerIsCurrent(owner)) return;
    await this.commitFilesController.checkoutCurrent({
      onSuccess: async () => { await this.refresh(true); if (this.commitFilesController.sessionIsCurrent(owner)) await this.restorePanelFocusAfterModal('commits', () => this.commitFilesController.sessionIsCurrent(owner)); },
    });
  }
  private async enterCommitFileHunkMode(file: CommitFile) {
    await this.commitFilesController.enterHunk(file, {
      showArgs: (...args) => this.showArgs(...args),
      useHunkModeInStagingView: this.lazygitGui.useHunkModeInStagingView,
      applyHunkState: (patch, filePath) => Object.assign(this, readOnlyCommitFileHunkState(patch, filePath, this.lazygitGui.useHunkModeInStagingView)),
      setEditorHunkMode: (active, ownerId, prepare) => this.setEditorHunkMode(active, ownerId, prepare),
      clearHunkState: () => { this.readOnlyHunkMode = false; this.editorModeFilePath = undefined; this.clearEditorHunkDecorations(); },
      render: () => this.renderAll(),
      showText: async (title, content, preview, preserveFocus, hunkCurrent) => { await this.editorPublicationGate.request(async publicationCurrent => { const isCurrent = () => publicationCurrent() && hunkCurrent(); if (isCurrent()) await showText(title, content, preserveFocus, preview, isCurrent); }); },
      forceEditorFocus: hunkCurrent => this.forceEditorFocus(hunkCurrent),
      revealEditorHunk: hunkCurrent => this.revealEditorHunk(hunkCurrent),
    });
  }
  private async discardCurrentCommitFile() {
    await this.commitFilesController.discardCurrent({
      rangeMode: this.commitRange.mode,
      isLocalCommits: !this.commitListForBranch,
      confirm: async (title, prompt) => await vscode.window.showWarningMessage(prompt, { modal: true, detail: title }, title) === title,
      onStart: () => { this.statusLine = 'Rebasing'; },
      onSuccess: async () => { await this.resetCommitFilesState(false); this.statusLine = 'Discarded selected changes from commit'; await this.refresh(true); },
      onOutcome: async message => { this.statusLine = message; await vscode.window.showWarningMessage(message); },
      onError: async error => { await vscode.window.showErrorMessage(error.message); },
      onFinally: async () => { if (this.statusLine === 'Rebasing') this.statusLine = ''; this.clampSelections(); this.renderAll(); await this.restorePanelFocusAfterModal('commits', () => this.commitFilesController.active); },
    });
  }
  private async copyCurrentCommitFileInfo() {
    await this.commitFilesController.copyCurrent({ gitConfig: this.lazygitGit, copyText, pickMenu: pickGitAction, restoreFocus: async () => { await this.restorePanelFocusAfterModal('commits', () => this.commitFilesController.active); } });
  }
  private async enterStash() {
    if (this.stashFilesFor) {
      const f = this.stashFileItems[this.stashFileSelected];
      if (f && this.stashFilesFor) await previewStashFileDiff(this.stashFilesFor, f, false);
      return;
    }
    const s = this.currentStash(); if (!s) return showStashCreateMenu();
    this.stashFilesFor = s;
    this.stashFileItems = await stashFiles(s.ref);
    this.stashFileSelected = 0;
    this.renderAll();
    await this.openCurrent('stash', true);
  }
  private async clearFilterOrBack(viewPanel: ViewPanel) {
    if (this.filterText) { this.filterText = ''; this.selectionEpoch++; this.commitFilesController.invalidateTransient({ selectionEpoch: this.selectionEpoch, selectedRowIdentity: commitFilesRowIdentity(this.commitFilesController.currentRow(this.lazygitGui)), filterText: this.filterText }); this.clampSelections(); this.persistNavigationState(); this.renderAll(); await this.openCurrent(viewPanel, true).catch(() => undefined); return; }
    await this.back(viewPanel);
  }
  private async searchPanel() {
    const value = await vscode.window.showInputBox({ title: `Search ${this.title(this.activePanel)}`, value: this.filterText, prompt: 'Empty clears the filter.' });
    if (value === undefined) return;
    this.filterText = value;
    this.selectionEpoch++;
    this.commitFilesController.invalidateTransient({ selectionEpoch: this.selectionEpoch, selectedRowIdentity: commitFilesRowIdentity(this.commitFilesController.currentRow(this.lazygitGui)), filterText: this.filterText });
    this.clampSelections();
    this.renderAll();
  }
  private async statusFilterMenu() {
    const item = await vscode.window.showQuickPick([
      { label: 'r No filter', value: 'all' as const },
      { label: 's Filter staged files', value: 'staged' as const },
      { label: 'u Filter unstaged files', value: 'unstaged' as const },
      { label: 't Filter tracked files', value: 'tracked' as const },
      { label: 'T Filter untracked files', value: 'untracked' as const },
    ], { title: 'Filtering menu' });
    if (!item) return;
    this.fileStatusFilter = item.value;
    this.selected = 0;
    this.selectionEpoch++;
    this.commitFilesController.invalidateTransient({ selectionEpoch: this.selectionEpoch, selectedRowIdentity: commitFilesRowIdentity(this.commitFilesController.currentRow(this.lazygitGui)), filterText: this.filterText });
    this.renderAll();
  }
  private async diffingMenu() {
    const u = this.lazygitKeymap.universal as any;
    await pickGitAction('Diffing menu', [
      { key: this.keyLabel(u.toggleWhitespaceInDiffView) || '<ctrl+w>', label: '$(whitespace) Toggle whitespace in diff view', description: this.lazygitGit.ignoreWhitespaceInDiffView ? 'currently ignoring whitespace' : 'currently showing whitespace', run: async () => { this.lazygitGit.ignoreWhitespaceInDiffView = !this.lazygitGit.ignoreWhitespaceInDiffView; this.statusLine = `Whitespace ${this.lazygitGit.ignoreWhitespaceInDiffView ? 'ignored' : 'shown'}`; } },
      { key: this.keyLabel(u.increaseContextInDiffView) || '}', label: '$(add) Increase diff context size', description: String(this.lazygitGit.diffContextSize), run: async () => { this.lazygitGit.diffContextSize = Math.min(99, Number(this.lazygitGit.diffContextSize || 0) + 1); this.statusLine = `Diff context: ${this.lazygitGit.diffContextSize}`; } },
      { key: this.keyLabel(u.decreaseContextInDiffView) || '{', label: '$(remove) Decrease diff context size', description: String(this.lazygitGit.diffContextSize), run: async () => { this.lazygitGit.diffContextSize = Math.max(0, Number(this.lazygitGit.diffContextSize || 0) - 1); this.statusLine = `Diff context: ${this.lazygitGit.diffContextSize}`; } },
      { key: this.keyLabel(u.increaseRenameSimilarityThreshold) || ')', label: '$(diff-renamed) Increase rename similarity threshold', description: String(this.lazygitGit.renameSimilarityThreshold), run: async () => { this.lazygitGit.renameSimilarityThreshold = Math.min(100, Number(this.lazygitGit.renameSimilarityThreshold || 0) + 5); this.statusLine = `Rename similarity: ${this.lazygitGit.renameSimilarityThreshold}%`; } },
      { key: this.keyLabel(u.decreaseRenameSimilarityThreshold) || '(', label: '$(diff-renamed) Decrease rename similarity threshold', description: String(this.lazygitGit.renameSimilarityThreshold), run: async () => { this.lazygitGit.renameSimilarityThreshold = Math.max(0, Number(this.lazygitGit.renameSimilarityThreshold || 0) - 5); this.statusLine = `Rename similarity: ${this.lazygitGit.renameSimilarityThreshold}%`; } },
    ]);
    await this.refresh(true);
    await this.restorePanelFocusAfterModal(this.activeViewPanel());
  }
  private async conflictMenu() {
    const f = this.currentConflict();
    if (!f) return;
    await pickGitAction(`Merge conflicts · ${f.path}`, this.conflictCommandCatalog());
    await this.refresh(true);
  }
  private async branchMenu() {
    await pickGitAction('Branch options', this.branchCommandCatalog());
    await this.refresh(true);
  }
  private async tagMenu() {
    await pickGitAction('Tag options', this.tagCommandCatalog());
    await this.refresh(true);
  }
  private async remoteMenu() {
    await pickGitAction('Remote options', this.remoteCommandCatalog());
    await this.refresh(true);
  }
  private async stashItemMenu() {
    const s = this.currentStash();
    await pickGitAction(s ? `${s.ref}` : 'Stash options', this.stashCommandCatalog());
    await this.refresh(true);
  }
  private async animateExplosion() {
    this.explosion = true; this.statusLine = 'Nuking working tree…'; this.renderAll();
    await new Promise(resolve => setTimeout(resolve, 850));
    this.explosion = false; this.statusLine = '💥 Nuked working tree'; this.renderAll();
  }
  private renderAll() { this.persistNavigationState(); this.statusTreeProvider?.refresh(); for (const panel of PANEL_ORDER) this.render(panel); }
  private renderFocusedPanels(previousViewPanel: ViewPanel, activeViewPanel: ViewPanel) { this.persistNavigationState(); if (previousViewPanel === 'status' || activeViewPanel === 'status') this.statusTreeProvider?.refresh(); if (previousViewPanel !== activeViewPanel) this.render(previousViewPanel); this.render(activeViewPanel); }
  private renderActivePanel(viewPanel: ViewPanel) { this.persistNavigationState(); if (viewPanel === 'status') this.statusTreeProvider?.refresh(); this.render(viewPanel); }
  private render(viewPanel: ViewPanel) {
    const view = this.views.get(viewPanel);
    if (!view) return;
    const panel = this.panelForView(viewPanel);
    const title = this.title(panel);
    const isActiveView = this.activeViewPanel() === viewPanel;
    const shouldFocus = this.consumeWebviewAutoFocus(viewPanel);
    const commitFilesCapability = viewPanel === 'commits' && this.commitFilesController.active ? this.commitFilesController.capabilityForRender() : undefined;
    const showPanelSelection = isActiveView && this.focusArea === 'panel';
    const rows = this.rows(panel, showPanelSelection);
    const selectedRowId = activeDescendantId(true, panel === 'status' ? 0 : this.activeIndex(panel), panel === 'status' ? 1 : this.activeLength(panel)), activeRowId = showPanelSelection ? selectedRowId : '';
    const footer = '';
    const boom = this.explosion && (viewPanel === 'status' || viewPanel === 'files') ? '<div class="boom"><div class="bomb">💣</div><div class="blast">💥</div></div>' : '';
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = webviewContentSecurityPolicy(view.webview, nonce);
    try { view.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
      html,body{height:100%;margin:0;}body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);line-height:1.4;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);overflow:hidden;}
      .root{position:relative;height:100%;display:flex;flex-direction:column;}.title{display:${panel === viewPanel ? 'none' : 'block'};padding:4px 8px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-sideBarSectionHeader-border);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.rows{overflow:auto;flex:1;padding:2px 0;}
      .virtual-spacer{height:var(--virtual-height,0px);pointer-events:none;}
      .root.wrap-staging .row.hunk{height:auto;min-height:20px;white-space:normal;align-items:start;padding-top:2px;padding-bottom:2px}.root.wrap-staging .row.hunk .path{overflow:visible;text-overflow:clip;white-space:normal}.row{display:grid;grid-template-columns:7px 36px minmax(0,1fr) minmax(0,20%);align-items:center;column-gap:2px;height:20px;padding:0 2px;box-sizing:border-box;white-space:nowrap;min-width:0;color:var(--vscode-list-foreground,var(--vscode-foreground));cursor:default;}.row.file{grid-template-columns:7px 28px minmax(0,1fr);}.row.branch{grid-template-columns:7px 18px minmax(0,1fr) minmax(0,42px);}.row.commit{grid-template-columns:7px 44px minmax(0,1fr);}.branch-row{grid-template-columns:7px 16px minmax(0,1fr) max-content;column-gap:4px}.commit-row{grid-template-columns:7px 44px minmax(0,1fr) max-content;column-gap:4px}.row.commit .meta{display:none}.commit-row .meta{display:block}.row.sel{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);outline:1px solid var(--vscode-list-focusOutline);outline-offset:-1px;}.row.range:not(.sel){background:var(--vscode-list-inactiveSelectionBackground);}.row.commit-row.copied:not(.sel){box-shadow:inset 2px 0 0 var(--vscode-textLink-foreground);}.row:not(.sel):hover{background:var(--vscode-list-hoverBackground);}.cursor{width:7px;color:var(--vscode-focusBorder);}.status{color:var(--vscode-descriptionForeground);font-size:11px;overflow:hidden;text-overflow:clip;}.path,.summary{overflow:hidden;text-overflow:ellipsis;min-width:0;}.meta{opacity:.68;margin-left:2px;overflow:hidden;text-overflow:ellipsis;justify-self:end;min-width:0;font-size:10px;}.empty{color:var(--vscode-descriptionForeground);padding:4px 6px;}
      .ref-kind{display:inline-grid;place-items:center;width:14px;height:14px;border-radius:3px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:10px;font-weight:700}.branch-row.current .ref-kind{background:var(--vscode-list-highlightForeground);color:var(--vscode-sideBar-background)}.branch-name{font-weight:500}.branch-meta,.commit-meta{color:var(--vscode-descriptionForeground);opacity:1}.hash-pill{font-family:var(--vscode-editor-font-family);font-size:10px;border-radius:3px;padding:1px 3px;background:var(--vscode-editorInlayHint-background);color:var(--vscode-editorInlayHint-foreground);overflow:hidden;text-overflow:ellipsis}.commit-main{font-weight:500}.row.sel .hash-pill,.row.sel .ref-kind{color:var(--vscode-list-activeSelectionForeground);border-color:var(--vscode-list-activeSelectionForeground)}
      .status-pair{display:grid;grid-template-columns:12px 12px;column-gap:2px;align-items:center;font-family:var(--vscode-editor-font-family);font-size:10px}.slot{display:inline-grid;place-items:center;width:12px;height:14px;border-radius:2px;font-size:10px;font-weight:700;line-height:1;box-sizing:border-box;color:var(--vscode-button-foreground,#fff)}.slot.empty{visibility:hidden;background:transparent;border-color:transparent;box-shadow:none}.slot.index{background:var(--vscode-gitDecoration-addedResourceForeground,#6a9955)}.slot.worktree{background:var(--vscode-gitDecoration-modifiedResourceForeground,#e06c75)}.slot.deleted,.slot.conflict{background:var(--vscode-errorForeground,#f85149)}.slot.untracked{background:var(--vscode-gitDecoration-untrackedResourceForeground,#d7ba7d);color:var(--vscode-sideBar-background,#1e1e1e)}.row.dir,.row.file.tree{grid-template-columns:7px minmax(0,1fr);}.tree-line{display:inline-flex;align-items:center;gap:2px;min-width:0;overflow:hidden;text-overflow:ellipsis;}.tree-indent{display:inline-block;flex:0 0 auto;width:var(--tree-indent,0ch)}.tree-name{overflow:hidden;text-overflow:ellipsis;}.tree-arrow{color:var(--vscode-descriptionForeground);}.status-dashboard{padding:7px 9px 10px;display:flex;flex-direction:column;gap:5px;min-width:0}.lg-logo{font-family:var(--vscode-editor-font-family);font-size:20px;font-weight:800;letter-spacing:.5px;color:var(--vscode-foreground);line-height:1.05}.lg-sub{color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:4px}.lg-link{display:flex;align-items:center;gap:5px;min-height:19px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.lg-link span{overflow:hidden;text-overflow:ellipsis}.lg-repo{margin-top:6px;padding-top:6px;border-top:1px solid var(--vscode-sideBarSectionHeader-border);color:var(--vscode-descriptionForeground);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.current .path,.current .status{font-weight:700}.danger .status{color:var(--vscode-errorForeground)}.hint{color:var(--vscode-descriptionForeground);font-size:11px;line-height:1.35;padding:4px 8px 5px;border-top:1px solid var(--vscode-sideBarSectionHeader-border);background:var(--vscode-sideBar-background);}kbd{font-family:var(--vscode-editor-font-family);font-size:10px;color:var(--vscode-keybindingLabel-foreground);background:var(--vscode-keybindingLabel-background);border:1px solid var(--vscode-keybindingLabel-border);border-bottom-color:var(--vscode-keybindingLabel-bottomBorder);border-radius:3px;padding:0 3px;margin-right:2px;}.statusline{color:var(--vscode-descriptionForeground);padding-top:3px;}
      .boom{position:absolute;inset:0;display:grid;place-items:center;background:color-mix(in srgb,var(--vscode-sideBar-background) 55%,transparent);z-index:5;pointer-events:none;}.bomb{font-size:46px;animation:bomb .45s ease-in forwards}.blast{position:absolute;font-size:76px;opacity:0;animation:blast .5s ease-out .35s forwards}@keyframes bomb{to{transform:scale(.35) rotate(20deg);opacity:0}}@keyframes blast{0%{transform:scale(.2);opacity:0}35%{opacity:1}100%{transform:scale(1.6);opacity:0}}
    </style></head><body tabindex="0" role="listbox" aria-label="${escapeHtml(title)}"${activeRowId ? ` aria-activedescendant="${activeRowId}"` : ''}><div class="root ${this.lazygitGui.wrapLinesInStagingView ? 'wrap-staging' : ''}">${boom}<div class="title">${title}</div><div class="rows">${rows}</div>${footer}</div><script nonce="${nonce}">
      const vscode=acquireVsCodeApi(); const commitFilesCapability=${commitFilesCapability ? scriptJson(commitFilesCapability) : 'undefined'}; const rawPostMessage=vscode.postMessage.bind(vscode); vscode.postMessage=message=>rawPostMessage(commitFilesCapability?Object.assign({},message,{capability:commitFilesCapability}):message); const panel='${viewPanel}', selectedRowId=${scriptJson(selectedRowId)}; const shouldFocus=${shouldFocus ? 'true' : 'false'}; let keyboardEnabled=${this.focusArea === 'panel' && this.ownsModeStatus && !this.editorHunkMode && !this.editorEditMode ? 'true' : 'false'}; window.addEventListener('message',event=>{if(event.data&&event.data.type==='keyboardEnabled')keyboardEnabled=!!event.data.enabled;if(event.data&&event.data.type==='focusBody'){document.body.focus();markPanelFocus();}}); function syncPanelSelection(){if(!selectedRowId)return;const active=document.getElementById(selectedRowId);if(!active)return;document.querySelectorAll('.row[aria-selected="true"]').forEach(row=>{row.classList.remove('sel');row.setAttribute('aria-selected','false');const cursor=row.querySelector('.cursor');if(cursor)cursor.textContent=' ';});active.classList.add('sel');active.setAttribute('aria-selected','true');const cursor=active.querySelector('.cursor');if(cursor)cursor.textContent='›';document.body.setAttribute('aria-activedescendant',selectedRowId);} function markPanelFocus(){keyboardEnabled=true;syncPanelSelection();vscode.postMessage({type:'focusArea',area:'panel'});} window.addEventListener('focus',markPanelFocus); document.body.addEventListener('focus',markPanelFocus); setTimeout(()=>{document.querySelector('.row.sel')?.scrollIntoView({block:'nearest'}); if(shouldFocus){ document.body.focus(); markPanelFocus(); }},0);
      const keymap=${scriptJson(this.lazygitKeymap)};
      const blockNavigation=${scriptJson(panelBlockNavigationBindings(this.lazygitKeymap.universal))};
      const panels={1:'status',2:'files',3:'branches',4:'commits',5:'stash',6:'conflicts',7:'tags',8:'remotes'};
      function norm(e){ let key=e.key; if(key===' ')key='<space>'; else if(key==='Enter')key='<enter>'; else if(key==='Escape')key='<esc>'; else if(key==='Tab')key=e.shiftKey?'<backtab>':'<tab>'; else if(key==='Backspace')key='<backspace>'; else if(key==='ArrowDown')key='<down>'; else if(key==='ArrowUp')key='<up>'; else if(key==='ArrowLeft')key='<left>'; else if(key==='ArrowRight')key='<right>'; const mods=[]; if(e.ctrlKey)mods.push('ctrl'); if(e.altKey)mods.push('alt'); if(e.metaKey)mods.push('meta'); return mods.length?'<'+mods.join('+')+'+'+String(key).replace(/^<|>$/g,'')+'>':key; }
      function keysEqual(expected,typed){ if(expected.startsWith('<')&&expected.endsWith('>'))return expected.toLowerCase()===typed.toLowerCase(); return expected===typed; }
      function hit(e,...bindings){ const k=norm(e); return bindings.flat().filter(Boolean).some(b => keysEqual(String(b),k)); }
      let clickTimer; document.querySelector('.rows')?.addEventListener('click',e=>{ const row=e.target.closest('.row[data-index]'); if(!row)return; clearTimeout(clickTimer); clickTimer=setTimeout(()=>{ document.body.focus(); vscode.postMessage({type:'select',index:Number(row.dataset.index)}); },220); });
      document.querySelector('.rows')?.addEventListener('dblclick',e=>{ const row=e.target.closest('.row[data-index]'); if(!row)return; clearTimeout(clickTimer); document.body.focus(); vscode.postMessage({type:'activateRow',index:Number(row.dataset.index)}); });
      window.addEventListener('keydown',e=>{ if(!keyboardEnabled)return; if((e.ctrlKey||e.metaKey)&&e.shiftKey&&String(e.key).toLowerCase()==='p'){e.preventDefault();vscode.postMessage({type:'commandPalette'});return;} if(e.key==='F1'){e.preventDefault();vscode.postMessage({type:'commandPalette'});return;} const u=keymap.universal, f=keymap.files, m=keymap.main; const jump=Array.isArray(u.jumpToBlock)?u.jumpToBlock:[]; const jumpIndex=jump.indexOf(e.key); const jumpPanel = jumpIndex>=0 ? panels[String(jumpIndex+1)] : panels[e.key]; if(jumpPanel){e.preventDefault();vscode.postMessage({type:'switchPanel',panel:jumpPanel});return;}
        if(e.key==='?'){e.preventDefault();vscode.postMessage({type:'helpMenu'});return;} if(panel!=='conflicts'&&hit(e,u.undo)){e.preventDefault();vscode.postMessage({type:'dogfoodBoundary',event:'reflogUndo',key:norm(e)});vscode.postMessage({type:'reflogUndo'});return;} if(panel!=='conflicts'&&hit(e,u.redo)){e.preventDefault();vscode.postMessage({type:'reflogRedo'});return;} if(hit(e,u.focusMainView)){e.preventDefault();vscode.postMessage({type:'focusMainView'});return;} if(e.shiftKey&&e.key==='ArrowDown'){e.preventDefault();vscode.postMessage({type:'rangeMove',delta:1});return;} if(e.shiftKey&&e.key==='ArrowUp'){e.preventDefault();vscode.postMessage({type:'rangeMove',delta:-1});return;} if(e.key==='ArrowDown'){e.preventDefault();vscode.postMessage({type:'move',delta:1});return;} if(e.key==='ArrowUp'){e.preventDefault();vscode.postMessage({type:'move',delta:-1});return;} if(hit(e,u.prevPage)){e.preventDefault();vscode.postMessage({type:'move',delta:-10});return;} if(hit(e,u.nextPage)){e.preventDefault();vscode.postMessage({type:'move',delta:10});return;} if(hit(e,u.gotoTop,u.gotoTopAlt)){e.preventDefault();vscode.postMessage({type:'moveTo',position:'top'});return;} if(hit(e,u.gotoBottom,u.gotoBottomAlt)){e.preventDefault();vscode.postMessage({type:'moveTo',position:'bottom'});return;} if(hit(e,u.toggleRangeSelect)){e.preventDefault();vscode.postMessage({type:'rangeToggle'});return;} if(hit(e,u.startSearch)){e.preventDefault();vscode.postMessage({type:'search'});return;} if(panel==='files'&&hit(e,f.openStatusFilter)){e.preventDefault();vscode.postMessage({type:'statusFilter'});return;} if(panel==='files'&&hit(e,f.toggleTreeView)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='files'&&hit(e,f.collapseAll)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='files'&&hit(e,f.expandAll)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(hit(e,u.nextItem,u.nextItemAlt)){e.preventDefault();vscode.postMessage({type:'move',delta:1});return;} if(hit(e,u.prevItem,u.prevItemAlt)){e.preventDefault();vscode.postMessage({type:'move',delta:-1});return;}
        if(hit(e,u.createRebaseOptionsMenu)){e.preventDefault();vscode.postMessage({type:'operationOptions'});return;} if(hit(e,u.diffingMenu,u.diffingMenuAlt)){e.preventDefault();vscode.postMessage({type:'diffingMenu'});return;} if(hit(e,blockNavigation.next)){e.preventDefault();vscode.postMessage({type:'moveBlock',delta:1});return;} if(hit(e,blockNavigation.previous)){e.preventDefault();vscode.postMessage({type:'moveBlock',delta:-1});return;}
        const c=keymap.commits, cf=keymap.commitFiles; if(panel==='commits'&&${this.commitFilesController.commit ? 'true' : 'false'}&&hit(e,f.copyFileInfoToClipboard)){e.preventDefault();vscode.postMessage({type:'copyCommitFileInfo'});return;} if(panel==='commits'&&${this.commitFilesController.commit ? 'true' : 'false'}&&hit(e,u.remove)){e.preventDefault();vscode.postMessage({type:'discardCommitFile'});return;} if(panel==='commits'&&${this.commitFilesController.commit ? 'true' : 'false'}&&hit(e,cf.checkoutCommitFile)){e.preventDefault();vscode.postMessage({type:'checkoutCommitFile'});return;} if(panel==='commits'&&!${this.commitFilesController.commit ? 'true' : 'false'}&&hit(e,u.remove,c.squashDown,c.squashAboveCommits,c.markCommitAsFixup,c.moveDownCommit,c.moveUpCommit,c.checkoutCommit,c.copyCommitAttributeToClipboard,c.newBranch,c.renameCommit,c.amendToCommit,u.edit,c.createFixupCommit,c.cherryPickCopy,c.pasteCommits,c.resetCherryPick,c.revertCommit,c.createTag,c.tagCommit,c.viewBisectOptions,c.viewResetOptions,c.openInBrowser,c.openLogMenu)){e.preventDefault();vscode.postMessage({type:'commitAction',key:norm(e)});return;} if(panel==='files'&&hit(e,c.viewResetOptions)){e.preventDefault();vscode.postMessage({type:'resetToUpstreamMenu'});return;}
        const b=keymap.branches, st=keymap.stash; if(panel==='status'&&['o','e','a','A','u','<enter>'].includes(norm(e))){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='hunks'&&hit(e,u.select,u.togglePanel,u.remove,m.toggleSelectHunk)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='branches'&&hit(e,u.select,u.new,u.remove,b.checkoutBranchByName,b.checkoutPreviousBranch,b.renameBranch,b.mergeIntoCurrentBranch,b.rebaseBranch,b.forceCheckoutBranch,b.setUpstream,b.fastForward,b.createTag,b.sortOrder)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='stash'&&hit(e,u.goInto,st.apply,st.popStash,st.newBranch,st.renameStash,u.remove)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='tags'&&hit(e,u.select,u.new,u.remove,b.createTag,b.pushTag)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='remotes'&&hit(e,u.new,u.edit,u.remove,b.fetchRemote,b.addForkRemote)){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;} if(panel==='conflicts'&&(hit(e,u.goInto,u.openFile)||['1','2','b','m'].includes(norm(e)))){e.preventDefault();vscode.postMessage({type:'panelAction',key:norm(e)});return;}
        if(hit(e,u.select)){e.preventDefault();vscode.postMessage({type:'toggle'});return;} if(panel==='status'&&hit(e,u.goInto)){e.preventDefault();vscode.postMessage({type:'repoMenu'});return;} if(hit(e,u.goInto)){e.preventDefault();vscode.postMessage({type:'enter'});return;} if(hit(e,u.openFile)){e.preventDefault();vscode.postMessage({type:'openFile'});return;} if(hit(e,u.edit)){e.preventDefault();vscode.postMessage({type:'editFile'});return;} if(panel==='files'&&hit(e,f.copyFileInfoToClipboard)){e.preventDefault();vscode.postMessage({type:'copyInfo'});return;} if(panel==='files'&&hit(e,f.copyPath,u.copyToClipboard)){e.preventDefault();vscode.postMessage({type:'copyPath'});return;} if(panel!=='files'&&hit(e,u.copyToClipboard)){e.preventDefault();vscode.postMessage({type:'copyInfo'});return;} if(panel==='files'&&hit(e,f.ignoreFile)){e.preventDefault();vscode.postMessage({type:'ignoreMenu'});return;} if(panel==='files'&&hit(e,f.fetch)){e.preventDefault();vscode.postMessage({type:'fetch'});return;}
        if(panel==='files'&&hit(e,f.toggleStagedAll)){e.preventDefault();vscode.postMessage({type:'stageAll'});return;} if(panel==='files'&&hit(e,f.commitChangesWithoutHook)){e.preventDefault();vscode.postMessage({type:'commitNoVerify'});return;} if(panel==='files'&&hit(e,f.amendLastCommit)){e.preventDefault();vscode.postMessage({type:'amendLastCommit'});return;} if(panel==='files'&&hit(e,f.commitChangesWithEditor)){e.preventDefault();vscode.postMessage({type:'commitWithEditor'});return;} if((panel==='files'||panel==='status')&&hit(e,f.commitChanges)){e.preventDefault();vscode.postMessage({type:'commit'});return;} if(hit(e,u.pushFiles,u.push)){e.preventDefault();vscode.postMessage({type:'push'});return;} if(hit(e,u.pullFiles,u.pull)){e.preventDefault();vscode.postMessage({type:'pull'});return;}
        if((panel==='files'||panel==='status')&&hit(e,f.stashAllChanges)){e.preventDefault();vscode.postMessage({type:'stashAll'});return;} if((panel==='files'||panel==='status')&&hit(e,f.viewStashOptions)){e.preventDefault();vscode.postMessage({type:'stashMenu'});return;} if(hit(e,u.remove)){e.preventDefault();vscode.postMessage({type:'discardMenu'});return;} if((panel==='files'||panel==='status')&&hit(e,f.viewResetOptions)){e.preventDefault();vscode.postMessage({type:'resetMenu'});return;}
        if(hit(e,u.togglePanel)){e.preventDefault();vscode.postMessage({type:'togglePanel'});return;} if(hit(e,u.return)){e.preventDefault();vscode.postMessage({type:'back'});return;} if(e.key==='Backspace'){e.preventDefault();vscode.postMessage({type:'clearFilter'});return;} if(hit(e,u.refresh,f.refreshFiles)){e.preventDefault();vscode.postMessage({type:'refresh'});return;} if(hit(e,u.quit)){e.preventDefault();vscode.postMessage({type:'close'});return;} if(panel==='hunks'&&hit(e,m.toggleSelectHunk)){e.preventDefault();vscode.postMessage({type:'toggleHunkSelection'});return;} });
    </script></body></html>`; } catch { this.views.delete(viewPanel); }
  }
  private title(panel: Panel): string { if (panel === 'hunks') return `${this.hunkSide === 'staged' ? 'Staged' : 'Unstaged'} changes · ${escapeHtml(this.files[this.selected]?.path ?? '')}`; if (panel === 'commits' && this.commitFilesController.commit) return `Commit files · ${this.commitFilesController.commit.hash}`; if (panel === 'stash' && this.stashFilesFor) return `Stash files · ${this.stashFilesFor.ref}`; return ({ status: 'Status', files: 'Files', branches: 'Branches', commits: 'Commits', stash: 'Stash', conflicts: 'Conflicts', tags: 'Tags', remotes: 'Remotes', hunks: 'Hunks' } as Record<Panel,string>)[panel]; }
  private help(panel: Panel): string {
    const u = this.lazygitKeymap.universal, f = this.lazygitKeymap.files, m = this.lazygitKeymap.main, c = this.lazygitKeymap.commits;
    const kb = (value: string | string[] | undefined) => `<kbd>${escapeHtml(Array.isArray(value) ? value.join('/') : String(value ?? ''))}</kbd>`;
    const common = `${this.lazygitGui.showPanelJumps ? `${kb(u.jumpToBlock)} views · ` : ''}${kb([String(u.prevItemAlt), String(u.nextItemAlt)])} move · ${kb(String(u.startSearch))} search · ${kb(String(u.goInto))} action · ${kb([String(u.refresh), String(f.refreshFiles)])} refresh<br>`;
    if (panel === 'status') return common + `${kb(String(u.goInto))} files · ${kb(String(u.pushFiles ?? u.push))}/${kb(String(u.pullFiles ?? u.pull))} push/pull · ${kb(String(f.stashAllChanges))} stash · ${kb(String(f.viewResetOptions))} nuke`;
    if (panel === 'hunks') return common + `${kb(String(u.select))} stage/unstage · ${kb(String(u.remove))} discard/unstage · ${kb([String(u.prevBlockAlt), String(u.nextBlockAlt)])} hunk/line · ${kb(String(u.togglePanel))} staged/unstaged · ${kb(String(m.toggleSelectHunk))} line/hunk`;
    if (panel === 'files') return common + `${kb(String(u.select))} stage · ${kb(String(u.goInto))} hunks · ${kb(String(f.openStatusFilter))} filter · ${kb(String(f.ignoreFile))} ignore · ${kb(String(f.fetch))} fetch · ${kb(String(f.commitChanges))} commit · ${kb(String(u.remove))}/${kb(String(c.viewResetOptions))}/${kb(String(f.viewResetOptions))} discard/upstream/nuke · ${kb(String(f.toggleStagedAll))} all`;
    if (panel === 'branches') return `${this.lazygitGui.showPanelJumps ? `${kb(u.jumpToBlock)} views · ` : ''}${kb([String(u.prevItemAlt), String(u.nextItemAlt)])} move · ${kb(String(u.startSearch))} search · ${kb(String(u.focusMainView))} focus log · ${kb([String(u.refresh), String(f.refreshFiles)])} refresh<br>${kb(String(u.select))} checkout · ${kb(String(u.pushFiles ?? u.push))}/${kb(String(u.pullFiles ?? u.pull))} push/pull`;
    if (panel === 'tags') return common + `${kb(String(u.select))} checkout · ${kb(String(u.new))} branch · ${kb(String(this.lazygitKeymap.branches.createTag))} create · ${kb(String(this.lazygitKeymap.branches.pushTag))} push`;
    if (panel === 'remotes') return common + `${kb(String(this.lazygitKeymap.branches.fetchRemote))} fetch · ${kb(String(u.new))} add · ${kb(String(u.edit))} edit URL · ${kb(String(u.remove))} remove`;
    if (panel === 'commits') {
      const c = this.lazygitKeymap.commits, cf = this.lazygitKeymap.commitFiles;
      if (this.commitFilesController.commit) return common + `${kb(String(f.copyFileInfoToClipboard))} copy menu · ${kb(String(cf.checkoutCommitFile))} checkout · ${kb(String(u.remove))} discard from commit · ${kb(String(u.goInto))} open/toggle`;
      return common + `${kb(String(u.edit))} edit · ${kb(String(u.remove))} drop · ${kb(String(c.squashDown))} squash · ${kb(String(c.squashAboveCommits))} apply fixups · ${kb(String(c.markCommitAsFixup))} fixup · ${kb(String(c.moveDownCommit))}/${kb(String(c.moveUpCommit))} move · ${kb(String(u.goInto))} files · ${kb(String(c.checkoutCommit))} checkout · ${kb(String(c.copyCommitAttributeToClipboard ?? u.copyToClipboard))} copy · ${kb(String(c.viewBisectOptions))} bisect · ${kb(String(c.viewResetOptions))} reset · ${kb(String(c.revertCommit))}/${kb(String(c.createTag ?? c.tagCommit))} revert/tag`;
    }
    if (panel === 'stash') return common + `${kb(String(u.goInto))} apply/pop/drop/show · ${kb(String(f.stashAllChanges))} create stash`;
    return common + `${kb([String(u.goInto), String(u.openFile)])} open conflict · resolve with VS Code`;
  }
  private fileTreeLabel(row: FileTreeRow): string { return row.label; }
  private virtualRows<T>(items: readonly T[], activeIndex: number, render: (item: T, index: number) => string): string {
    const windowSize = 240;
    if (items.length <= windowSize) return items.map(render).join('');
    const start = Math.max(0, Math.min(items.length - windowSize, activeIndex - Math.floor(windowSize / 2)));
    const end = Math.min(items.length, start + windowSize);
    const top = start * 20;
    const bottom = (items.length - end) * 20;
    return `<div class="virtual-spacer" data-virtual-offset="${start}" style="--virtual-height:${top}px"></div>${items.slice(start, end).map((item, i) => render(item, start + i)).join('')}<div class="virtual-spacer" data-virtual-offset="${end}" style="--virtual-height:${bottom}px"></div>`;
  }
  private rows(panel: Panel, active: boolean): string {
    if (panel === 'status') return this.renderStatus(active);
    if (panel === 'files') {
      const fileRows = this.fileTreeRows();
      return fileRows.length ? this.virtualRows(fileRows, this.selected, (r, i) => r.kind === 'dir'
        ? dirRow(active && i===this.selected, 'dir', r, i)
        : this.lazygitGui.showFileTree
          ? treeFileRow(active && i===this.selected, `${statusClass(r.file)} ${this.fileRangeSelected.has(i) ? 'range' : ''}`, r.file, this.fileTreeLabel(r), r.depth, i)
          : fileRow(active && i===this.selected, `${statusClass(r.file)} ${this.fileRangeSelected.has(i) ? 'range' : ''}`, r.file, this.fileTreeLabel(r), i))
        : '<div class="empty">No files for current filter.</div>';
    }
    if (panel === 'hunks') return this.renderHunks(active);
    if (panel === 'branches') { const branches = this.filteredBranches(); return branches.length ? branches.map((b,i)=>branchRow(active && i===this.branchSelected, b, i)).join('') : '<div class="empty">No branches.</div>'; }
    if (panel === 'tags') { const tags = this.filteredTags(); return tags.length ? tags.map((t,i)=>row(active && i===this.tagSelected, 'tag', 'T', t.name, t.date || t.subject, i)).join('') : '<div class="empty">No tags. Press T to create one.</div>'; }
    if (panel === 'remotes') { const remotes = this.filteredRemotes(); return remotes.length ? remotes.map((r,i)=>row(active && i===this.remoteSelected, 'remote', 'R', r.name, r.fetchUrl || r.pushUrl, i)).join('') : '<div class="empty">No remotes. Press n to add one.</div>'; }
    if (panel === 'commits') {
      if (this.commitFilesController.commit) {
        const commitFileRows = this.commitFilesController.rows(this.lazygitGui);
        return commitFileRows.length ? this.virtualRows(commitFileRows, this.commitFilesController.selected, (r, i) => r.kind === 'dir'
          ? dirRow(active && i===this.commitFilesController.selected, 'dir', r, i)
          : this.lazygitGui.showFileTree
            ? treeFileRow(active && i===this.commitFilesController.selected, statusClass(r.file), r.file, this.fileTreeLabel(r), r.depth, i)
            : fileRow(active && i===this.commitFilesController.selected, statusClass(r.file), r.file, this.fileTreeLabel(r), i))
          : '<div class="empty">No files in commit.</div>';
      }
      const commits = this.filteredCommits(); return commits.length ? commits.map((c,i)=>commitRow(active && i===this.commitSelected, c, i, `${this.isCommitRangeSelected(i) ? 'range ' : ''}${this.isVisibleCopiedCommit(c) ? 'copied' : ''}`.trim())).join('') : '<div class="empty">No commits.</div>';
    }
    if (panel === 'stash') {
      if (this.stashFilesFor) return this.stashFileItems.length ? this.stashFileItems.map((f,i)=>row(active && i===this.stashFileSelected, '', f.status, f.path, this.stashFilesFor!.ref, i)).join('') : '<div class="empty">No files in stash.</div>';
      const stashes = this.filteredStashes(); return stashes.length ? stashes.map((s,i)=>row(active && i===this.stashSelected, '', s.ref, s.message, '', i)).join('') : '<div class="empty">No stashes. Press s to create one.</div>';
    }
    const conflicts = this.filteredConflicts(); return conflicts.length ? conflicts.map((f,i)=>row(active && i===this.conflictSelected, 'danger', f.xy, f.path, '', i)).join('') : '<div class="empty">No conflicts.</div>';
  }
  private renderHunks(active: boolean): string {
    const f = this.currentFile(); if (!f) return '<div class="empty">No file selected.</div>'; if (f.untracked) return '<div class="empty">Untracked file. Back to Files and space stages whole file.</div>';
    if (this.hunkSelectionMode === 'line') {
      const h = this.hunks[this.hunkSelected]; if (!h) return '<div class="empty">No hunks for this side.</div>';
      const changed = hunkSelectableLineIndexes(h);
      const body = hunkBodyLines(h);
      return body.map((line, i) => { const changedIndex = changed.indexOf(i); return row(active && changed[this.hunkLineSelected] === i, `hunk ${line.startsWith('+') ? 'staged' : line.startsWith('-') ? 'unstaged' : ''}`, line.slice(0, 1) || ' ', line.slice(1), '', changedIndex >= 0 ? changedIndex : undefined); }).join('');
    }
    return this.hunks.length ? this.hunks.map((h,i)=>row(active && i===this.hunkSelected, `hunk ${h.staged?'staged':'unstaged'}`, h.staged?'S':'M', h.summary, '', i)).join('') : '<div class="empty">No hunks for this side.</div>';
  }
  private renderStatus(active: boolean): string { const root = getActiveWorkspaceRoot(); return row(active, 'status-repo', 'enter', root ? path.basename(root) : 'Select repository', '', 0); }
}
function clamp(index: number, length: number): number { return length ? Math.max(0, Math.min(length - 1, index)) : 0; }
function stripAnsi(s: string): string { return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''); }
async function showText(title: string, content: string, preserveFocus = false, preview = false, shouldOpen: () => boolean = () => true) {
  if (!shouldOpen()) return;
  await closeLazyGitVSPreviewTabsIfSingle();
  if (!shouldOpen()) return;
  const uri = virtualPreviewProvider.set(title, stripAnsi(content));
  if (!shouldOpen()) return;
  const doc = await vscode.workspace.openTextDocument(uri);
  if (!shouldOpen()) return;
  await vscode.languages.setTextDocumentLanguage(doc, 'diff');
  if (!shouldOpen()) return;
  await vscode.window.showTextDocument(doc, { preview, preserveFocus, viewColumn: vscode.ViewColumn.Active });
  if (!shouldOpen()) return;
}
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(EMPTY_PREVIEW_SCHEME, new EmptyProvider()));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_PREVIEW_SCHEME, virtualPreviewProvider));
  const app = new LazyGitVSController(context);
  for (const panel of PANEL_ORDER) context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_IDS[panel], new PanelViewProvider(app, panel), { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.changedFiles', showChangedFilesQuickPick));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.enterSelected', () => app.enterSelected()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.statusRecentRepos', () => app.openRecentRepos()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.statusEnter', (target?: string | { repoPath?: string; operationOptions?: boolean }) => app.statusEnter(target)));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.openOperationOptions', (target?: string | { repoPath?: string }) => app.openOperationOptions(target)));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.openDashboard', () => app.focus()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.closeDashboard', () => app.close()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.resetState', () => app.resetState()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.dumpHealth', () => app.dumpHealth()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.helpCurrentPanel', () => app.helpCurrentPanel()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.undoReflog', () => app.reflogUndo()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.redoReflog', () => app.reflogRedo()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.enterCurrentFileHunkMode', () => app.enterCurrentFileHunkMode()));
  PANEL_ORDER.forEach((panel, index) => {
    context.subscriptions.push(vscode.commands.registerCommand(`lazygitvs.focusPanel${index + 1}`, () => app.focusNumberPanel(index + 1)));
  });
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkNext', () => app.editorNextHunk(1)));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkPrev', () => app.editorNextHunk(-1)));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkToggle', () => app.editorToggleHunk()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkEdit', () => app.enterEditorEditMode()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkToggleMode', () => app.editorToggleHunkSelectionMode()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkToggleSide', () => app.editorToggleHunkSide()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkHelp', () => app.editorHunkHelp()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkDiscard', () => app.editorDiscardHunk()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkNoop', () => app.editorHunkNoop()));
  context.subscriptions.push(vscode.commands.registerCommand('lazygitvs.editorHunkExit', () => app.exitEditorHunkMode()));
}
export function deactivate() {}
