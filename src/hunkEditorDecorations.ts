import * as vscode from 'vscode';
import { hunkBodyLines, hunkChangedEditorLine, hunkSelectableLineIndexes, hunkStartLine, type Hunk } from './hunkPatch';

export function editorLineRange(editor: vscode.TextEditor, lineIndex: number): vscode.Range {
  const line = Math.min(Math.max(0, lineIndex), Math.max(0, editor.document.lineCount - 1));
  return new vscode.Range(line, 0, line, editor.document.lineAt(line).range.end.character);
}

export function hunkChangedEditorRanges(hunk: Hunk, editor: vscode.TextEditor): vscode.Range[] {
  const changed = hunkSelectableLineIndexes(hunk);
  if (!changed.length) return [editorLineRange(editor, hunkStartLine(hunk))];
  const lines = Array.from(new Set(changed.map(index => hunkChangedEditorLine(hunk, index)))).sort((a, b) => a - b);
  return lines.map(line => editorLineRange(editor, line));
}

export function deletedGhostDecorations(hunk: Hunk, editor: vscode.TextEditor): vscode.DecorationOptions[] {
  const body = hunkBodyLines(hunk);
  const groups = new Map<number, string[]>();
  let newLine = hunkStartLine(hunk);
  for (const line of body) {
    if (line.startsWith('-')) {
      const anchor = Math.min(Math.max(0, newLine), Math.max(0, editor.document.lineCount - 1));
      const deleted = line.slice(1) || '␠';
      groups.set(anchor, [...(groups.get(anchor) ?? []), deleted]);
    } else if (!line.startsWith('\\')) newLine++;
  }
  return [...groups.entries()].map(([line, deleted]) => ({
    range: editorLineRange(editor, line),
    hoverMessage: `Deleted staged text:\n\n${deleted.map(text => `- ${text}`).join('\n')}`,
    renderOptions: { before: { contentText: deleted.map(text => `− ${text}`).join('  ⏎  '), color: '#f85149', backgroundColor: 'rgba(248,81,73,0.14)', fontStyle: 'italic', textDecoration: 'line-through; margin-right: 1ch;' } }
  }));
}

export function rangeLineSet(ranges: vscode.Range[]): Set<number> {
  return new Set(ranges.map(range => range.start.line));
}

export function excludeRangeLines(ranges: vscode.Range[], blocked: Set<number>): vscode.Range[] {
  return blocked.size ? ranges.filter(range => !blocked.has(range.start.line)) : ranges;
}
