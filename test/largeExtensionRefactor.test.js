const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test('extension.ts delegates panel types and constants to a navigation module', () => {
  assert(exists('src/panels.ts'), 'panel types/constants must live in src/panels.ts');
  const panels = read('src/panels.ts');
  assert.match(panels, /export type Panel =/, 'Panel type must be exported from panels.ts');
  assert.match(panels, /export const PANEL_ORDER/, 'PANEL_ORDER must be exported from panels.ts');
  assert.match(extension, /from '\.\/panels'/, 'extension.ts must import panel types/constants');
  assert(!/^type Panel = /m.test(extension), 'extension.ts must not keep Panel type inline');
});

test('extension.ts delegates row rendering helpers to a renderer module', () => {
  assert(exists('src/panelRows.ts'), 'row rendering helpers must live in src/panelRows.ts');
  const rows = read('src/panelRows.ts');
  assert.match(rows, /export function row\(/, 'row renderer must be exported');
  assert.match(rows, /export function fileStatusHtml\(/, 'file status renderer must be exported');
  assert.match(rows, /export function escapeHtml\(/, 'HTML escaping must stay close to row rendering');
  assert(!/^function row\(/m.test(extension), 'extension.ts must not keep row renderer inline');
  assert(!/^function escapeHtml\(/m.test(extension), 'extension.ts must not keep HTML escaping inline');
});

test('extension.ts delegates Git action menus to a git menus module', () => {
  assert(exists('src/gitMenus.ts'), 'Git QuickPick menus must live in src/gitMenus.ts');
  const menus = read('src/gitMenus.ts');
  assert.match(menus, /export async function showPushMenu\(/, 'push menu must be exported');
  assert.match(menus, /export async function showDiscardHunkMenu\(/, 'discard hunk menu must be exported');
  assert.match(menus, /dangerousGitMenuItem/, 'destructive action confirmations must stay in the extracted menu module');
  assert(!/^async function showPushMenu\(/m.test(extension), 'extension.ts must not keep push menu inline');
  assert(!/^async function pickGitAction\(/m.test(extension), 'extension.ts must not keep generic Git QuickPick plumbing inline');
});

test('extension.ts is materially smaller after the large refactor', () => {
  const lineCount = extension.split('\n').length;
  assert(lineCount < 1800, `extension.ts should be below 1800 lines after this refactor, got ${lineCount}`);
});
