const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extension = [
  'extension.ts',
  'gitMenus.ts'
].map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');

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

test('Git actions are extracted into an executable action module, not buried in extension.ts', () => {
  assert(exists('src/gitActions.ts'), 'src/gitActions.ts must exist');
  const actions = read('src/gitActions.ts');
  for (const symbol of [
    'toggleStage',
    'toggleStageAll',
    'toggleStageSelected',
    'hunksForFile',
    'applyHunk',
    'discardUnstagedHunk',
    'applyLine',
    'discardUnstagedLine',
    'gitDiffConfigArgs'
  ]) {
    assert(new RegExp(`export (async function|function) ${symbol}\\b`).test(actions), `gitActions must export ${symbol}`);
    assert(!new RegExp(`^(async )?function ${symbol}\\b`, 'm').test(extension), `extension.ts must not still define ${symbol}`);
  }
  assert(extension.includes("from './gitActions'"), 'extension.ts must import the extracted action module');
});

test('Destructive action prompts have a central helper contract, not one-off modal strings everywhere', () => {
  assert(exists('src/destructiveActions.ts'), 'src/destructiveActions.ts must exist');
  const destructive = read('src/destructiveActions.ts');
  assert.match(destructive, /export type DestructiveSeverity = 'discard' \| 'history-rewrite' \| 'nuke'/);
  assert.match(destructive, /export function dangerousGitMenuItem/);
  assert.match(destructive, /danger: true/);
  assert.match(destructive, /confirm:/);
  assert(extension.includes("from './destructiveActions'"), 'extension.ts must use destructive action helpers');
  assert.match(extension, /dangerousGitMenuItem\(\{ key: 'h', label: '\$\(warning\) Hard reset to commit'/, 'commit hard reset must use central helper');
  assert.match(extension, /dangerousGitMenuItem\(\{ key: 'n', label: '💣 Nuke working tree'/, 'nuke path must use central helper');
  assert.match(extension, /dangerousGitMenuItem\(\{ key: 'u', label: '\$\(discard\) Discard unstaged changes'/, 'file discard must use central helper');
});

test('Coverage tooling exercises compiled non-VS-Code modules with an enforceable threshold', () => {
  assert(pkg.scripts.coverage, 'package.json must expose npm run coverage');
  assert.match(pkg.scripts.coverage, /scripts\/run-coverage\.js/);
  assert(exists('scripts/run-coverage.js'), 'scripts/run-coverage.js must exist');
  const runner = read('scripts/run-coverage.js');
  assert.match(runner, /c8/);
  assert.match(runner, /--check-coverage/);
  assert.match(runner, /--lines/);
  assert.match(runner, /src\/hunkPatch\.ts|out\/hunkPatch\.js/);
});

test('Webview security is guarded by reusable safe serialization and strict message validation', () => {
  assert(exists('src/webviewSecurity.ts'), 'src/webviewSecurity.ts must exist');
  const security = read('src/webviewSecurity.ts');
  assert.match(security, /export function scriptJson/);
  assert.match(security, /\\u003c/);
  assert.match(security, /export function webviewContentSecurityPolicy/);
  assert.match(security, /script-src 'nonce-\$\{nonce\}'/);
  assert.match(security, /export function normalizeWebviewMessage/);
  assert.match(security, /allowedMessageTypes/);
  assert(extension.includes("from './webviewSecurity'"), 'extension.ts must consume webview security helpers');
  assert(!/if \(msg\.type ===/.test(extension), 'extension.ts message dispatch should use normalized message type, not raw msg.type chains');
});

test('Dogfood harness has wait/assert helpers instead of only fixed sleeps and raw innerText checks', () => {
  assert.match(dogfood, /async function waitForText\(/, 'dogfood must include a reusable waitForText helper');
  assert.match(dogfood, /function addCheck\(/, 'dogfood must include a reusable addCheck assertion helper');
  assert.match(dogfood, /waitForText\(Runtime/, 'dogfood scenarios must use waitForText');
  assert.match(dogfood, /addCheck\(checks,/, 'dogfood scenarios must route checks through addCheck');
});
