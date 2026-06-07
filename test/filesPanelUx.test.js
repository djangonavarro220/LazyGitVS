const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = [
  'extension.ts',
  'panelRows.ts',
  'gitMenus.ts'
].map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n');

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
assert(!extension.includes('grid-template-columns:7px 52px minmax(0,1fr)'), 'Sidebar rows must not waste a fat fixed status column in narrow SCM views');
assert(extension.includes('.row{display:grid;grid-template-columns:7px 36px minmax(0,1fr)'), 'Default sidebar rows should use a compact status column and spend width on content');
assert(extension.includes('.row.file{grid-template-columns:7px 28px minmax(0,1fr);}'), 'Files rows should tighten the badge column so file names start earlier');
assert(extension.includes('.row.branch{grid-template-columns:7px 18px minmax(0,1fr) minmax(0,42px);}'), 'Branch rows should not waste horizontal space on a status column wider than the branch kind');
assert(extension.includes('.row.commit{grid-template-columns:7px 44px minmax(0,1fr);}'), 'Commit rows should show the short hash then spend the remaining width on the subject');
assert(!extension.includes("row(active && i===this.selected, 'file dir', r.collapsed ? '▸' : '▾', this.fileTreeLabel(r), '', i)"), 'File-tree directories must not render a second chevron in the status column and another in the label');
assert(!/private fileTreeLabel\([^)]*\)[^{]*\{[^}]*row\.collapsed \? '▸' : '▾'/.test(extension), 'File-tree labels must not embed chevrons; the original lazygit line has exactly one tree arrow');
assert(extension.includes('export function dirRow(sel: boolean, klass: string, row: FileTreeRow, index: number): string'), 'File-tree directories should use a dedicated lazygit-style row, not fake file status columns');
assert(extension.includes('export function treeFileRow(sel: boolean, klass: string, file: ChangedFile, main: string, depth: number, index: number): string'), 'Tree-mode files should indent before their short-status columns like original lazygit');
assert(extension.includes('while (visible.children.length === 1 && !visible.children[0].file)'), 'File tree should compress single-child directory chains like upstream lazygit instead of wasting one row per path segment');
assert(extension.includes("const labelFromDepth = (node: Node, treeDepth: number) => node.path.split('/').slice(treeDepth).join('/')"), 'Compressed file tree rows should display the real remaining path segment, e.g. karabiner/assets/complex_modifications');
assert(extension.includes('<span class="tree-name">${escapeHtml(row.label)}</span>'), 'Directory rows must render the computed tree label, not basename(path), so compressed paths remain visible');
assert(extension.includes("if (!this.lazygitGui.showFileTree) return files.map(file => ({ kind: 'file', path: file.path, label: file.path"), 'Flat file mode should keep full paths instead of truncating to basename');
assert(!extension.includes('.row.file.staged{border-left-color:'), 'Files panel must not add VS Code rail markers; original lazygit uses short-status letters, not a colored side rail');
assert(!extension.includes('.row.file.unstaged{border-left-color:'), 'Files panel must not add VS Code rail markers; original lazygit uses short-status letters, not a colored side rail');
assert(!extension.includes('border-left:2px solid transparent;'), 'Sidebar rows must not reserve a phantom rail column that lazygit original does not have');
assert(!extension.includes('class="focusline'), 'Sidebar panels must not render the noisy Focus: LG panel footer line');
assert(extension.includes("const footer = '';"), 'Panel footer should stay empty; do not leak branch/status hints into every sidebar panel');
assert(extension.includes("export async function showDiscardFileMenu(file: ChangedFile, confirmKey = 'x') { await pickGitAction(`Discard changes · ${file.path}`, [\n  dangerousGitMenuItem({ key: confirmKey, label: '$(warning) Discard all changes'"), 'Discard file menu must keep lazygit original order: discard all first');
assert(extension.includes("}, discardAllConfirmation(file.path), 'discard'),\n  dangerousGitMenuItem({ key: 'u', label: '$(discard) Discard unstaged changes'"), 'Discard file menu must keep lazygit original order: discard unstaged second');
assert(!extension.includes("label: '$(remove) Unstage staged changes'"), 'Discard file menu should not grow a non-lazygit unstage option; staging/unstaging is Space');
assert(extension.includes("this.setFocusArea('viewer');\n    this.renderAll();\n    await this.openCurrent(viewPanel, false);"), 'Focusing the hunk/main viewer must immediately repaint panels without active file selection');
assert(extension.includes("if (!preserveFocus) { this.ownsModeStatus = false; this.setFocusArea('viewer'); this.renderAll(); }"), 'Opening a non-preserved hunk/file viewer must clear panel selection before showing the viewer');
assert(extension.includes('Content-Security-Policy'), 'Webviews with scripts enabled must set an explicit CSP');
assert(extension.includes('script nonce="${nonce}"'), 'Webview scripts must use a nonce instead of blanket script-src permissions');
assert(extension.includes('const keymap=${scriptJson(this.lazygitKeymap)};'), 'Embedded webview JSON must escape script-breaking characters like < and U+2028');
assert(extension.includes("showWarningMessage('Discard selected line?', { modal: true }, 'Discard')"), 'Discarding an unstaged LINE from HUNK mode must require modal confirmation');

console.log('filesPanelUx tests passed');
