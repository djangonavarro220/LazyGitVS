const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(src.includes('class VirtualPreviewProvider implements vscode.TextDocumentContentProvider'), 'missing virtual preview provider');
assert(src.includes("registerTextDocumentContentProvider('lazygitvs-preview'"), 'missing lazygitvs-preview provider registration');
assert(src.includes("vscode.workspace.openTextDocument(uri)"), 'showText should open virtual preview URI');
assert(!src.includes("openTextDocument({ content: stripAnsi(content), language: 'diff' })"), 'showText must not create Untitled content buffers');
assert(src.includes('stripAnsi(content)'), 'showText should keep ANSI stripping before preview');

console.log('virtualPreview tests passed');
