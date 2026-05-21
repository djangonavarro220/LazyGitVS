import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type LazyGitKeymap = {
  universal: Record<string, string | string[]>;
  files: Record<string, string>;
  branches: Record<string, string>;
  commits: Record<string, string>;
  stash: Record<string, string>;
  main: Record<string, string>;
};

export type LazyGitGuiConfig = {
  showBottomLine: boolean;
  showPanelJumps: boolean;
  showFileTree: boolean;
  fileTreeSortOrder: 'mixed' | 'filesFirst' | 'foldersFirst' | string;
  fileTreeSortCaseSensitive: boolean;
  wrapLinesInStagingView: boolean;
  useHunkModeInStagingView: boolean;
};

export type LazyGitGitConfig = {
  diffContextSize: number;
  ignoreWhitespaceInDiffView: boolean;
  renameSimilarityThreshold: number;
  branchLogCmd: string;
  [key: string]: unknown;
};

export type LazyGitConfig = {
  keymap: LazyGitKeymap;
  gui: LazyGitGuiConfig;
  git: LazyGitGitConfig;
  customCommands: unknown[];
  files: string[];
};

export const DEFAULT_LAZYGIT_KEYMAP: LazyGitKeymap = {
  universal: {
    quit: 'q', quitAlt1: '<ctrl+c>', return: '<esc>', togglePanel: '<tab>', prevItem: '<up>', nextItem: '<down>', prevItemAlt: 'k', nextItemAlt: 'j',
    prevPage: ',', nextPage: '.', gotoTop: '<', gotoBottom: '>', gotoTopAlt: '<home>', gotoBottomAlt: '<end>', toggleRangeSelect: 'v', rangeSelectDown: '<shift+down>', rangeSelectUp: '<shift+up>',
    prevBlock: '<left>', nextBlock: '<right>', prevBlockAlt: 'h', nextBlockAlt: 'l', jumpToBlock: ['1', '2', '3', '4', '5'], focusMainView: '0',
    select: '<space>', goInto: '<enter>', remove: 'd', edit: 'e', openFile: 'o', push: 'P', pull: 'p', refresh: 'R', startSearch: '/', copyToClipboard: 'y'
  },
  files: { copyPath: '<c-o>', openStatusFilter: '<c-b>', commitChanges: 'c', commitChangesWithoutHook: 'w', amendLastCommit: 'A', commitChangesWithEditor: 'C', refreshFiles: 'r', stashAllChanges: 's', viewStashOptions: 'S', toggleStagedAll: 'a', viewResetOptions: 'D', viewUpstreamResetOptions: 'g', confirmDiscard: 'x', ignoreFile: 'i', fetch: 'f' },
  branches: { checkoutBranchByName: 'c', forceCheckoutBranch: 'F', checkoutPreviousBranch: '-', rebaseBranch: 'r', renameBranch: 'R', mergeIntoCurrentBranch: 'M', setUpstream: 'u', sortOrder: 's', createTag: 'T', pushTag: 'P', fetchRemote: 'f', addForkRemote: 'F' },
  commits: { squashDown: 's', renameCommit: 'r', renameCommitWithEditor: 'R', viewResetOptions: 'g', markCommitAsFixup: 'f', setFixupMessage: 'c', createFixupCommit: 'F', squashAboveCommits: 'S', moveDownCommit: '<ctrl+j>', moveUpCommit: '<ctrl+k>', amendToCommit: 'A', resetCommitAuthor: 'a', pickCommit: 'p', revertCommit: 't', createTag: 'T', tagCommit: 'T', cherryPickCopy: 'C', pasteCommits: 'V', markCommitAsBaseForRebase: 'B', checkoutCommit: '<space>', resetCherryPick: '<ctrl+r>', copyCommitAttributeToClipboard: 'y', openLogMenu: '<ctrl+l>', openInBrowser: 'o', openPullRequestInBrowser: 'G', viewBisectOptions: 'b', startInteractiveRebase: 'i', selectCommitsOfCurrentBranch: '*', newBranch: 'n' },
  stash: { apply: '<space>', popStash: 'g', renameStash: 'r', newBranch: 'n' },
  main: { toggleSelectHunk: 'a', pickBothHunks: 'b', editSelectHunk: 'E' }
};

export const DEFAULT_LAZYGIT_GUI: LazyGitGuiConfig = {
  showBottomLine: true,
  showPanelJumps: true,
  showFileTree: true,
  fileTreeSortOrder: 'mixed',
  fileTreeSortCaseSensitive: true,
  wrapLinesInStagingView: true,
  useHunkModeInStagingView: true
};

export const DEFAULT_LAZYGIT_GIT: LazyGitGitConfig = {
  diffContextSize: 3,
  ignoreWhitespaceInDiffView: false,
  renameSimilarityThreshold: 50,
  branchLogCmd: 'git log --graph --color=always --abbrev-commit --decorate --date=relative --pretty=medium {{branchName}} --'
};

