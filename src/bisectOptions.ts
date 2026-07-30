import * as fs from 'fs';
import * as path from 'path';

export type BisectGitRunner = (args: string[], cwd: string) => Promise<string>;

export type BisectInfo = {
  started: boolean;
  startHash: string;
  currentHash: string;
  newTerm: string;
  oldTerm: string;
};

export type BisectActionId =
  | 'start-new'
  | 'start-old'
  | 'choose-terms'
  | 'mark-new'
  | 'mark-old'
  | 'skip-current'
  | 'skip-selected'
  | 'reset';

export type BisectAction = {
  id: BisectActionId;
  key: string;
  label: string;
  commands?: string[][];
  confirmation?: string;
};

export type BisectQuickPickItem = { label: string; action?: BisectAction };
export type BisectQuickPick = {
  title?: string;
  placeholder?: string;
  items: readonly BisectQuickPickItem[];
  activeItems: readonly BisectQuickPickItem[];
  selectedItems: readonly BisectQuickPickItem[];
  onDidChangeValue(listener: (value: string) => void): { dispose(): unknown };
  onDidAccept(listener: () => void): { dispose(): unknown };
  onDidHide(listener: () => void): { dispose(): unknown };
  show(): void;
  hide(): void;
  dispose(): void;
};

export type BisectInputBoxOptions = { title: string; prompt: string };

export const BISECT_MENU_TITLE = 'Bisect';
export const BISECT_RESET_TITLE = "Reset 'git bisect'";
export const BISECT_RESET_PROMPT = "Are you sure you want to reset 'git bisect'?";

const DEFAULT_INFO: BisectInfo = {
  started: false,
  startHash: '',
  currentHash: '',
  newTerm: 'bad',
  oldTerm: 'good'
};

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

function sameCommit(left: string, right: string): boolean {
  return left === right || (left.length >= 7 && right.startsWith(left)) || (right.length >= 7 && left.startsWith(right));
}

function sameInfo(left: BisectInfo, right: BisectInfo): boolean {
  return left.started === right.started
    && left.startHash === right.startHash
    && left.currentHash === right.currentHash
    && left.newTerm === right.newTerm
    && left.oldTerm === right.oldTerm;
}

async function gitPath(repoPath: string, name: string, runGit: BisectGitRunner): Promise<string> {
  const value = (await runGit(['rev-parse', '--git-path', name], repoPath)).trim();
  return path.isAbsolute(value) ? value : path.resolve(repoPath, value);
}

function readOptionalFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8').trim(); } catch { return ''; }
}

/**
 * Mirrors lazygit's transient Bisect.GetInfo read: BISECT_START is the source
 * of truth, with standard good/bad terms until Git has written BISECT_TERMS.
 * It deliberately does not introduce controller-persistent bisect state.
 */
export async function readBisectInfo(repoPath: string, runGit: BisectGitRunner): Promise<BisectInfo> {
  const startPath = await gitPath(repoPath, 'BISECT_START', runGit);
  if (!fs.existsSync(startPath)) return { ...DEFAULT_INFO };

  const startHash = readOptionalFile(startPath);
  const termsPath = await gitPath(repoPath, 'BISECT_TERMS', runGit);
  const terms = readOptionalFile(termsPath).split(/\r?\n/);
  const currentPath = await gitPath(repoPath, 'BISECT_EXPECTED_REV', runGit);
  return {
    started: true,
    startHash,
    currentHash: readOptionalFile(currentPath),
    newTerm: terms[0] || DEFAULT_INFO.newTerm,
    oldTerm: terms[1] || DEFAULT_INFO.oldTerm
  };
}

export function buildBisectActions(info: BisectInfo, selectedHash: string): BisectAction[] {
  const selectedShortHash = shortHash(selectedHash);
  if (!info.started) {
    return [
      { id: 'start-new', key: 'b', label: `Mark ${selectedShortHash} as ${info.newTerm} (start bisect)`, commands: [['bisect', 'start'], ['bisect', info.newTerm, selectedHash]] },
      { id: 'start-old', key: 'g', label: `Mark ${selectedShortHash} as ${info.oldTerm} (start bisect)`, commands: [['bisect', 'start'], ['bisect', info.oldTerm, selectedHash]] },
      { id: 'choose-terms', key: 't', label: 'Choose bisect terms' }
    ];
  }

  const hashToMark = info.currentHash || selectedHash;
  const shortHashToMark = shortHash(hashToMark);
  const actions: BisectAction[] = [
    { id: 'mark-new', key: 'b', label: `Mark current commit (${shortHashToMark}) as ${info.newTerm}`, commands: [['bisect', info.newTerm, hashToMark]] },
    { id: 'mark-old', key: 'g', label: `Mark current commit (${shortHashToMark}) as ${info.oldTerm}`, commands: [['bisect', info.oldTerm, hashToMark]] },
    { id: 'skip-current', key: 's', label: `Skip current commit (${shortHashToMark})`, commands: [['bisect', 'skip', hashToMark]] }
  ];
  if (info.currentHash && !sameCommit(info.currentHash, selectedHash)) {
    actions.push({ id: 'skip-selected', key: 'S', label: `Skip selected commit (${selectedShortHash})`, commands: [['bisect', 'skip', selectedHash]] });
  }
  actions.push({ id: 'reset', key: 'r', label: 'Reset bisect', commands: [['bisect', 'reset']], confirmation: BISECT_RESET_PROMPT });
  return actions;
}

