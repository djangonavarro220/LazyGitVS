export type Hunk = { header: string; summary: string; patch: string; staged: boolean };

const DIFF_HEADER_PREFIXES = [
  'diff --git ', 'index ', '--- ', '+++ ', 'new file mode ', 'deleted file mode ',
  'old mode ', 'new mode ', 'similarity index ', 'dissimilarity index ',
  'rename from ', 'rename to ', 'copy from ', 'copy to '
];

export function parseDiffHunks(diff: string, staged: boolean): Hunk[] {
  const lines = diff.split('\n');
  let header: string[] = [];
  const hunks: Hunk[] = [];
  let current: string[] | undefined;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) hunks.push(makeHunk(header, current, staged));
      header = [line];
      current = undefined;
      continue;
    }
    if (line.startsWith('@@ ')) {
      if (current) hunks.push(makeHunk(header, current, staged));
      current = [line];
    } else if (current) {
      current.push(line);
    } else if (DIFF_HEADER_PREFIXES.some(prefix => line.startsWith(prefix))) {
      header.push(line);
    }
  }
  if (current) hunks.push(makeHunk(header, current, staged));
  return hunks.filter(isPatchableHunk);
}

export function makeHunk(header: string[], hunkLines: string[], staged: boolean): Hunk {
  const body = trimTrailingEmptyDiffLines(hunkLines);
  const headerLine = hunkLines[0] ?? '@@';
  const changed = body.find(line => isChangedDiffLine(line));
  return { header: headerLine, summary: changed ? changed.slice(0, 90) : headerLine, patch: `${header.join('\n')}\n${body.join('\n')}\n`, staged };
}

function trimTrailingEmptyDiffLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') end--;
  return lines.slice(0, end);
}

export function isPatchableHunk(hunk: Hunk): boolean {
  return hunk.patch.includes('\n@@ ') || hunk.patch.startsWith('@@ ') || /^@@ /.test(hunk.header);
}

export function assertPatchableHunk(hunk: Hunk, action: string) {
  if (!isPatchableHunk(hunk)) throw new Error(`Cannot ${action}: selected change has no textual patch. Use file-level action instead.`);
}

export function hunkBodyLines(hunk: Hunk): string[] {
  const lines = hunk.patch.split('\n');
  const start = lines.findIndex(line => line.startsWith('@@ '));
  return start >= 0 ? lines.slice(start + 1).filter(line => line !== '') : [];
}

export function hunkChangedLineIndexes(hunk: Hunk): number[] {
  return hunkBodyLines(hunk).map((line, index) => ({ line, index })).filter(item => isChangedDiffLine(item.line)).map(item => item.index);
}

export function hunkSelectableLineIndexes(hunk: Hunk): number[] {
  const body = hunkBodyLines(hunk);
  const indexes: number[] = [];
  for (let i = 0; i < body.length;) {
    if (!isChangedDiffLine(body[i])) { i++; continue; }
    const blockStart = i;
    while (i < body.length && isChangedDiffLine(body[i])) i++;
    const blockIndexes = range(blockStart, i);
    const deletions = blockIndexes.filter(index => body[index].startsWith('-'));
    const additions = blockIndexes.filter(index => body[index].startsWith('+'));
    const pairCount = Math.min(deletions.length, additions.length);
    indexes.push(...additions.slice(0, pairCount));
    if (deletions.length > pairCount) indexes.push(...deletions.slice(pairCount));
    if (additions.length > pairCount) indexes.push(...additions.slice(pairCount));
  }
  return indexes;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
}

function replacementCounterpartIndex(body: string[], changedIndex: number): number | undefined {
  if (!isChangedDiffLine(body[changedIndex] ?? '')) return undefined;
  let start = changedIndex;
  while (start > 0 && isChangedDiffLine(body[start - 1])) start--;
  let end = changedIndex + 1;
  while (end < body.length && isChangedDiffLine(body[end])) end++;
  const blockIndexes = range(start, end);
  const deletions = blockIndexes.filter(index => body[index].startsWith('-'));
  const additions = blockIndexes.filter(index => body[index].startsWith('+'));
  if (!deletions.length || !additions.length) return undefined;
  if (body[changedIndex].startsWith('+')) {
    const ordinal = additions.indexOf(changedIndex);
    return ordinal >= 0 && ordinal < deletions.length ? deletions[ordinal] : undefined;
  }
  if (body[changedIndex].startsWith('-')) {
    const ordinal = deletions.indexOf(changedIndex);
    return ordinal >= 0 && ordinal < additions.length ? additions[ordinal] : undefined;
  }
  return undefined;
}

