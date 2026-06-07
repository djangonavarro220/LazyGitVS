import { cloneGitConfig } from './lazygitConfig';
import { git, gitInput, type ChangedFile, type LazyGitGitRuntimeConfig } from './gitService';
import { assertPatchableHunk, parseDiffHunks, singleLinePatch, type Hunk } from './hunkPatch';

export async function toggleStage(file: ChangedFile) { if (file.staged) { if (file.xy[0] === 'A') await git(['rm', '--cached', '--', file.path]); else await git(['restore', '--staged', '--', file.path]); } else await git(['add', '--', file.path]); }
export async function toggleStageAll(files: ChangedFile[]) { if (files.some(f => f.untracked || f.xy[1] !== ' ')) await git(['add', '-A']); else await git(['restore', '--staged', '.']); }
export async function toggleStageSelected(files: ChangedFile[]) {
  const paths = files.map(f => f.path).filter(Boolean);
  if (!paths.length) return;
  if (files.some(f => f.untracked || f.xy[1] !== ' ')) await git(['add', '--', ...paths]);
  else {
    for (const file of files) {
      if (file.xy[0] === 'A') await git(['rm', '--cached', '--', file.path]);
      else await git(['restore', '--staged', '--', file.path]);
    }
  }
}

export async function hunksForFile(file: ChangedFile, gitConfig: LazyGitGitRuntimeConfig = cloneGitConfig()): Promise<Hunk[]> {
  if (file.untracked) return [];
  const hunks: Hunk[] = [];
  const diffArgs = ['diff', '--unified=0', ...gitDiffConfigArgs(gitConfig, false).filter(arg => !arg.startsWith('--unified=')), '--', file.path];
  const cachedDiffArgs = ['diff', '--cached', '--unified=0', ...gitDiffConfigArgs(gitConfig, false).filter(arg => !arg.startsWith('--unified=')), '--', file.path];
  if (file.xy[1] !== ' ') hunks.push(...parseDiffHunks(await git(diffArgs), false));
  if (file.staged) hunks.push(...parseDiffHunks(await git(cachedDiffArgs), true));
  return hunks;
}
export function gitDiffConfigArgs(gitConfig: LazyGitGitRuntimeConfig, includeWhitespace: boolean): string[] {
  const args: string[] = [];
  const context = Number(gitConfig.diffContextSize);
  if (Number.isInteger(context) && context >= 0) args.push(`--unified=${context}`);
  if (includeWhitespace && gitConfig.ignoreWhitespaceInDiffView) args.push('--ignore-all-space');
  return args;
}
function zeroContextPatch(patch: string): boolean {
  const lines = patch.split('\n');
  const headerIndex = lines.findIndex(line => line.startsWith('@@ '));
  if (headerIndex < 0) return false;
  const body = lines.slice(headerIndex + 1).filter(line => line !== '');
  return body.length > 0 && body.every(line => line.startsWith('+') || line.startsWith('-'));
}
function gitApplyArgs(base: string[], patch: string, forceUnidiffZero = false): string[] {
  return forceUnidiffZero || zeroContextPatch(patch) || /\n@@ [^\n]*,0 [^\n]*@@|\n@@ [^\n]* [^\n]*,0 @@|^@@ [^\n]*,0 [^\n]*@@|^@@ [^\n]* [^\n]*,0 @@/.test(patch) ? [...base, '--unidiff-zero'] : base;
}
export async function applyHunk(hunk: Hunk) { assertPatchableHunk(hunk, hunk.staged ? 'unstage hunk' : 'stage hunk'); const args = hunk.staged ? ['apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount'] : ['apply', '--cached', '--whitespace=nowarn', '--recount']; await gitInput(gitApplyArgs(args, hunk.patch), hunk.patch); }
export async function discardUnstagedHunk(hunk: Hunk) { assertPatchableHunk(hunk, 'discard hunk'); if (hunk.staged) throw new Error('Discard only applies to unstaged hunks.'); const args = ['apply', '--reverse', '--whitespace=nowarn', '--recount']; await gitInput(gitApplyArgs(args, hunk.patch), hunk.patch); }


export async function applyLine(hunk: Hunk, changedIndex: number) {
  const linePatch = singleLinePatch(hunk, changedIndex);
  const args = hunk.staged ? ['apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount'] : ['apply', '--cached', '--whitespace=nowarn', '--recount'];
  await gitInput(gitApplyArgs(args, linePatch, true), linePatch);
}
export async function discardUnstagedLine(hunk: Hunk, changedIndex: number) {
  const linePatch = singleLinePatch(hunk, changedIndex);
  const args = ['apply', '--reverse', '--whitespace=nowarn', '--recount'];
  await gitInput(gitApplyArgs(args, linePatch, true), linePatch);
}
