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
assert(richPreview.includes('class="stat-file"') && richPreview.includes('class="stat-bar"'), 'Summary stats should render as structured rows with visual bars, not monospaced raw git --stat text');

const { commitPatchPreviewHtml } = require('../out/richPreview.js');
const html = commitPatchPreviewHtml({ title: 'Commit abc123', hash: 'abc123', subject: 'Pretty summary' }, `commit abc123
Author: Test <t@example.test>
Date: today

    Pretty summary

 AGENTS.md                                     |  3 +++
 README.md                                     |  2 +-
 scripts/lifeos.py                             |  2 +-
 skills/life-os/SKILL.md                       | 15 ++++++++-------
 4 files changed, 14 insertions(+), 8 deletions(-)
---

diff --git a/README.md b/README.md
index 123..456 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
`);
assert(html.includes('class="stats-list"'), 'Rendered preview should contain a structured stats list');
assert(html.includes('class="stat-file">AGENTS.md</span>'), 'Summary should expose filenames as their own visual column');
assert(html.includes('class="stat-count">3</span>'), 'Summary should expose changed line counts as their own visual column');
assert(html.includes('class="stat-plus">+++</span>'), 'Summary should style insertions separately');
assert(html.includes('class="stat-minus">-</span>'), 'Summary should style deletions separately');
assert(html.includes('class="stat-total">4 files changed, 14 insertions(+), 8 deletions(-)</div>'), 'Summary total should be rendered separately from file rows');
assert(!html.includes('class="stat-raw">---</div>'), 'Summary should not render the git stat separator as a stray raw row');

console.log('commitPreviewUx tests passed');
