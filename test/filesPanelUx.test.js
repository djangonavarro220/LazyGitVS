const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

assert(extension.includes('>${escapeHtml(ch)}</span>`'), 'Files badges must render lazygit original short-status letters, not LGVS S/U ownership labels');
assert(!extension.includes("kind === 'index' ? 'S' : 'U'"), 'Files badges must not show invented S/U labels in the Files panel');
assert(extension.includes("[f.xy[0] ?? ' ', f.xy[1] ?? ' ']"), 'Files panel should preserve both lazygit short-status columns, including ?? for untracked files');
assert(extension.includes('.status-pair{display:grid;grid-template-columns:12px 12px;column-gap:2px;align-items:center;font-family:var(--vscode-editor-font-family);font-size:10px}'), 'Files short-status letters should render as compact adjacent colored boxes, not spaced-out floating text');
assert(extension.includes('.slot{display:inline-grid;place-items:center;width:12px;height:14px;border-radius:2px;font-size:10px;font-weight:700;line-height:1;box-sizing:border-box;color:var(--vscode-button-foreground,#fff)}'), 'Files short-status letters should use small colored square badges like the earlier readable version');
assert(extension.includes('.slot.index{background:var(--vscode-gitDecoration-addedResourceForeground,#6a9955)}'), 'Index/staged short-status boxes should keep the staged/green color');
assert(extension.includes('.slot.worktree{background:var(--vscode-gitDecoration-modifiedResourceForeground,#e06c75)}'), 'Worktree/unstaged short-status boxes should keep the modified/unstaged color');
assert(!extension.includes('.row.file.staged .path{color:'), 'Files path text must stay normal foreground; only the status boxes carry git colors');
assert(!extension.includes('.row.sel .slot{color:inherit}'), 'Selected Files rows must keep colored status boxes instead of washing them into selection foreground');
assert(!extension.includes('<span class="meta">${escapeHtml(fileStateLabel(file))}</span>'), 'Files rows must not render clipped staged/unstaged meta text in the narrow SCM sidebar');
assert(extension.includes('.row.file{grid-template-columns:7px 32px minmax(0,1fr);}'), 'Files rows should reserve only enough room for two compact status boxes and give the rest to the path');
assert(!extension.includes('class="focusline'), 'Sidebar panels must not render the noisy Focus: LG panel footer line');
assert(extension.includes('const footer = isActiveView && this.statusLine ?'), 'Panel footer should be reserved for real status messages only');
assert(extension.includes("this.setFocusArea('viewer');\n    this.renderAll();\n    await this.openCurrent(viewPanel, false);"), 'Focusing the hunk/main viewer must immediately repaint panels without active file selection');
assert(extension.includes("if (!preserveFocus) { this.ownsModeStatus = false; this.setFocusArea('viewer'); this.renderAll(); }"), 'Opening a non-preserved hunk/file viewer must clear panel selection before showing the viewer');

console.log('filesPanelUx tests passed');
