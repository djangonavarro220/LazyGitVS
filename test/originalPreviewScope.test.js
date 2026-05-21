const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

assert(!pkg.contributes.configuration.properties['lazygitvs.showPreviewHunkDecorations'], 'Original lazygit has no preview-hunk-decoration setting; normal preview should not expose staging selection toggles');
assert(extension.includes('const shouldDecorate = this.editorHunkMode;'), 'Editor hunk decorations must render only in LGVS HUNK/LINE mode');
assert(!extension.includes('showPreviewHunkDecorations'), 'No non-original setting path should re-enable preview hunk selection outside HUNK/LINE mode');
assert(extension.includes('if (!this.editorHunkMode) return;\n    const markerLine'), 'S/U gutter markers must only appear in real HUNK/LINE mode');
assert(extension.includes('blockedByUnstaged'), 'Staged editor decorations must exclude overlapping unstaged changed lines');
assert(extension.includes('excludeRangeLines(this.hunks.flatMap(h => hunkChangedEditorRanges(h, editor)), blockedByUnstaged)'), 'Staged side must not paint working-tree unstaged lines as staged');

console.log('originalPreviewScope tests passed');
