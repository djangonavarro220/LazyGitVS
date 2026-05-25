#!/usr/bin/env node
/*
 * LazyGitVS UI dogfood harness.
 * Runs VS Code under CDP, drives the real workbench with keyboard input,
 * captures screenshots, and validates git state after staging flows.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync, execFileSync } = require('child_process');
const CDP = require('chrome-remote-interface');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dogfood-output');
const SHOTS = path.join(OUT, 'screenshots');
const VARIANT = process.env.LGVS_DOGFOOD_VARIANT || '';
const VARIANT_NAME = VARIANT || 'matrix';
const REPORT_JSON = path.join(OUT, VARIANT ? `last-run-${VARIANT}.json` : 'last-run.json');
const PORT = Number(process.env.LGVS_DOGFOOD_CDP_PORT || 9322);
const STEP_DELAY = Number(process.env.LGVS_DOGFOOD_STEP_DELAY || 900);
const THEME = process.env.LGVS_DOGFOOD_THEME || 'Default Light Modern';

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`);
  return r.stdout.trim();
}
function git(cwd, ...args) { return sh('git', args, { cwd }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, s) { ensureDir(path.dirname(p)); fs.writeFileSync(p, s); }
function append(p, s) { ensureDir(path.dirname(p)); fs.appendFileSync(p, s); }
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
async function waitFor(fn, timeoutMs = 30000, intervalMs = 250, label = 'condition') {
  const end = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastErr = e; }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastErr ? `: ${lastErr.message}` : ''}`);
}
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-dogfood-'));
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'lgvs@example.test');
  git(dir, 'config', 'user.name', 'LGVS Dogfood');
  write(path.join(dir, 'settings.json'), JSON.stringify({ alpha: 'one', beta: 'two', gamma: 'three', delta: 'four' }, null, 2) + '\n');
  write(path.join(dir, 'README.md'), '# LGVS dogfood\n\nbase\n');
  write(path.join(dir, 'src/app.ts'), 'export const value = 1;\n\nexport function greet() {\n  return "hello";\n}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'initial');
  git(dir, 'branch', 'feature/dogfood');
  git(dir, 'tag', 'v0.0.1');
  git(dir, 'remote', 'add', 'origin', 'https://example.invalid/lazygitvs-dogfood.git');

  write(path.join(dir, 'STASHED.md'), 'temporary stash evidence\n');
  git(dir, 'add', 'STASHED.md');
  git(dir, 'stash', 'push', '-m', 'dogfood stash entry');

  write(path.join(dir, 'settings.json'), JSON.stringify({ alpha: 'ONE', beta: 'two', gamma: 'three', delta: 'FOUR' }, null, 2) + '\n');
  git(dir, 'add', 'settings.json');
  write(path.join(dir, 'settings.json'), JSON.stringify({ alpha: 'ONE', beta: 'two', gamma: 'THREE', delta: 'FOUR' }, null, 2) + '\n');
  append(path.join(dir, 'README.md'), 'unstaged readme line\n');
  write(path.join(dir, 'src/app.ts'), 'export const value = 2;\n\nexport function greet() {\n  return "hello dogfood";\n}\n');
  const secondaryRepo = `${dir}-other-repo`;
  ensureDir(secondaryRepo);
  git(secondaryRepo, 'init');
  git(secondaryRepo, 'config', 'user.email', 'lgvs@example.test');
  git(secondaryRepo, 'config', 'user.name', 'LGVS Dogfood');
  write(path.join(secondaryRepo, 'OTHER_REPO_SENTINEL.md'), 'secondary repository baseline\n');
  git(secondaryRepo, 'add', '.');
  git(secondaryRepo, 'commit', '-m', 'initial secondary');
  append(path.join(secondaryRepo, 'OTHER_REPO_SENTINEL.md'), 'secondary repository changed\n');
  // Keep the primary keyboard flow on tracked files. Untracked files are useful,
  // but if they sort first they turn Enter into the no-hunk untracked edge case
  // and mask the real HUNK/LINE staging path.
  return dir;
}
function secondaryFixtureRepo(fixture) { return `${fixture}-other-repo`; }
function status(cwd) { return git(cwd, 'status', '--short'); }
function diffCachedNames(cwd) { return git(cwd, 'diff', '--cached', '--name-only'); }
function diffNames(cwd) { return git(cwd, 'diff', '--name-only'); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function installVSCodeVimExtension(extensionsDir) {
  const cacheDir = path.join(OUT, 'cache');
  ensureDir(cacheDir);
  const gzPath = path.join(cacheDir, 'vscodevim.vim.vsix.gz');
  const vsixPath = path.join(cacheDir, 'vscodevim.vim.vsix');
  const url = 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/vscodevim/vsextensions/vim/latest/vspackage';
  if (!fs.existsSync(vsixPath)) {
    let r = spawnSync('curl', ['-L', '--fail', '--max-time', '120', '-o', gzPath, url], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Failed to download VSCodeVim VSIX\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`);
    r = spawnSync('gunzip', ['-c', gzPath], { encoding: null });
    if (r.status !== 0) throw new Error(`Failed to decompress VSCodeVim VSIX\nSTDERR:\n${r.stderr?.toString() || ''}`);
    fs.writeFileSync(vsixPath, r.stdout);
  }
  const unpackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-vim-vsix-'));
  const r = spawnSync('unzip', ['-q', vsixPath, '-d', unpackDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Failed to unpack VSCodeVim VSIX\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(unpackDir, 'extension', 'package.json'), 'utf8'));
  const dest = path.join(extensionsDir, `${pkg.publisher}.${pkg.name}-${pkg.version}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(unpackDir, 'extension'), dest, { recursive: true });
  return { id: `${pkg.publisher}.${pkg.name}`, version: pkg.version, path: dest };
}

function runMatrixIfNeeded() {
  if (VARIANT) return false;
  fs.rmSync(SHOTS, { recursive: true, force: true });
  ensureDir(SHOTS);
  const variants = [
    { name: 'no-vim', port: PORT },
    { name: 'vim', port: PORT + 1 }
  ];
  const results = [];
  for (const v of variants) {
    const r = spawnSync(process.execPath, [__filename], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LGVS_DOGFOOD_VARIANT: v.name, LGVS_DOGFOOD_CDP_PORT: String(v.port) }
    });
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    const reportPath = path.join(OUT, `last-run-${v.name}.json`);
    let report;
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { report = { ok: false, variant: v.name, error: `missing report ${reportPath}` }; }
    results.push(report);
    if (r.status !== 0 || !report.ok) {
      write(REPORT_JSON, JSON.stringify({ ok: false, variants: results }, null, 2));
      process.exit(r.status || 1);
    }
  }
  write(REPORT_JSON, JSON.stringify({ ok: true, variants: results }, null, 2));
  console.log(JSON.stringify({ ok: true, variants: results.map(r => ({ variant: r.variant, vimExtension: r.vimExtension, checks: r.checks.length, evidence: r.evidence.length })) }, null, 2));
  return true;
}

async function cdpConnect() {
  const targets = await waitFor(async () => {
    const t = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    return t && t.length ? t : null;
  }, 45000, 500, 'CDP targets');
  const page = targets.find(t => /Visual Studio Code|Extension Development Host/i.test(t.title || '') && t.type === 'page') || targets.find(t => t.type === 'page') || targets[0];
  return CDP({ target: page, port: PORT });
}
async function key(Input, key, opts = {}) {
  const mods = (opts.ctrl ? 2 : 0) | (opts.shift ? 8 : 0) | (opts.alt ? 1 : 0) | (opts.meta ? 4 : 0);
  const codeMap = { Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', ArrowDown: 'ArrowDown', ArrowUp: 'ArrowUp', Home: 'Home', End: 'End', Space: 'Space', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4', '5': 'Digit5', '6': 'Digit6', '7': 'Digit7', '8': 'Digit8', '9': 'Digit9', '0': 'Digit0' };
  const vkeyMap = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Space: 32 };
  const code = codeMap[key] || (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key);
  const text = !opts.ctrl && !opts.alt && !opts.meta && key.length === 1 ? (opts.shift ? key.toUpperCase() : key) : undefined;
  const virtualKey = vkeyMap[key] ?? (/^[a-z]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : /^[0-9]$/.test(key) ? key.charCodeAt(0) : undefined);
  const event = { key, code, modifiers: mods, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey };
  await Input.dispatchKeyEvent({ type: text ? 'keyDown' : 'rawKeyDown', ...event, text });
  await Input.dispatchKeyEvent({ type: 'keyUp', ...event });
}
async function chord(Input, keys) {
  if (keys === 'ctrl+shift+p') return key(Input, 'P', { ctrl: true, shift: true });
  if (keys === 'ctrl+enter') return key(Input, 'Enter', { ctrl: true });
  if (keys === 'ctrl+1') return key(Input, '1', { ctrl: true });
  throw new Error(`unknown chord ${keys}`);
}
async function typeText(Input, text) {
  await Input.insertText({ text });
}
async function typePhysical(Input, text) {
  for (const ch of text) {
    await key(Input, ch);
    await sleep(60);
  }
}
async function screenshot(Page, name) {
  await sleep(300);
  const res = await Page.captureScreenshot({ format: 'png', captureBeyondViewport: false });
  const dir = VARIANT ? path.join(SHOTS, VARIANT_NAME) : SHOTS;
  ensureDir(dir);
  const file = path.join(dir, `${String(name).replace(/[^a-z0-9_-]+/gi, '-')}.png`);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  return file;
}
async function runCommandPalette(Input, commandText) {
  await chord(Input, 'ctrl+shift+p');
  await sleep(450);
  await typeText(Input, commandText);
  await sleep(600);
  await key(Input, 'Enter');
  await sleep(STEP_DELAY);
}
async function pageText(Runtime) {
  const r = await Runtime.evaluate({ expression: `document.body.innerText`, returnByValue: true });
  return r.result.value || '';
}

(async () => {
  if (runMatrixIfNeeded()) return;
  const variantShots = path.join(SHOTS, VARIANT_NAME);
  fs.rmSync(variantShots, { recursive: true, force: true });
  ensureDir(variantShots);
  const started = new Date().toISOString();
  const fixture = makeFixture();
  const secondaryRepo = secondaryFixtureRepo(fixture);
  const codePath = await downloadAndUnzipVSCode('stable');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-code-user-'));
  write(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'workbench.colorTheme': THEME,
    'workbench.startupEditor': 'none',
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'telemetry.telemetryLevel': 'off'
  }, null, 2));
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-code-ext-'));
  const useVim = VARIANT === 'vim';
  const vimExtension = useVim ? installVSCodeVimExtension(extensionsDir) : undefined;
  const launchArgs = [
    codePath,
    fixture,
    secondaryRepo,
    `--extensionDevelopmentPath=${ROOT}`,
    `--user-data-dir=${userData}`,
    `--extensions-dir=${extensionsDir}`,
    `--remote-debugging-port=${PORT}`,
    ...(process.env.LGVS_DOGFOOD_WINDOW_SIZE ? [`--window-size=${process.env.LGVS_DOGFOOD_WINDOW_SIZE}`] : []),
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-updates',
    '--disable-gpu',
    '--force-color-profile=srgb',
    '--no-sandbox',
    '--new-window',
    '--log=error'
  ];
  const cmd = process.env.DISPLAY ? codePath : 'xvfb-run';
  const args = process.env.DISPLAY ? launchArgs.slice(1) : ['-a', ...launchArgs];
  const proc = spawn(cmd, args, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let procOut = '';
  proc.stdout.on('data', d => procOut += d.toString());
  proc.stderr.on('data', d => procOut += d.toString());

  const evidence = [];
  const checks = [];
  let client;
  try {
    client = await cdpConnect();
    const { Page, Input, Runtime, Browser, Emulation } = client;
    await Promise.all([Page.enable(), Runtime.enable()]);
    if (process.env.LGVS_DOGFOOD_WINDOW_SIZE && Browser?.getWindowForTarget) {
      try {
        const [width, height] = process.env.LGVS_DOGFOOD_WINDOW_SIZE.split(',').map(Number);
        const { windowId } = await Browser.getWindowForTarget();
        await Browser.setWindowBounds({ windowId, bounds: { width, height } });
      } catch { /* Electron CDP may not expose Browser window bounds. */ }
    }
    if (process.env.LGVS_DOGFOOD_WINDOW_SIZE && Emulation?.setDeviceMetricsOverride) {
      const [width, height] = process.env.LGVS_DOGFOOD_WINDOW_SIZE.split(',').map(Number);
      await Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor: 1, mobile: false });
    }
    await sleep(4500);
    evidence.push({ step: 'initial-workbench', screenshot: await screenshot(Page, '01-initial-workbench'), status: status(fixture) });

    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
    const sidebarText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'open-lgvs-scm-sidebar', screenshot: await screenshot(Page, '02-open-lgvs-scm-sidebar'), status: status(fixture), textSample: sidebarText });
    checks.push({ name: 'Light theme dogfood profile is active', ok: THEME.toLowerCase().includes('light'), theme: THEME });
    checks.push({ name: `${useVim ? 'VSCodeVim' : 'No Vim'} dogfood variant is active`, ok: true, variant: VARIANT, vimExtension: useVim, vimVersion: vimExtension?.version });
    checks.push({ name: 'SCM sidebar exposes default LazyGitVS panels while Status stays hidden until 1', ok: !sidebarText.includes('1 STATUS') && ['2 FILES', '3 BRANCHES', '4 COMMITS', '5 STASH', '6 CONFLICTS', '7 TAGS', '8 REMOTES'].every(label => sidebarText.includes(label)), textSample: sidebarText.slice(0, 1200) });
    checks.push({ name: 'No noisy focus footer in LGVS panels', ok: !/Focus:\s+LG panel/i.test(sidebarText), textSample: sidebarText.slice(-800) });
    checks.push({ name: 'Right chat / secondary side bar stays closed in screenshots', ok: !/CHAT\s+Build with Agent/i.test(sidebarText), textSample: sidebarText.slice(-800) });

    if (useVim && process.env.LGVS_DOGFOOD_FAST_VIM_ESCAPE) {
      await key(Input, '2');
      await sleep(STEP_DELAY);
      await key(Input, 'Enter');
      await sleep(1800);
      const targetedHunkText = await waitFor(async () => {
        const text = await pageText(Runtime);
        return /-- (HUNK|LINE)/.test(text) ? text : null;
      }, 6000, 300, 'targeted Vim HUNK entry');
      evidence.push({ step: 'targeted-vim-enter-hunk', screenshot: await screenshot(Page, 'targeted-vim-enter-hunk'), status: status(fixture), textSample: targetedHunkText.slice(0, 3000) });

      await key(Input, 'e');
      await sleep(1200);
      const vimEditProbe = 'vimprobe';
      await key(Input, 'i');
      await sleep(500);
      await typePhysical(Input, vimEditProbe);
      await sleep(500);
      const targetedInsertText = (await pageText(Runtime)).slice(0, 3000);
      await key(Input, 'Escape');
      await sleep(STEP_DELAY);
      const targetedEscapeText = (await pageText(Runtime)).slice(0, 3000);
      await key(Input, 'x');
      await sleep(500);
      const targetedNormalText = (await pageText(Runtime)).slice(0, 3000);
      const readmeAfterTargetedVimProbe = fs.readFileSync(path.join(fixture, 'README.md'), 'utf8');
      evidence.push({ step: 'targeted-vim-escape-real-editor', screenshot: await screenshot(Page, 'targeted-vim-escape-real-editor'), status: status(fixture), textSample: targetedNormalText, readme: readmeAfterTargetedVimProbe });
      checks.push({ name: 'Targeted VSCodeVim physical Esc leaves Insert after LGVS e handoff', ok: /-- INSERT --/.test(targetedInsertText) && /-- NORMAL --/.test(targetedEscapeText) && /vimprob/.test(targetedNormalText) && !/vimprobex/.test(targetedNormalText) && !/-- (EDIT|HUNK).*LG --/.test(targetedNormalText), textSample: targetedNormalText.slice(-1200), readme: readmeAfterTargetedVimProbe });
      for (const c of checks) assert(c.ok, `Dogfood check failed: ${c.name}`);
      const report = { ok: true, variant: VARIANT, vimExtension: useVim, vimExtensionInfo: vimExtension, started, finished: new Date().toISOString(), theme: THEME, fixture, checks, evidence, processOutput: procOut.slice(-4000), targeted: 'vim-escape' };
      write(REPORT_JSON, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Smoke the lazygit panel jumps before entering the editor flow.
    for (const panelKey of ['1', '2', '3', '4', '5', '6', '7', '8']) {
      await key(Input, panelKey);
      await sleep(650);
      const jumpText = await pageText(Runtime);
      evidence.push({ step: `panel-jump-${panelKey}`, screenshot: await screenshot(Page, `02-panel-jump-${panelKey}`), status: status(fixture), textSample: jumpText.slice(0, 1200) });
      if (panelKey === '1') checks.push({ name: 'Pressing 1 reveals Status with current repository selected', ok: jumpText.includes('1 STATUS') && jumpText.includes('other-repo') && /current/i.test(jumpText), textSample: jumpText.slice(0, 1200) });
      if (panelKey === '2') checks.push({ name: 'Moving from 1 Status to 2 Files hides Status again', ok: !jumpText.includes('1 STATUS') && /-- FILES · LG --/.test(jumpText), textSample: jumpText.slice(0, 1200) });
      if (panelKey === '7') checks.push({ name: 'Pressing 7 reveals Tags in the SCM sidebar', ok: jumpText.includes('7 TAGS'), textSample: jumpText.slice(0, 1200) });
      if (panelKey === '8') checks.push({ name: 'Pressing 8 reveals Remotes in the SCM sidebar', ok: jumpText.includes('8 REMOTES'), textSample: jumpText.slice(0, 1200) });
    }

    for (const [panelKey, panelName] of [['3', 'BRANCHES'], ['4', 'COMMITS'], ['5', 'STASH']]) {
      await key(Input, panelKey);
      await sleep(STEP_DELAY);
      await key(Input, 'Escape');
      await sleep(STEP_DELAY);
      const escText = await pageText(Runtime);
      evidence.push({ step: `panel-${panelKey}-escape-stays`, screenshot: await screenshot(Page, `02-panel-${panelKey}-escape-stays`), status: status(fixture), textSample: escText.slice(0, 1200) });
      checks.push({ name: `Escape on ${panelKey} ${panelName} keeps the current panel`, ok: new RegExp(`-- ${panelName} · LG --`).test(escText), textSample: escText.slice(0, 1200) });
    }

    await key(Input, '4');
    await sleep(STEP_DELAY);
    for (let i = 0; i < 4; i++) {
      await key(Input, 'ArrowDown');
      await sleep(250);
    }
    await runCommandPalette(Input, 'View: Focus Active Editor Group');
    await sleep(700);
    await key(Input, '2');
    await sleep(STEP_DELAY);
    const commitPreviewNumberJumpText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'commits-preview-editor-number-jump-files', screenshot: await screenshot(Page, '02-commits-preview-editor-number-jump-files'), status: status(fixture), textSample: commitPreviewNumberJumpText });
    checks.push({ name: 'Panel numbers still work after moving in 4 Commits with the preview editor focused', ok: /2 FILES/i.test(commitPreviewNumberJumpText) && /README\.md|settings\.json|src\/app\.ts/.test(commitPreviewNumberJumpText), textSample: commitPreviewNumberJumpText.slice(0, 1200) });


    await key(Input, '1');
    await sleep(STEP_DELAY);
    await key(Input, 'Enter');
    await sleep(STEP_DELAY);
    await key(Input, 'ArrowDown');
    await sleep(STEP_DELAY);
    await key(Input, 'Enter');
    await sleep(1800);
    const secondaryStatusText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'status-enter-select-other-repo', screenshot: await screenshot(Page, '02-status-enter-select-other-repo'), status: status(secondaryRepo), textSample: secondaryStatusText });
    checks.push({ name: 'Status Enter switches from the current repository row to other-repo', ok: /other-repo[\s\S]*current/i.test(secondaryStatusText), textSample: secondaryStatusText.slice(0, 1200) });
    await key(Input, '2');
    await sleep(STEP_DELAY);
    const secondaryFilesText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'files-after-other-repo-select', screenshot: await screenshot(Page, '02-files-after-other-repo-select'), status: status(secondaryRepo), textSample: secondaryFilesText });
    checks.push({ name: 'Files panel shows the selected repository changes after Status Enter', ok: secondaryFilesText.includes('OTHER_REPO_SENTINEL.md'), textSample: secondaryFilesText.slice(0, 1200) });
    await key(Input, '1');
    await sleep(STEP_DELAY);
    await key(Input, 'Enter');
    await sleep(STEP_DELAY);
    await key(Input, 'ArrowUp');
    await sleep(STEP_DELAY);
    await key(Input, 'Enter');
    await sleep(1800);

    // Panel jump previews can legitimately leave editor focus; reset to the LGVS SCM sidebar before list navigation.
    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');

    // Regression: nearby staged edits in the same file must remain navigable as separate hunks.
    await key(Input, '2');
    await sleep(700);
    await key(Input, 'ArrowDown');
    await sleep(STEP_DELAY);
    await key(Input, 'Enter');
    await sleep(1500);
    await key(Input, 'Tab');
    await sleep(STEP_DELAY);
    const stagedHunkOneText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'settings-staged-hunk-1', screenshot: await screenshot(Page, '03-settings-staged-hunk-1'), status: status(fixture), textSample: stagedHunkOneText });
    await key(Input, 'j');
    await sleep(STEP_DELAY);
    const stagedHunkTwoText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'settings-staged-hunk-2', screenshot: await screenshot(Page, '03-settings-staged-hunk-2'), status: status(fixture), textSample: stagedHunkTwoText });
    const settingsCachedDiff = git(fixture, 'diff', '--cached', '--unified=0', '--', 'settings.json');
    const settingsCachedHunks = (settingsCachedDiff.match(/^@@ /gm) || []).length;
    checks.push({
      name: 'Nearby staged settings edits stay separate zero-context hunks',
      ok: settingsCachedHunks >= 2,
      hunks: settingsCachedHunks,
      diff: settingsCachedDiff.slice(0, 1200),
      first: stagedHunkOneText.slice(-400),
      second: stagedHunkTwoText.slice(-400)
    });
    await key(Input, 'Escape');
    await sleep(STEP_DELAY);
    await key(Input, 'ArrowUp');
    await sleep(STEP_DELAY);

    // Return to Files, then verify that focusing the main/hunk viewer removes the active file selection.
    await key(Input, '2');
    await sleep(STEP_DELAY);
    await key(Input, '0');
    await sleep(STEP_DELAY);
    const viewerText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'files-focus-main-viewer', screenshot: await screenshot(Page, '03-files-focus-main-viewer'), status: status(fixture), textSample: viewerText });
    checks.push({ name: 'Main/hunk viewer focus keeps Files context without noisy footer', ok: !/Focus:\s+LG panel/i.test(viewerText), textSample: viewerText.slice(-800) });
    await key(Input, '2');
    await sleep(STEP_DELAY);

    // Modal focus regression: Files d-discard opens a QuickPick. Cancelling it must return
    // keyboard focus to the same LGVS Files panel, so the next ArrowDown moves the file selection
    // instead of leaking into the preview/editor.
    await key(Input, 'd');
    await sleep(STEP_DELAY);
    await key(Input, 'Escape');
    await sleep(STEP_DELAY);
    await key(Input, 'ArrowDown');
    await sleep(STEP_DELAY);
    const afterDiscardModalText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'files-discard-modal-focus-restore', screenshot: await screenshot(Page, '03-files-discard-modal-focus-restore'), status: status(fixture), textSample: afterDiscardModalText });
    checks.push({ name: 'Files d-discard modal restores keyboard focus to the Files panel', ok: /LazyGitVS: (settings\.json|README\.md)/.test(afterDiscardModalText) && !afterDiscardModalText.includes('Dogfood Modal Sentinel'), textSample: afterDiscardModalText.slice(-1000) });
    await typeText(Input, 'Dogfood Modal Sentinel');
    await sleep(300);
    checks.push({ name: 'Post-modal text input does not leak into the active editor', ok: !fs.readFileSync(path.join(fixture, 'README.md'), 'utf8').includes('Dogfood Modal Sentinel'), readme: fs.readFileSync(path.join(fixture, 'README.md'), 'utf8') });

    // Re-anchor keyboard focus in the LGVS Files tree before entering real editor HUNK mode.
    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
    await key(Input, '2');
    await sleep(STEP_DELAY);

    // Return to Files and enter real editor HUNK mode.
    await key(Input, 'Enter');
    await sleep(1800);
    const hunkText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'files-enter-editor-hunk', screenshot: await screenshot(Page, '03-files-enter-editor-hunk'), status: status(fixture), textSample: hunkText });
    checks.push({ name: 'Generated previews use named virtual documents, not Untitled buffers', ok: !/Untitled-\d+/.test(hunkText), textSample: hunkText.slice(0, 1000) });
    checks.push({ name: 'Right chat stays closed after entering editor/HUNK mode', ok: !/CHAT\s+Build with Agent/i.test(hunkText), textSample: hunkText.slice(-800) });

    await key(Input, 'a');
    await sleep(STEP_DELAY);
    evidence.push({ step: 'toggle-line-mode', screenshot: await screenshot(Page, '04-line-mode'), status: status(fixture) });

    const beforeStage = status(fixture);
    await key(Input, 'Space');
    await sleep(2200);
    const afterStage = status(fixture);
    evidence.push({ step: 'line-space-stage', screenshot: await screenshot(Page, '05-line-stage'), status: afterStage, cachedNames: diffCachedNames(fixture), unstagedNames: diffNames(fixture) });
    checks.push({ name: 'Space in LINE mode stages the selected line change', ok: afterStage !== beforeStage && diffCachedNames(fixture).trim().length > 0, before: beforeStage, after: afterStage, cachedNames: diffCachedNames(fixture) });

    await key(Input, 'Tab');
    await sleep(STEP_DELAY);
    evidence.push({ step: 'tab-staged-side', screenshot: await screenshot(Page, '06-tab-staged-side'), status: status(fixture) });
    const beforeUnstage = status(fixture);
    await key(Input, 'Space');
    await sleep(2200);
    const afterUnstage = status(fixture);
    evidence.push({ step: 'line-space-unstage', screenshot: await screenshot(Page, '07-line-unstage'), status: afterUnstage, cachedNames: diffCachedNames(fixture), unstagedNames: diffNames(fixture) });
    checks.push({ name: 'Space on staged LINE side unstages the selected README change', ok: !diffCachedNames(fixture).split('\n').includes('README.md'), before: beforeUnstage, after: afterUnstage });

    await key(Input, 'e');
    await sleep(STEP_DELAY);
    evidence.push({ step: 'enter-edit-mode', screenshot: await screenshot(Page, '08-edit-mode'), status: status(fixture) });
    if (useVim) {
      // Real regression: use physical key events, not CDP insertText. insertText bypasses
      // VSCodeVim's mode state and gives a fake green test. After LGVS hands off with e,
      // i must enter Vim Insert, Escape must return Normal, and x must be a Normal-mode
      // delete command rather than a literal typed x.
      const vimEditProbe = 'vimprobe';
      await key(Input, 'i');
      await sleep(500);
      await typePhysical(Input, vimEditProbe);
      await sleep(500);
      const afterPhysicalVimInsertText = (await pageText(Runtime)).slice(0, 3000);
      await key(Input, 'Escape');
      await sleep(STEP_DELAY);
      const afterPhysicalVimEscapeText = (await pageText(Runtime)).slice(0, 3000);
      await key(Input, 'x');
      await sleep(500);
      const afterPhysicalVimNormalXText = (await pageText(Runtime)).slice(0, 3000);
      const readmeAfterPhysicalVimProbe = fs.readFileSync(path.join(fixture, 'README.md'), 'utf8');
      evidence.push({ step: 'vim-physical-escape-in-real-editor', screenshot: await screenshot(Page, '08-vim-physical-escape-in-real-editor'), status: status(fixture), textSample: afterPhysicalVimNormalXText, readme: readmeAfterPhysicalVimProbe });
      checks.push({ name: 'VSCodeVim physical Esc leaves Insert after LGVS opens the real editor', ok: /-- INSERT --/.test(afterPhysicalVimInsertText) && /-- NORMAL --/.test(afterPhysicalVimEscapeText) && readmeAfterPhysicalVimProbe.includes(vimEditProbe) && !readmeAfterPhysicalVimProbe.includes(`${vimEditProbe}x`) && !/-- (EDIT|HUNK).*LG --/.test(afterPhysicalVimNormalXText), textSample: afterPhysicalVimNormalXText.slice(-1200), readme: readmeAfterPhysicalVimProbe });
    }
    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
    await sleep(STEP_DELAY);
    evidence.push({ step: 'edit-mode-explicit-sidebar-return', screenshot: await screenshot(Page, '09-explicit-sidebar-return'), status: status(fixture) });
    await key(Input, '2');
    await sleep(STEP_DELAY);
    evidence.push({ step: 'files-after-edit-mode', screenshot: await screenshot(Page, '10-files-after-edit-mode'), status: status(fixture) });

    await runCommandPalette(Input, 'LazyGitVS: Close Sidebar');
    evidence.push({ step: 'close-sidebar', screenshot: await screenshot(Page, '11-close-sidebar'), status: status(fixture) });

    for (const c of checks) assert(c.ok, `Dogfood check failed: ${c.name}`);
    const report = { ok: true, variant: VARIANT, vimExtension: useVim, vimExtensionInfo: vimExtension, started, finished: new Date().toISOString(), theme: THEME, fixture, codePath, checks, evidence, processOutput: procOut.slice(-4000) };
    write(REPORT_JSON, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const report = { ok: false, variant: VARIANT, vimExtension: useVim, vimExtensionInfo: vimExtension, started, finished: new Date().toISOString(), theme: THEME, fixture, checks, evidence, error: String(error && error.stack || error), processOutput: procOut.slice(-8000) };
    write(REPORT_JSON, JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (client) { try { await client.close(); } catch {} }
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
    try { spawnSync('pkill', ['-f', `remote-debugging-port=${PORT}`]); } catch {}
  }
})();
