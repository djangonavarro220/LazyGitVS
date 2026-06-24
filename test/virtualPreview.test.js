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
assert(!/openTextDocument\s*\(\s*\{\s*content\b/.test(src), 'LGVS generated preview text must not create Untitled content buffers via openTextDocument({ content })');
assert(src.includes('stripAnsi(content)'), 'showText should keep ANSI stripping before preview');
assert(pkg.includes('lazygitvs.previewTabs'), 'missing preview tab policy setting');
assert(pkg.includes('"default": "single"'), 'preview tab policy must default to a single dynamic LazyGitVS viewer');
assert(pkg.includes('"enum": [') && pkg.includes('"single"') && pkg.includes('"multiple"'), 'preview tab policy must preserve the old multi-tab behavior as an option');
assert(src.includes('closeLazyGitVSPreviewTabsIfSingle'), 'single preview mode must close older LazyGitVS preview tabs before opening a new dynamic one');
assert(src.includes('input?.uri?.scheme === VIRTUAL_PREVIEW_SCHEME'), 'single-preview cleanup must close lazygitvs-preview: virtual tabs without targeting ordinary user files by label only');
assert(src.includes("input?.viewType === 'lazygitvs.preview'"), 'single-preview cleanup must close older LazyGitVS webview preview tabs too');
assert(src.includes('input instanceof vscode.TabInputTextDiff') && src.includes("tab.label.startsWith('LazyGitVS:')"), 'legacy LazyGitVS: label fallback must be restricted to diff tabs, never ordinary user text files');
assert(src.includes('input instanceof vscode.TabInputWebview') && src.includes("tab.label.startsWith('LazyGitVS:')"), 'legacy LazyGitVS: webview preview fallback must be restricted to webview tabs, never ordinary user text files');
assert(!/\|\|\s*tab\.label\.startsWith\('LazyGitVS:'\)/.test(src), 'single-preview cleanup must not close ordinary tabs by label-only fallback');
assert(src.includes('scheme: VIRTUAL_PREVIEW_SCHEME') && src.includes("VIRTUAL_PREVIEW_SCHEME = 'lazygitvs-preview'"), 'virtual preview URIs must be named lazygitvs-preview: documents');

const dogfood = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dogfood-ui.js'), 'utf8');
assert(dogfood.includes('LGVS_DOGFOOD_FAST_PREVIEW_TABS'), 'preview-tabs dogfood lane must exist');
assert(dogfood.includes('lazygitvs-preview:'), 'preview-tabs dogfood must document/check the lazygitvs-preview: virtual document contract');
assert(dogfood.includes('Untitled'), 'preview-tabs dogfood must guard against Untitled preview buffer regressions');
assert(dogfood.includes('Default preview tab policy keeps only one dynamic LazyGitVS tab'), 'preview-tabs dogfood must assert the single-preview policy');
assert(dogfood.includes('^LazyGitVS\\b'), 'preview-tabs dogfood must count named virtual tabs like "LazyGitVS Branch ...", not only LazyGitVS: diff/webview tabs');

console.log('virtualPreview tests passed');