export function cloneKeymap(): LazyGitKeymap { return JSON.parse(JSON.stringify(DEFAULT_LAZYGIT_KEYMAP)); }
export function cloneGuiConfig(): LazyGitGuiConfig { return { ...DEFAULT_LAZYGIT_GUI }; }
export function cloneGitConfig(): LazyGitGitConfig { return { ...DEFAULT_LAZYGIT_GIT }; }

function deepMerge(target: any, source: any) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) { target[key] ??= {}; deepMerge(target[key], value); }
    else if (value !== undefined && value !== null) target[key] = value;
  }
}

function stripYamlComment(line: string): string {
  let quote = ''; let out = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if ((c === '"' || c === "'") && line[i - 1] !== '\\') quote = quote === c ? '' : quote || c;
    if (c === '#' && !quote) break;
    out += c;
  }
  return out;
}

function parseYamlScalar(value: string): string | string[] | boolean | number | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (v === 'true') return true; if (v === 'false') return false;
  if (v === 'null' || v === '~') return undefined;
  if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).split(',').map(x => parseYamlScalar(x.trim())).filter((x): x is string => typeof x === 'string');
  const quoted = (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
  if (quoted) return v.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function parseSimpleYaml(content: string): any {
  const root: any = {}; const stack: { indent: number; obj: any; parent?: any; key?: string }[] = [{ indent: -1, obj: root }];
  for (const raw of content.split(/\r?\n/)) {
    const noComment = stripYamlComment(raw).replace(/\t/g, '  ');
    if (!noComment.trim()) continue;
    const indent = noComment.match(/^ */)?.[0].length ?? 0;
    const line = noComment.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (line.startsWith('- ')) {
      const holder = stack[stack.length - 1];
      if (holder.parent && holder.key) {
        if (!Array.isArray(holder.parent[holder.key])) holder.parent[holder.key] = [];
        holder.parent[holder.key].push(parseYamlScalar(line.slice(2)));
      }
      continue;
    }
    const match = line.match(/^([^:]+):(.*)$/); if (!match) continue;
    const key = match[1].trim(); const rawValue = match[2].trim();
    if (rawValue === '') { parent[key] = {}; stack.push({ indent, obj: parent[key], parent, key }); }
    else parent[key] = parseYamlScalar(rawValue);
  }
  return root;
}

function expandHome(filePath: string): string { return filePath === '~' ? os.homedir() : filePath.startsWith('~/') ? path.join(os.homedir(), filePath.slice(2)) : filePath; }

export function lazygitConfigCandidates(): string[] {
  const env = process.env.LG_CONFIG_FILE?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  if (env.length) return env.map(expandHome);
  const home = os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const configDir = process.env.CONFIG_DIR;
  return [
    ...(configDir ? [path.join(expandHome(configDir), 'config.yml'), path.join(expandHome(configDir), 'config.yaml')] : []),
    path.join(xdg, 'lazygit', 'config.yml'),
    path.join(xdg, 'lazygit', 'config.yaml'),
    path.join(xdg, 'jesseduffield', 'lazygit', 'config.yml'),
    path.join(xdg, 'jesseduffield', 'lazygit', 'config.yaml'),
    path.join(home, 'Library', 'Application Support', 'lazygit', 'config.yml'),
    path.join(home, 'Library', 'Application Support', 'lazygit', 'config.yaml')
  ];
}

export function readLazyGitConfig(): LazyGitConfig {
  const keymap = cloneKeymap(); const gui = cloneGuiConfig(); const gitConfig = cloneGitConfig(); const customCommands: unknown[] = []; const loaded: string[] = [];
  const envFiles = process.env.LG_CONFIG_FILE?.split(',').map(s => s.trim()).filter(Boolean).map(expandHome) ?? [];
  for (const candidate of lazygitConfigCandidates()) {
    if (!fs.existsSync(candidate)) {
      if (envFiles.includes(candidate)) throw new Error(`LG_CONFIG_FILE points to missing lazygit config: ${candidate}`);
      continue;
    }
    const parsed = parseSimpleYaml(fs.readFileSync(candidate, 'utf8'));
    if (parsed.keybinding) deepMerge(keymap, parsed.keybinding);
    if (parsed.gui) deepMerge(gui, parsed.gui);
    if (parsed.git) deepMerge(gitConfig, parsed.git);
    if (Array.isArray(parsed.customCommands)) customCommands.push(...parsed.customCommands);
    if (parsed.keybinding || parsed.gui || parsed.git || parsed.customCommands) loaded.push(candidate);
  }
  return { keymap, gui, git: gitConfig, customCommands, files: loaded };
}

export function readLazyGitKeymap(): { keymap: LazyGitKeymap; files: string[] } {
  const config = readLazyGitConfig();
  return { keymap: config.keymap, files: config.files };
}
