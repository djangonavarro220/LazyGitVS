const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const configSource = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');
const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

assert(configSource.includes("pushFiles: 'P'"), 'LazyGit names the global push key pushFiles; LGVS must read the real lazygit config key, not invent universal.push');
assert(configSource.includes("pullFiles: 'p'"), 'LazyGit names the global pull key pullFiles; pressing p in 2 Files should route through pullFiles');
assert(!configSource.includes("push: 'P'"), 'Do not keep LGVS-only universal.push in the default keymap; it silently ignores lazygit user configs');
assert(!configSource.includes("pull: 'p'"), 'Do not keep LGVS-only universal.pull in the default keymap; it silently ignores lazygit user configs');
assert(extensionSource.includes("hit(e,u.pushFiles,u.push)"), 'Webview key routing must prefer lazygit universal.pushFiles, with legacy u.push only as fallback');
assert(extensionSource.includes("hit(e,u.pullFiles,u.pull)"), 'Webview key routing must prefer lazygit universal.pullFiles, with legacy u.pull only as fallback');
assert(extensionSource.includes("function keysEqual(expected,typed){ if(expected.startsWith('<')&&expected.endsWith('>'))return expected.toLowerCase()===typed.toLowerCase(); return expected===typed; }"), 'Webview key matching must be case-sensitive for printable lazygit keys: p must not match P/pushFiles');
assert(!extensionSource.includes("String(b).toLowerCase() === k.toLowerCase()"), 'Webview hit() must not compare every key case-insensitively; that makes p trigger P actions');
assert(extensionSource.includes("if(hit(e,u.pushFiles,u.push)){e.preventDefault();vscode.postMessage({type:'push'});return;}"), 'LazyGit P is Push, not a Push options menu');
assert(extensionSource.includes("if(hit(e,u.pullFiles,u.pull)){e.preventDefault();vscode.postMessage({type:'pull'});return;}"), 'LazyGit p is Pull, not a Pull/fetch options menu');
assert(extensionSource.includes("if (type === 'push') await this.push();"), 'Push keypress must execute the push workflow directly');
assert(extensionSource.includes("if (type === 'pull') await this.pull();"), 'Pull keypress must execute the pull workflow directly');
assert(extensionSource.includes("if (type === 'fetch') await this.fetch();"), 'Files f is Fetch directly in lazygit, not the pull/fetch menu');
assert(extensionSource.includes("key(u.pushFiles) || key(u.push) || 'P'"), 'Context command catalogs/help should show P as lazygit pushFiles');
assert(extensionSource.includes("key(u.pullFiles) || key(u.pull) || 'p'"), 'Context command catalogs/help should show p as lazygit pullFiles');
assert(extensionSource.includes("if(panel==='files'&&hit(e,f.copyFileInfoToClipboard))"), 'Files y must copy file info; lazygit config key is files.copyFileInfoToClipboard');
assert(extensionSource.includes("if(panel==='files'&&hit(e,f.copyPath,u.copyToClipboard))"), 'Files ctrl-o must copy path, matching lazygit Files copy path behavior');
assert(extensionSource.includes("if(panel!=='files'&&hit(e,u.copyToClipboard))"), 'Global copyToClipboard must not steal Files y/copy semantics');

console.log('lazygitWorkflowParity tests passed');
