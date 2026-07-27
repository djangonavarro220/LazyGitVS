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

const workspaceActions = fs.readFileSync(path.join(root, 'src', 'workspaceActions.ts'), 'utf8');
assert(workspaceActions.includes('let singleRichPreviewPanel'), 'commit/stash hover previews must retain one reusable webview instead of recreating open editors');
assert(workspaceActions.includes('let singleRichPreviewCreation'), 'concurrent commit refreshes must share one in-flight panel creation');
assert(workspaceActions.includes('await singleRichPreviewCreation'), 'a second preview request must await and reuse the in-flight webview');
assert(workspaceActions.includes('panel.title = title') && workspaceActions.includes('panel.webview.html = html'), 'moving over commits must update the existing rich preview in place');
assert(workspaceActions.includes('panel.reveal(vscode.ViewColumn.Active, preserveFocus)'), 'reused rich preview must reveal the existing tab without creating another open editor');
assert((workspaceActions.match(/createWebviewPanel\(/g) || []).length === 1, 'commit and stash previews must share one panel factory instead of recreating separate webviews');
assert(workspaceActions.includes("await showRichPreviewPanel(`LazyGitVS: Commit ${commit.hash}`"), 'commit previews must use the reusable panel host');
assert(workspaceActions.includes("await showRichPreviewPanel(`LazyGitVS: ${stash.ref}`"), 'stash previews must use the same reusable panel host');

assert(workspaceActions.includes("import { PreviewRequestGate } from './previewRequestGate'"), 'rich previews must use the tested latest-request-wins gate');
assert(workspaceActions.includes('richPreviewShouldOpen(`commit:${commit.hash}`)') && workspaceActions.includes('richPreviewShouldOpen(`stash:${stash.ref}`)'), 'commit and stash preview requests must claim keyed guards before awaiting Git');
assert((workspaceActions.match(/if \(!shouldOpen\(\)\) return;/g) || []).length >= 4, 'stale rich-preview work must be rejected both after Git and around asynchronous panel creation');
assert(workspaceActions.includes('async function showRichPreviewPanel(title: string, html: string, preserveFocus: boolean, shouldOpen: () => boolean)'), 'panel publication must accept a latest-request guard');
assert(workspaceActions.includes('await closeRichPreviewPanels();\n    if (!shouldOpen()) return;'), 'rich preview creation must close stale commit/stash webviews in every previewTabs mode before publishing');
const richCleanup = workspaceActions.match(/async function closeRichPreviewPanels\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert(richCleanup.includes("input?.viewType === 'lazygitvs.preview'") && !richCleanup.includes('tab.label'), 'rich cleanup must target only LazyGitVS preview viewType, never unrelated webviews with a similar label');
assert((workspaceActions.match(/preserveFocus, shouldOpen\);/g) || []).length >= 2, 'commit and stash previews must carry their generation guard through final publication');
assert(!workspaceActions.includes('return createRichPreviewPanel(title, html, preserveFocus);'), 'previewTabs multiple must not create one permanent webview per hovered commit');
assert(!workspaceActions.includes("richPreviewMode: 'single' | 'multiple'"), 'rich preview reuse must not depend on previewTabs mode');
assert(workspaceActions.includes("recordRichPreviewPanelLifecycle('created'"), 'real dogfood must observe exactly when a rich preview panel is created');
assert(workspaceActions.includes("recordRichPreviewPanelLifecycle('reused'"), 'real dogfood must observe in-place preview reuse');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');
assert(dogfood.includes("'lazygitvs.previewTabs': process.env.LGVS_DOGFOOD_FAST_PREVIEW_TABS ? 'multiple' : 'single'"), 'preview-tabs dogfood must reproduce the user configuration that previously accumulated commit editors');
assert(dogfood.includes('Commit/stash navigation physically keeps one rich-preview tab after each selection'), 'preview-tabs dogfood must verify the reported multiple-mode regression through real editor-tab state');
assert(dogfood.includes('function richPreviewHostLabels(labels)') && dogfood.includes('Commit\\s+[0-9a-f]+|stash@\\{\\d+\\}'), 'rich-preview tab counts must canonicalize accessibility duplicates while excluding native file/diff previews');

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