export async function pickBisectAction(actions: BisectAction[], createQuickPick: () => BisectQuickPick): Promise<BisectAction | undefined> {
  const qp = createQuickPick();
  qp.title = BISECT_MENU_TITLE;
  qp.placeholder = 'type the lazygit key or filter options';
  qp.items = [...actions.map(action => ({ label: `${action.key} ${action.label}`, action })), { label: 'esc Cancel' }];
  qp.activeItems = qp.items.slice(0, 1);
  return await new Promise<BisectAction | undefined>(resolve => {
    let done = false;
    const finish = (action?: BisectAction) => { if (done) return; done = true; qp.hide(); resolve(action); };
    qp.onDidChangeValue(value => { const action = actions.find(candidate => candidate.key === value.trim()); if (action) finish(action); });
    qp.onDidAccept(() => finish(qp.selectedItems[0]?.action ?? qp.activeItems[0]?.action));
    qp.onDidHide(() => { if (!done) { done = true; resolve(undefined); } qp.dispose(); });
    qp.show();
  });
}

async function revalidate(repoPath: string, opened: BisectInfo, runGit: BisectGitRunner): Promise<void> {
  if (!fs.existsSync(repoPath)) throw new Error('The active repository is no longer available. Refresh and try again.');
  const current = await readBisectInfo(repoPath, runGit);
  if (!sameInfo(opened, current)) throw new Error('Git bisect state changed while the menu was open. Refresh and try again.');
}

export async function executeBisectAction({
  repoPath,
  opened,
  action,
  runGit,
  confirm
}: {
  repoPath: string;
  opened: BisectInfo;
  action: BisectAction;
  runGit: BisectGitRunner;
  confirm?: (prompt: string, title: string) => Promise<boolean>;
}): Promise<boolean> {
  if (action.id === 'choose-terms') return false;
  await revalidate(repoPath, opened, runGit);
  if (action.confirmation) {
    if (!confirm || !await confirm(action.confirmation, BISECT_RESET_TITLE)) return false;
    await revalidate(repoPath, opened, runGit);
  }

  const commands = action.commands ?? [];
  if (action.id === 'start-new' || action.id === 'start-old') {
    await runGit(commands[0], repoPath);
    try {
      await runGit(commands[1], repoPath);
    } catch (error) {
      await runGit(['bisect', 'reset'], repoPath).catch(() => undefined);
      throw error;
    }
    return true;
  }

  for (const args of commands) await runGit(args, repoPath);
  return true;
}

export async function startBisectWithTerms({
  repoPath,
  opened,
  oldTerm,
  newTerm,
  runGit
}: {
  repoPath: string;
  opened: BisectInfo;
  oldTerm: string;
  newTerm: string;
  runGit: BisectGitRunner;
}): Promise<boolean> {
  if (opened.started) return false;
  await revalidate(repoPath, opened, runGit);
  await runGit(['bisect', 'start', `--term-old=${oldTerm}`, `--term-new=${newTerm}`], repoPath);
  return true;
}

export async function runBisectOptions({
  repoPath,
  selectedHash,
  runGit,
  createQuickPick,
  showInputBox,
  confirm
}: {
  repoPath: string;
  selectedHash: string;
  runGit: BisectGitRunner;
  createQuickPick: () => BisectQuickPick;
  showInputBox: (options: BisectInputBoxOptions) => PromiseLike<string | undefined>;
  confirm: (prompt: string, title: string) => Promise<boolean>;
}): Promise<boolean> {
  const opened = await readBisectInfo(repoPath, runGit);
  const action = await pickBisectAction(buildBisectActions(opened, selectedHash), createQuickPick);
  if (!action) return false;
  if (action.id === 'choose-terms') {
    const oldTerm = await showInputBox({ title: BISECT_MENU_TITLE, prompt: 'Term for old/good commit:' });
    if (oldTerm === undefined) return false;
    const newTerm = await showInputBox({ title: BISECT_MENU_TITLE, prompt: 'Term for new/bad commit:' });
    if (newTerm === undefined) return false;
    return startBisectWithTerms({ repoPath, opened, oldTerm, newTerm, runGit });
  }
  return executeBisectAction({ repoPath, opened, action, runGit, confirm });
}