export function hunkStartLine(hunk: Hunk): number {
  const m = hunk.header.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return Math.max(0, Number(m?.[1] ?? 1) - 1);
}

export function hunkNewLineCount(hunk: Hunk): number {
  const m = hunk.header.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,(\d+))? @@/);
  return Math.max(1, Number(m?.[1] ?? 1));
}

export function hunkChangedEditorLine(hunk: Hunk, changedIndex: number): number {
  const body = hunkBodyLines(hunk);
  let newLine = hunkStartLine(hunk);
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (i === changedIndex) return Math.max(0, newLine);
    if (!line.startsWith('-')) newLine++;
  }
  return hunkStartLine(hunk);
}

export function singleLinePatch(hunk: Hunk, changedIndex: number): string {
  assertPatchableHunk(hunk, hunk.staged ? 'unstage line' : 'stage line');
  const lines = hunk.patch.split('\n');
  const headerIndex = lines.findIndex(line => line.startsWith('@@ '));
  if (headerIndex < 0) throw new Error('Cannot build line patch: hunk header missing.');
  const fileHeader = lines.slice(0, headerIndex);
  const originalHeader = lines[headerIndex];
  const body = lines.slice(headerIndex + 1).filter(line => line !== '');
  const selected = body[changedIndex];
  if (!selected || !isChangedDiffLine(selected)) throw new Error('Cannot build line patch: selected row is context, not a changed line.');

  const keepIndexes = new Set<number>([changedIndex]);
  const counterpart = replacementCounterpartIndex(body, changedIndex);
  if (counterpart !== undefined) keepIndexes.add(counterpart);
  const kept: string[] = [];
  for (let i = 0; i < body.length;) {
    const line = body[i];
    if (line.startsWith(' ')) { kept.push(line); i++; continue; }
    if (!isChangedDiffLine(line)) { i++; continue; }
    const blockStart = i;
    while (i < body.length && isChangedDiffLine(body[i])) i++;
    const blockIndexes = range(blockStart, i);
    const deletions = blockIndexes.filter(index => body[index].startsWith('-'));
    const additions = blockIndexes.filter(index => body[index].startsWith('+'));
    const max = Math.max(deletions.length, additions.length);
    for (let ordinal = 0; ordinal < max; ordinal++) {
      const deletionIndex = deletions[ordinal];
      const additionIndex = additions[ordinal];
      const selectedPair = keepIndexes.has(deletionIndex) || keepIndexes.has(additionIndex);
      if (selectedPair) {
        if (deletionIndex !== undefined) kept.push(body[deletionIndex]);
        if (additionIndex !== undefined) kept.push(body[additionIndex]);
      } else if (!hunk.staged && deletionIndex !== undefined) kept.push(` ${body[deletionIndex].slice(1)}`);
      else if (hunk.staged && additionIndex !== undefined) kept.push(` ${body[additionIndex].slice(1)}`);
    }
  }
  const oldCount = kept.filter(line => !line.startsWith('+')).length;
  const newCount = kept.filter(line => !line.startsWith('-')).length;
  const match = originalHeader.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
  if (!match) throw new Error(`Cannot build line patch: unsupported hunk header ${originalHeader}`);
  const header = `@@ -${hunkRange(match[1], oldCount)} +${hunkRange(match[2], newCount)} @@${match[3] ?? ''}`;
  return `${fileHeader.join('\n')}\n${header}\n${kept.join('\n')}\n`;
}

function hunkRange(start: string, count: number): string {
  return count === 1 ? start : `${start},${count}`;
}

function isChangedDiffLine(line: string): boolean {
  return ((line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---')));
}
