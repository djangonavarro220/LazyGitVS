const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'src', 'lazygitConfig.ts'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

assert(config.includes("nextBlockAlt2: '<tab>'"), 'Default lazygit parity must include Tab as next panel/block');
assert(config.includes("prevBlockAlt2: '<backtab>'"), 'Default lazygit parity must include Shift+Tab/<backtab> as previous panel/block');
assert(extension.includes("const next = PANEL_ORDER[((currentIndex >= 0 ? currentIndex : 0) + delta + PANEL_ORDER.length) % PANEL_ORDER.length];"), 'Block movement must wrap through LazyGitVS panels, not move rows inside the current panel');
assert(extension.includes("if(hit(e,u.nextBlock,u.nextBlockAlt,u.nextBlockAlt2)){e.preventDefault();vscode.postMessage({type:'moveBlock',delta:1});return;}"), 'Sidebar Tab/right/l must move to the next panel');
assert(extension.includes("if(hit(e,u.prevBlock,u.prevBlockAlt,u.prevBlockAlt2)){e.preventDefault();vscode.postMessage({type:'moveBlock',delta:-1});return;}"), 'Sidebar Shift+Tab/left/h must move to the previous panel');
assert(extension.indexOf("if(hit(e,u.nextBlock,u.nextBlockAlt,u.nextBlockAlt2))") < extension.indexOf("if(hit(e,u.togglePanel))"), 'Panel navigation must win over legacy togglePanel Tab fallback');

console.log('panel tab navigation assertions passed');
