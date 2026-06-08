const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const gitService = fs.readFileSync(path.join(root, 'src', 'gitService.ts'), 'utf8');
const panelRows = fs.readFileSync(path.join(root, 'src', 'panelRows.ts'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

assert(gitService.includes('%(upstream:track)'), 'Branches must parse ahead/behind from git metadata instead of showing raw branch stdout');
assert(gitService.includes('--pretty=format:%h%x09%D%x09%s%x09%an%x09%ar'), 'Commits must fetch author/date fields for semantic UI rows');
assert(panelRows.includes('export function branchRow(sel: boolean, branch: Branch, index: number): string'), 'Branches need a dedicated semantic renderer, not the generic raw row');
assert(panelRows.includes('export function commitRow(sel: boolean, commit: Commit, index: number): string'), 'Commits need a dedicated semantic renderer, not the generic raw row');
assert(panelRows.includes('class="hash-pill"'), 'Commit hashes should render as VS Code-styled pills');
assert(!panelRows.includes('class="ref-chip'), 'Commit refs must not render as chips inside cramped one-line rows; they overlap real subjects in narrow sidebars');
assert(panelRows.includes('commit.refs ? ` · ${escapeHtml(commit.refs)}` :'), 'Commit refs should stay available in the title tooltip instead of burning row width');
assert(panelRows.includes('class="commit-main path"'), 'Commit rows should be compact one-line rows, matching the rest of the panels');
assert(!panelRows.includes('class="commit-block"'), 'Commit rows must not use a tall two-line block layout');
assert(extension.includes('.commit-row{grid-template-columns:7px 44px minmax(0,1fr) max-content;'), 'Commit CSS should keep one normal-height row with fixed hash, elastic subject, and right-aligned date');
assert(!extension.includes('height:34px'), 'Commit rows must not force a taller two-line height');
assert(panelRows.includes('class="ref-kind"'), 'Branch kind/current marker should render as a compact UI badge');
assert(extension.includes('branchRow(active && i===this.branchSelected, b, i)'), 'Branches panel must use the semantic branch row renderer');
assert(extension.includes('commitRow(active && i===this.commitSelected, c, i)'), 'Commits panel must use the semantic commit row renderer');
assert(extension.includes('var(--vscode-editorInlayHint-background)'), 'Ref list styling should use VS Code theme tokens, not hardcoded custom colors');
assert(extension.includes('var(--vscode-list-activeSelectionBackground)'), 'Ref list selection should stay native VS Code list-themed');
assert(!extension.includes("row(active && i===this.commitSelected, 'commit', c.hash, c.subject, compactRefs(c.refs), i)"), 'Commits must not regress to hash/subject/raw-meta generic rows');

console.log('refListUx tests passed');
