const fs = require('fs');
const path = require('path');

const extensionSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
const previewSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'previewDocuments.ts'), 'utf8');
const workspaceActionsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspaceActions.ts'), 'utf8');
const src = `${extensionSrc}\n${previewSrc}\n${workspaceActionsSrc}`;
const pkg = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(src.includes('class VirtualPreviewProvider implements vscode.TextDocumentContentProvider'), 'missing virtual preview provider');
assert(src.includes("registerTextDocumentContentProvider('lazygitvs-preview'") || (src.includes('registerTextDocumentContentProvider(VIRTUAL_PREVIEW_SCHEME') && src.includes("VIRTUAL_PREVIEW_SCHEME = 'lazygitvs-preview'")), 'missing lazygitvs-preview provider registration');
assert(src.includes("vscode.workspace.openTextDocument(uri)"), 'showText should open virtual preview URI');
assert(!src.includes("openTextDocument({ content: stripAnsi(content), language: 'diff' })"), 'showText must not create Untitled content buffers');
assert(src.includes('stripAnsi(content)'), 'showText should keep ANSI stripping before preview');
assert(pkg.includes('lazygitvs.previewTabs'), 'missing preview tab policy setting');
assert(pkg.includes('"default": "single"'), 'preview tab policy must default to a single dynamic LazyGitVS viewer');
assert(pkg.includes('"enum": [') && pkg.includes('"single"') && pkg.includes('"multiple"'), 'preview tab policy must preserve the old multi-tab behavior as an option');
assert(src.includes('closeLazyGitVSPreviewTabsIfSingle'), 'single preview mode must close older LazyGitVS preview tabs before opening a new dynamic one');
assert(src.includes('tab.label.startsWith(\'LazyGitVS:\')'), 'preview cleanup must target only LazyGitVS tabs, not user files');

console.log('virtualPreview tests passed');
