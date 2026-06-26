const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const gitService = fs.readFileSync(path.join(root, 'src', 'gitService.ts'), 'utf8');

const refreshMatch = extension.match(/private async refresh\(updatePreview: boolean\) \{[\s\S]*?\n  private activeViewPanel/);
assert(refreshMatch, 'Refresh implementation should remain discoverable for performance guards');
const refreshBody = refreshMatch[0];

assert(refreshBody.includes('const [files, branchItems, tagItems, remoteItems, commitItems, stashItems] = await Promise.all([changedFiles(this.lazygitGit)'), 'Refresh must include changed files in the parallel Git query batch');
assert(refreshBody.includes('this.conflictItems = conflictsFromChangedFiles(files);'), 'Refresh must derive conflicts from the already loaded changed files');
assert(!refreshBody.includes('conflictFiles().catch'), 'Refresh must not call conflictFiles(), which runs a duplicate git status');
assert(refreshBody.includes('await Promise.all(['), 'Refresh must parallelize independent Git queries after repository context is resolved');
for (const query of ['branches().catch(() => [])', 'tags().catch(() => [])', 'remotes().catch(() => [])', 'commits(this.commitListForBranch?.name).catch(() => [])', 'stashes().catch(() => [])']) {
  assert(refreshBody.includes(query), `Refresh parallel batch must include ${query}`);
}

assert(gitService.includes('export function conflictsFromChangedFiles(files: ChangedFile[]): ConflictFile[]'), 'gitService must expose a pure conflict derivation helper for refresh reuse');
assert(gitService.includes('return conflictsFromChangedFiles(await changedFiles());'), 'Standalone conflictFiles command should preserve existing behavior through the shared helper');
