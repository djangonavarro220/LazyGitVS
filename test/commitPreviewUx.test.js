const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const richPreview = fs.existsSync(path.join(root, 'src', 'richPreview.ts'))
  ? fs.readFileSync(path.join(root, 'src', 'richPreview.ts'), 'utf8')
  : '';

assert(extension.includes('showCommitPreview(c,'), 'Commit list preview should use a rich semantic preview, not raw git show text');
assert(extension.includes('showStashPreview(s,'), 'Stash list preview should use a rich semantic preview, not raw stash show text');
assert(!extension.includes("showText(`LazyGitVS Commit ${c.hash}`, await git(this.showArgs('--stat', '--patch', c.hash))"), 'Commit preview must not dump raw git show --stat --patch output into a text editor');
assert(!extension.includes("showText(`LazyGitVS ${s.ref}`, await git(['stash', 'show', ...gitDiffConfigArgs(this.lazygitGit, true), '--stat', '--patch', s.ref])"), 'Stash preview must not dump raw stash show --stat --patch output into a text editor');
assert(richPreview.includes('export function commitPatchPreviewHtml'), 'Rich preview module should expose a pure HTML formatter for commit/stash patches');
assert(richPreview.includes('.diff-add') && richPreview.includes('.diff-del'), 'Rich preview should style added/deleted lines semantically instead of plain patch text');
assert(richPreview.includes('class="file-card"'), 'Rich preview should split file diffs into readable file cards');

console.log('commitPreviewUx tests passed');
