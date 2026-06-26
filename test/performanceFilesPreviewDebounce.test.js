const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

assert.match(extension, /private pendingFilesPreviewTimer\?: ReturnType<typeof setTimeout>;/, 'Files preview debounce must keep a cancellable timer');
assert.match(extension, /private filesPreviewEpoch = 0;/, 'Files preview debounce must use an epoch so stale scheduled previews cannot win');
assert.match(extension, /const epoch = \+\+this\.filesPreviewEpoch;/, 'Files preview debounce must issue an epoch per scheduled preview');
assert.match(extension, /const filePath = this\.currentFile\(\)\?\.path;/, 'Scheduled Files preview must capture the selected file path');
assert.match(extension, /setTimeout\(\(\) => \{[\s\S]*this\.openCurrent\(viewPanel, true, true, \{ epoch, filePath \}\)[\s\S]*\}, (1[5-9]\d|2[0-5]\d)\);/, 'Files navigation must schedule one short debounced list preview instead of opening every intermediate row');
assert.match(extension, /private cancelFilesPreview\(\).*this\.filesPreviewEpoch\+\+;/, 'Explicit actions must invalidate pending and in-flight Files previews');

for (const method of ['select', 'move', 'moveTo']) {
  const methodSource = extension.match(new RegExp(`private async ${method}\\(viewPanel: ViewPanel[\\s\\S]*?\\n  }`));
  assert(methodSource, `${method} method must exist`);
  assert(methodSource[0].includes("if (panel === 'files') this.scheduleFilesPreview(viewPanel); else await this.openCurrent(viewPanel, true).catch(() => undefined);"), `${method} must debounce Files preview after immediate render`);
  assert(!methodSource[0].includes("await this.openCurrent(viewPanel, true, panel === 'files')"), `${method} must not synchronously open/recalculate Files previews while navigating`);
}

assert.match(extension, /private async openCurrent\(viewPanel: ViewPanel, preserveFocus: boolean, forceListPreview = false, scheduledFilesPreview\?: \{ epoch: number; filePath\?: string \}\)/, 'Scheduled Files preview must pass epoch/path into openCurrent');
assert.match(extension, /if \(!scheduledFilesPreview\) this\.cancelFilesPreview\(\);/, 'Immediate preview/open paths must cancel pending navigation preview before opening');
assert.match(extension, /scheduledFilesPreview\.epoch !== this\.filesPreviewEpoch \|\| f\.path !== scheduledFilesPreview\.filePath/, 'Scheduled Files preview must bail before expensive work if the selected file changed');
assert.match(extension, /scheduledFilesPreview\.epoch !== this\.filesPreviewEpoch \|\| this\.currentFile\(\)\?\.path !== scheduledFilesPreview\.filePath/, 'Scheduled Files preview must bail after async hunk loading before showing stale preview');

assert.match(extension, /const shown = await previewDiff\(f, preserveFocus, \(\) => !scheduledFilesPreview \|\| \(scheduledFilesPreview\.epoch === this\.filesPreviewEpoch && this\.currentFile\(\)\?\.path === scheduledFilesPreview\.filePath\)\);\n        if \(!shown\) return;/, 'Scheduled Files preview must recheck epoch/path immediately before opening the diff');

const workspaceActions = fs.readFileSync(path.join(root, 'src', 'workspaceActions.ts'), 'utf8');
assert.match(workspaceActions, /export async function previewDiff\(file: ChangedFile \| ConflictFile, preserveFocus = true, shouldOpen = \(\) => true\)/, 'previewDiff must accept a pre-open guard for scheduled previews');
assert.match(workspaceActions, /await closeLazyGitVSPreviewTabsIfSingle\(\);\n  if \(!shouldOpen\(\)\) return false;/, 'previewDiff must recheck after async tab close and before vscode.diff');

console.log('performanceFilesPreviewDebounce tests passed');
