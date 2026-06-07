const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');

function readIfExists(rel) {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
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

test('npm test uses the repo-local deterministic runner instead of a huge shell chain', () => {
  const runner = readIfExists('scripts/run-tests.js');
  assert(runner, 'scripts/run-tests.js must exist');
  assert.strictEqual(pkg.scripts.test, 'npm run compile && node scripts/run-tests.js');
  assert(!/node test\/[^ ]+\.test\.js && node test\//.test(pkg.scripts.test), 'npm test must not be a giant chained list of node test files');
  assert.match(runner, /fs\.readdirSync\(path\.join\(ROOT, 'test'\)\)/, 'runner should discover test/*.test.js deterministically');
  assert.match(runner, /Failure summary/, 'runner must print a concise failure summary');
  assert.match(runner, /spawnSync\(process\.execPath/, 'runner must invoke tests through the current Node executable');
});

test('extension starts modularizing Git/workspace helpers out of src/extension.ts', () => {
  const gitService = readIfExists('src/gitService.ts');
  assert(gitService, 'src/gitService.ts must exist');
  assert(extension.includes("from './gitService'"), 'extension.ts must import Git/workspace helpers from gitService');
  assert(!extension.includes("import * as cp from 'child_process';"), 'extension.ts should no longer own child_process Git plumbing');
  assert(!extension.includes('let activeWorkspaceRoot: string | undefined;'), 'workspace-root state should live in gitService, not extension.ts');
  for (const symbol of ['workspaceRoot', 'setActiveWorkspaceRoot', 'git', 'gitInput', 'discoverWorkspaceRepositories', 'changedFiles', 'branches', 'tags', 'remotes', 'commits', 'stashes', 'commitFiles', 'stashFiles', 'conflictFiles']) {
    assert(new RegExp(`export (async function|function|type|let|const) ${symbol}|export \\{[^}]*${symbol}`).test(gitService), `gitService must export ${symbol}`);
  }
});

test('destructive Git actions are protected by explicit modal confirmation contracts', () => {
  assert(extension.includes("showWarningMessage(item.confirm ?? `Run ${item.label}?`, { modal: true }, 'Run')"), 'menu danger path must use modal confirmation and Run gate');
  const destructiveContracts = [
    ['force push with lease', /args: \['push', '--force-with-lease'\][^\n]+danger: true[^\n]+confirm:/],
    ['hard reset to commit', /args: \['reset', '--hard', commit\.hash\][^\n]+danger: true[^\n]+confirm:/],
    ['discard file', /args: \['restore', '--', file\.path\][^\n]+danger: true[^\n]+confirm:/],
    ['reset hard HEAD', /args: \['reset', '--hard', 'HEAD'\][^\n]+danger: true[^\n]+confirm:/],
    ['nuke working tree includes clean', /label: '💣 Nuke working tree'[^\n]+danger: true[^\n]+confirm:[^\n]+git\(\['reset', '--hard', 'HEAD'\]\)[^\n]+git\(\['clean', '-fd'\]\)/],
    ['stash drop', /key: 'd'[^\n]+Drop stash[^\n]+danger: true[^\n]+confirm:[^\n]+args: \['stash', 'drop', s\.ref\]/]
  ];
  for (const [name, pattern] of destructiveContracts) {
    assert(pattern.test(extension), `${name} must be marked danger with confirm text`);
  }
  assert.match(extension, /if \(ok !== 'Run'\) return false;/, 'cancel path must return before running destructive menu item');
  assert.match(extension, /label: '\$\(discard\) Discard hunk'[^\n]+danger: true[^\n]+confirm: 'Discard this unstaged hunk from the working tree\?'/, 'unstaged hunk discard must use modal confirmation via danger menu');
  assert.match(extension, /showWarningMessage\('Discard selected line\?', \{ modal: true \}, 'Discard'\)/, 'unstaged line discard must use modal confirmation');
});

test('dogfood coverage closes remaining HUNK and edge-file gaps', () => {
  assert(pkg.scripts['dogfood:ui:edge-files'], 'package.json must expose deleted/renamed/conflict dogfood lane');
  assert.match(pkg.scripts['dogfood:ui:edge-files'], /LGVS_DOGFOOD_EDGE_FILES=1/);
  assert.match(dogfood, /LGVS_DOGFOOD_EDGE_FILES/, 'dogfood fixture must support edge-file coverage');
  assert.match(dogfood, /HUNK j\/k wraps between first and last changed areas/, 'dogfood must assert HUNK j/k wrap');
  assert.match(dogfood, /HUNK decorations stay scoped to changed lines/, 'dogfood must assert changed-line-only decoration scope');
  assert.match(dogfood, /Deleted, renamed, and conflict files render in Files\/Conflicts UI/, 'dogfood must assert deleted/renamed/conflict UI path');
});
