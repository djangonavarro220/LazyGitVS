const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

assert(extension.includes('>${escapeHtml(ch)}</span>`'), 'Files badges must render lazygit original short-status letters, not LGVS S/U ownership labels');
assert(!extension.includes("kind === 'index' ? 'S' : 'U'"), 'Files badges must not show invented S/U labels in the Files panel');
assert(extension.includes("[f.xy[0] ?? ' ', f.xy[1] ?? ' ']"), 'Files panel should preserve both lazygit short-status columns, including ?? for untracked files');
assert(extension.includes('.slot{display:inline-grid;place-items:center;min-width:15px;height:15px;border-radius:0;font-size:12px;font-weight:600;line-height:1;border:0;background:transparent;box-sizing:border-box}'), 'Files short-status letters should look like VS Code SCM text, not pill/circular badges');
assert(extension.includes('.row.sel .slot.index{color:var(--vscode-gitDecoration-addedResourceForeground,#6a9955)}.row.sel .slot.worktree{color:var(--vscode-gitDecoration-modifiedResourceForeground,#e06c75)}'), 'Selected Files rows must keep staged green and unstaged red short-status letters');
assert(!extension.includes('<span class="meta">${escapeHtml(fileStateLabel(file))}</span>'), 'Files rows must not render clipped staged/unstaged meta text in the narrow SCM sidebar');
assert(extension.includes('.row.file{grid-template-columns:7px 42px minmax(0,1fr);}'), 'Files rows should reserve fixed badge columns and give the rest to the path');
assert(!extension.includes('class="focusline'), 'Sidebar panels must not render the noisy Focus: LG panel footer line');
assert(extension.includes('const footer = isActiveView && this.statusLine ?'), 'Panel footer should be reserved for real status messages only');
assert(extension.includes("this.setFocusArea('viewer');\n    this.renderAll();\n    await this.openCurrent(viewPanel, false);"), 'Focusing the hunk/main viewer must immediately repaint panels without active file selection');
assert(extension.includes("if (!preserveFocus) { this.ownsModeStatus = false; this.setFocusArea('viewer'); this.renderAll(); }"), 'Opening a non-preserved hunk/file viewer must clear panel selection before showing the viewer');

console.log('filesPanelUx tests passed');
