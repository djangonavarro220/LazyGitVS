const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

assert(extension.includes("kind === 'index' ? 'S' : 'U'"), 'Files badges must show S/U lanes, not ambiguous raw M/M porcelain');
assert(extension.includes("f.untracked ? [' ', '?']"), 'Untracked files should not render duplicate ?/? badges');
assert(!extension.includes('<span class="meta">${escapeHtml(fileStateLabel(file))}</span>'), 'Files rows must not render clipped staged/unstaged meta text in the narrow SCM sidebar');
assert(extension.includes('.row.file{grid-template-columns:7px 42px minmax(0,1fr);}'), 'Files rows should reserve fixed badge columns and give the rest to the path');
assert(!extension.includes('class="focusline'), 'Sidebar panels must not render the noisy Focus: LG panel footer line');
assert(extension.includes('const footer = isActiveView && this.statusLine ?'), 'Panel footer should be reserved for real status messages only');
assert(extension.includes("this.setFocusArea('viewer');\n    this.renderAll();\n    await this.openCurrent(viewPanel, false);"), 'Focusing the hunk/main viewer must immediately repaint panels without active file selection');
assert(extension.includes("if (!preserveFocus) { this.ownsModeStatus = false; this.setFocusArea('viewer'); this.renderAll(); }"), 'Opening a non-preserved hunk/file viewer must clear panel selection before showing the viewer');

console.log('filesPanelUx tests passed');
