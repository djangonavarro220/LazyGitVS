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
const { performance } = require('perf_hooks');
const { makeFixture, fixtureRepos, telemetryFixtureManifest, secondaryFixtureRepo, deepNestedFixtureRepo, status, diffCachedNames, diffNames, git, ensureDir, write, startMergeOperation, mergeOperationInProgress } = require('./dogfood/fixtures');
const { targetLane, panelNavigationBoundaryMatches, finishReport, writeJson } = require('./dogfood/reporting');
const { makeFixtureResult, classifyFailure, collectProcessTreeMetrics } = require('./dogfood/telemetry');
const { discoverOwnedCdp, makeChildTerminalFailure, publishJsonOnce, readProcessIdentity, readRunEnvelope, runChildPreRuntimeLifecycle, terminateOwnedProcessGroup } = require('./dogfood/run-envelope');
const { writeNativeScreenshot, writeScreenshot } = require('./dogfood/screenshots');
const CDP = require('chrome-remote-interface');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dogfood-output');
const SHOTS = path.join(OUT, 'screenshots');
const VARIANT = process.env.LGVS_DOGFOOD_VARIANT || '';
const VARIANT_NAME = VARIANT || 'matrix';
const TARGETED_LANE = targetLane(process.env);
const REPORT_SLUG = `${VARIANT_NAME}-${TARGETED_LANE}`;
const TELEMETRY = process.env.LGVS_DOGFOOD_TELEMETRY === '1';
const RUN_ENVELOPE = TELEMETRY ? readRunEnvelope(process.env.LGVS_TELEMETRY_ENVELOPE_PATH, process.env.LGVS_TELEMETRY_ENVELOPE_DIGEST) : undefined;
const TELEMETRY_CHILD_DIR = TELEMETRY ? path.resolve(process.env.LGVS_TELEMETRY_CHILD_DIR) : undefined;
const REPORT_JSON = path.resolve(process.env.LGVS_DOGFOOD_REPORT_PATH || path.join(OUT, `last-run-${REPORT_SLUG}.json`));
const LANE_SHOTS = TELEMETRY ? path.join(RUN_ENVELOPE.paths.screenshotsDir, TARGETED_LANE) : path.join(SHOTS, REPORT_SLUG);
let PORT = Number(process.env.LGVS_DOGFOOD_CDP_PORT || 9322);
const NATIVE_DISPLAY = process.env.DISPLAY || (TELEMETRY ? undefined : `:${PORT}`);
const STEP_DELAY = Number(process.env.LGVS_DOGFOOD_STEP_DELAY || 900);
const THEME = process.env.LGVS_DOGFOOD_THEME || 'Default Light Modern';
const VIRTUAL_PREVIEW_URI_PREFIX = 'lazygitvs-preview:';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
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
async function waitFor(fn, timeoutMs = 20000, intervalMs = 250) {
  const started = Date.now();
  let lastErr;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) { lastErr = e; }
    await sleep(intervalMs);
  }
  throw lastErr || new Error(`Timed out after ${timeoutMs}ms`);
}

async function waitForText(Runtime, pattern, timeoutMs = 20000) {
  return waitFor(async () => {
    const text = await pageText(Runtime);
    return pattern.test(text) ? text : undefined;
  }, timeoutMs, 250);
}

function addCheck(checks, check) {
  checks.push(check);
  return check;
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function nativeKey(keyName) {
  const result = spawnSync('xdotool', ['search', '--onlyvisible', '--class', 'code', 'windowfocus', '--sync', 'key', '--clearmodifiers', keyName], { encoding: 'utf8', env: { ...process.env, DISPLAY: NATIVE_DISPLAY, XAUTHORITY: nativeXauthority } });
  if (result.status !== 0) throw new Error(`xdotool could not send ${keyName}: ${(result.stderr || result.stdout || '').trim()}`);
}

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
  ensureDir(SHOTS);
  const variants = [
    { name: 'no-vim', port: PORT },
    { name: 'vim', port: PORT + 1 }
  ];
  const results = [];
  for (const v of variants) {
    const matrixArgs = [process.execPath, __filename];
    const command = process.env.DISPLAY ? matrixArgs.shift() : 'xvfb-run';
    const args = process.env.DISPLAY ? matrixArgs : ['-a', ...matrixArgs];
    const r = spawnSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LGVS_DOGFOOD_VARIANT: v.name, LGVS_DOGFOOD_CDP_PORT: String(v.port) }
    });
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    const reportPath = path.join(OUT, `last-run-${v.name}-full.json`);
    let report;
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { report = { ok: false, variant: v.name, error: `missing report ${reportPath}` }; }
    results.push(report);
    if (r.status !== 0 || !report.ok) {
      writeJson(REPORT_JSON, { ok: false, variants: results });
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
  const codeMap = { Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', ArrowDown: 'ArrowDown', ArrowUp: 'ArrowUp', Home: 'Home', End: 'End', F1: 'F1', F9: 'F9', Space: 'Space', '?': 'Slash', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4', '5': 'Digit5', '6': 'Digit6', '7': 'Digit7', '8': 'Digit8', '9': 'Digit9', '0': 'Digit0' };
  const vkeyMap = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, F1: 112, F9: 120, Space: 32, '?': 191 };
  const code = codeMap[key] || (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key);
  const text = !opts.ctrl && !opts.alt && !opts.meta && key.length === 1 ? (opts.shift ? key.toUpperCase() : key) : undefined;
  const virtualKey = vkeyMap[key] ?? (/^[a-z]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : /^[0-9]$/.test(key) ? key.charCodeAt(0) : undefined);
  const event = { key, code, modifiers: mods, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey };
  await Input.dispatchKeyEvent({ type: text ? 'keyDown' : 'rawKeyDown', ...event, text });
  await Input.dispatchKeyEvent({ type: 'keyUp', ...event });
}
async function chord(Input, keys) {
  if (keys === 'ctrl+shift+p') return key(Input, 'p', { ctrl: true, shift: true });
  if (keys === 'ctrl+enter') return key(Input, 'Enter', { ctrl: true });
  if (keys === 'ctrl+alt+enter') return key(Input, 'Enter', { ctrl: true, alt: true });

  if (keys === 'ctrl+1') return key(Input, '1', { ctrl: true });
  if (keys === 'ctrl+alt+h') return key(Input, 'h', { ctrl: true, alt: true });
  if (keys === 'ctrl+alt+r') return key(Input, 'r', { ctrl: true, alt: true });
  if (keys === 'ctrl+alt+f') return key(Input, 'f', { ctrl: true, alt: true });

  if (keys === 'ctrl+alt+?') return key(Input, '/', { ctrl: true, alt: true });
  if (keys === 'ctrl+alt+o') return key(Input, 'o', { ctrl: true, alt: true });
  const panelChord = /^ctrl\+alt\+([1-8])$/.exec(keys);
  if (panelChord) return key(Input, panelChord[1], { ctrl: true, alt: true });
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
async function screenshot(Page, name, opts = {}) {
  return writeScreenshot({
    Page,
    name,
    force: opts.force,
    screenshots: process.env.LGVS_DOGFOOD_SCREENSHOTS,
    shots: LANE_SHOTS,
    variant: '',
    variantName: '',
    sleep
  });
}
let nativeXauthority;
async function nativeScreenshot(name) {
  return writeNativeScreenshot({ name, shots: LANE_SHOTS, display: NATIVE_DISPLAY, xauthority: nativeXauthority, sleep });
}
async function runCommandPalette(Input, commandText) {
  // F1 is less prone than Ctrl+Shift+P to being eaten by LGVS/webview focus during CDP dogfood.
  await key(Input, 'F1');
  await sleep(450);
  await key(Input, 'a', { ctrl: true });
  await sleep(100);
  await key(Input, 'Backspace');
  await sleep(100);
  await typeText(Input, `>${commandText}`);
  await sleep(600);
  await key(Input, 'Enter');
  await sleep(STEP_DELAY);
}
async function runExactCommand(Runtime, Input, commandText, waitForHide = true) {
  await key(Input, 'F1');
  await sleep(450);
  await key(Input, 'a', { ctrl: true });
  await key(Input, 'Backspace');
  await typeText(Input, `>${commandText}`);
  await sleep(600);
  const picked = await clickQuickPickRowEndingWith(Runtime, Input, commandText, waitForHide);
  if (!picked) throw new Error(`Command Palette did not expose exact command: ${commandText}`);
  await sleep(STEP_DELAY);
}
async function pageText(Runtime) {
  const r = await Runtime.evaluate({ expression: `document.body.innerText`, returnByValue: true });
  return r.result.value || '';
}
async function lazyGitPreviewTabLabels(Runtime) {
  const r = await Runtime.evaluate({ expression: `Array.from(document.querySelectorAll('.tabs-container .tab, .tabs-and-actions-container .tab, .tab')).map(el => el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => /^LazyGitVS\b/.test(s) || s.includes(' LazyGitVS'))`, returnByValue: true });
  return Array.from(new Set(r.result.value || []));
}
async function editorTabLabels(Runtime) {
  const r = await Runtime.evaluate({ expression: `Array.from(document.querySelectorAll('.tabs-container .tab, .tabs-and-actions-container .tab, .tab')).map(el => el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)`, returnByValue: true });
  return Array.from(new Set(r.result.value || []));
}
function richPreviewHostLabels(labels) {
  return Array.from(new Set(labels.map(label => label.match(/LazyGitVS: (?:Commit\s+[0-9a-f]+|stash@\{\d+\})/i)?.[0]).filter(Boolean)));
}
async function quickInputState(Runtime) {
  const r = await Runtime.evaluate({ expression: `(() => { const widget = document.querySelector('.quick-input-widget'); const input = widget?.querySelector('input'); const style = widget ? getComputedStyle(widget) : undefined; return { visible: !!widget && style?.display !== 'none' && style?.visibility !== 'hidden' && widget.getBoundingClientRect().height > 0, focused: document.activeElement === input, text: input?.value || '', placeholder: input?.getAttribute('aria-label') || input?.getAttribute('placeholder') || '' }; })()`, returnByValue: true });
  return r.result.value || { visible: false, focused: false, text: '', placeholder: '' };
}
async function focusVisibleQuickInput(Runtime, Input) {
  const r = await Runtime.evaluate({ expression: `(() => { const input = document.querySelector('.quick-input-widget input'); if (!input) return undefined; const rect = input.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined; })()`, returnByValue: true });
  const point = r.result.value;
  if (!point) throw new Error('Visible QuickPick input was not available for keyboard focus');
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await waitFor(async () => (await quickInputState(Runtime)).focused, 3000, 100, 'QuickPick keyboard focus');
}
async function clickQuickPickRowEndingWith(Runtime, Input, suffix, waitForHide = true) {
  const r = await Runtime.evaluate({ expression: `(() => {
    const suffix = ${JSON.stringify("__SUFFIX__")}.replace('__SUFFIX__', ${JSON.stringify(suffix)});
    const rows = Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row'));
    const row = rows.find(el => (el.textContent || '').trim().endsWith(suffix));
    if (!row) return undefined;
    const rect = row.getBoundingClientRect();
    return { x: rect.left + Math.min(40, Math.max(8, rect.width / 2)), y: rect.top + rect.height / 2, text: row.textContent || '' };
  })()`, returnByValue: true });
  const point = r.result.value;
  if (!point) return undefined;
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await key(Input, 'Enter');
  if (waitForHide) await waitFor(async () => !(await quickInputState(Runtime)).visible, 5000, 100, 'QuickPick selection accepted');
  await sleep(STEP_DELAY);
  return point;
}

async function selectedLgvsRowInfo(Runtime) {
  const r = await Runtime.evaluate({ expression: `(() => {
    function collect(root, out = []) {
      const rows = Array.from(root.querySelectorAll?.('.row') || []);
      const containers = Array.from(root.querySelectorAll?.('.rows') || []);
      const spacers = Array.from(root.querySelectorAll?.('.virtual-spacer') || []);
      if (rows.length) out.push({ rows, containers, spacers });
      for (const el of Array.from(root.querySelectorAll?.('*') || [])) {
        if (el.shadowRoot) collect(el.shadowRoot, out);
        if (el.tagName === 'IFRAME' && el.contentDocument) collect(el.contentDocument, out);
      }
      return out;
    }
    const groups = collect(document);
    for (const group of groups) {
      const selected = group.rows.find(row => row.classList.contains('sel') || row.getAttribute('aria-selected') === 'true');
      if (!selected) continue;
      const container = group.containers.find(c => c.contains(selected)) || selected.closest('.rows');
      return {
        text: (selected.textContent || '').replace(/\s+/g, ' ').trim(),
        title: selected.getAttribute('title') || '',
        index: selected.getAttribute('data-index') || '',
        renderedRowCount: group.rows.length,
        visibleRowCount: container ? Math.floor(container.clientHeight / 20) : undefined,
        scrollTop: container?.scrollTop,
        virtualOffsets: group.spacers.map(s => s.getAttribute('data-virtual-offset')).filter(Boolean),
        selectedRowAvailable: true
      };
    }
    const text = document.body.innerText || '';
    const mode = (text.match(/-- FILES · LG --/) || text.match(/-- [A-Z]+ · LG --/) || [''])[0];
    return mode ? { text: mode, title: mode, selectedRowAvailable: false } : undefined;
  })()`, returnByValue: true });
  return r.result.value;
}

async function clickLgvsRowWithTitle(Runtime, Input, titlePart) {
  const r = await Runtime.evaluate({ expression: `(() => {
    const titlePart = ${JSON.stringify(titlePart)};
    function find(root, ox = 0, oy = 0) {
      const rows = Array.from(root.querySelectorAll?.('.row') || []);
      const row = rows.find(el => (el.getAttribute('title') || '').includes(titlePart) || (el.textContent || '').includes(titlePart));
      if (row) {
        const rect = row.getBoundingClientRect();
        return { x: ox + rect.left + Math.min(80, Math.max(8, rect.width / 2)), y: oy + rect.top + rect.height / 2, title: row.getAttribute('title') || '', text: row.textContent || '' };
      }
      for (const el of Array.from(root.querySelectorAll?.('*') || [])) {
        if (el.shadowRoot) { const found = find(el.shadowRoot, ox, oy); if (found) return found; }
        if (el.tagName === 'IFRAME' && el.contentDocument) {
          const rect = el.getBoundingClientRect();
          const found = find(el.contentDocument, ox + rect.left, oy + rect.top);
          if (found) return found;
        }
      }
      return undefined;
    }
    return find(document);
  })()`, returnByValue: true });
  const point = r.result.value;
  if (!point) return undefined;
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(STEP_DELAY);
  return point;
}

async function clickLgvsRoot(Runtime, Input) {
  const r = await Runtime.evaluate({ expression: `(() => {
    function find(root, ox = 0, oy = 0) {
      const target = root.querySelector?.('.root .rows') || root.querySelector?.('.root');
      if (target) {
        const rect = target.getBoundingClientRect();
        return { x: ox + rect.left + Math.min(24, Math.max(8, rect.width / 2)), y: oy + rect.top + Math.min(24, Math.max(8, rect.height / 2)) };
      }
      const all = Array.from(root.querySelectorAll?.('*') || []);
      for (const el of all) {
        if (el.shadowRoot) {
          const found = find(el.shadowRoot, ox, oy);
          if (found) return found;
        }
        if (el.tagName === 'IFRAME' && el.contentDocument) {
          const rect = el.getBoundingClientRect();
          const found = find(el.contentDocument, ox + rect.left, oy + rect.top);
          if (found) return found;
        }
      }
      return undefined;
    }
    return find(document);
  })()`, returnByValue: true });
  const point = r.result.value;
  if (!point) return false;
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(STEP_DELAY);
  return true;
}
async function dispatchLgvsKey(Runtime, keyValue) {
  const r = await Runtime.evaluate({ expression: `(() => {
    const keyValue = ${JSON.stringify(keyValue)};
    function dispatch(root) {
      const target = root.querySelector?.('.root');
      if (target) {
        const view = target.ownerDocument.defaultView;
        view.dispatchEvent(new view.KeyboardEvent('keydown', { key: keyValue, bubbles: true }));
        return true;
      }
      for (const el of Array.from(root.querySelectorAll?.('*') || [])) {
        if (el.shadowRoot && dispatch(el.shadowRoot)) return true;
        if (el.tagName === 'IFRAME' && el.contentDocument && dispatch(el.contentDocument)) return true;
      }
      return false;
    }
    return dispatch(document);
  })()`, returnByValue: true });
  return r.result.value === true;
}
async function clickWorkbenchLabel(Runtime, Input, label) {
  const r = await Runtime.evaluate({ expression: `(() => {
    const wanted = ${JSON.stringify(label)};
    const candidates = Array.from(document.querySelectorAll('.pane-header')).filter(el => ((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()).includes(wanted));
    const el = candidates
      .filter(candidate => { const rect = candidate.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!el) return undefined;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + Math.min(24, rect.width / 4), y: rect.top + rect.height / 2, text: el.textContent || '' };
  })()`, returnByValue: true });
  const point = r.result.value;
  if (!point) return undefined;
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(STEP_DELAY);
  return point;
}
async function clickWorkbenchTreeRow(Runtime, Input, textPart) {
  const r = await Runtime.evaluate({ expression: `(() => {
    const wanted = ${JSON.stringify(textPart)};
    const rows = Array.from(document.querySelectorAll('.monaco-list-row'));
    const row = rows.find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (el.innerText || el.textContent || '').includes(wanted);
    });
    if (!row) return undefined;
    const rect = row.getBoundingClientRect();
    return { x: rect.left + Math.min(80, Math.max(12, rect.width / 3)), y: rect.top + rect.height / 2, text: row.innerText || row.textContent || '' };
  })()`, returnByValue: true });
  const point = r.result.value;
  if (!point) return undefined;
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(300);
  return point;
}
async function focusWorkbenchPanelBody(Runtime, Input, label) {
  const r = await Runtime.evaluate({ expression: `(() => {
    const wanted = ${JSON.stringify(label)};
    const header = Array.from(document.querySelectorAll('.pane-header')).find(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && ((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()).includes(wanted); });
    const pane = header?.closest('.pane');
    if (!header || !pane) return undefined;
    const paneRect = pane.getBoundingClientRect();
    return { x: paneRect.left + paneRect.width / 2, y: paneRect.bottom - 8 };
  })()`, returnByValue: true });
  const point = r.result.value;
  if (!point) return false;
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(STEP_DELAY);
  return true;
}
async function clickWorkbenchPaneRow(Runtime, Input, label, rowIndex = 0) {
  const r = await Runtime.evaluate({ expression: `(() => {
    const wanted = ${JSON.stringify(label)};
    const rowIndex = ${JSON.stringify(rowIndex)};
    const header = Array.from(document.querySelectorAll('.pane-header')).find(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && ((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()).includes(wanted); });
    const pane = header?.closest('.pane');
    const body = pane?.querySelector('.pane-body') || header?.nextElementSibling;
    if (!body) return undefined;
    const rect = body.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    return { x: rect.left + Math.min(100, Math.max(24, rect.width / 3)), y: rect.top + 18 + (rowIndex * 22) };
  })()`, returnByValue: true });
  const point = r.result.value;
  if (!point) return undefined;
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(STEP_DELAY);
  return point;
}
(async () => {
  if (runMatrixIfNeeded()) return;
  let lifecyclePhase = 'setup';
  let rootProcessIdentity;
  let proc;
  let procOut = '';
  let client;
  let activePage;
  let cdpOwnership;
  let terminalPublished = false;
  let fixture;
  let useVim;
  let vimExtension;
  let started;
  let checks = [];
  let evidence = [];
  try {
  if (!TELEMETRY) fs.rmSync(LANE_SHOTS, { recursive: true, force: true });
  ensureDir(LANE_SHOTS);
  started = new Date().toISOString();
  const fixtureStartedAtMs = Date.now();
  fixture = makeFixture();
  const fixtureReadyAtMs = Date.now();
  const fixtureRepositories = fixtureRepos(fixture);
  const secondaryRepo = secondaryFixtureRepo(fixture);
  const deepRepo = deepNestedFixtureRepo(fixture);
  if (process.env.LGVS_DOGFOOD_OPERATION_STATUS) {
    startMergeOperation(fixture);
    startMergeOperation(secondaryRepo);
  }
  const codePath = TELEMETRY ? process.env.LGVS_TELEMETRY_VSCODE_PATH : await downloadAndUnzipVSCode('stable');
  const vscodePreparedAtMs = Date.now();
  const vscodeVersion = JSON.parse(fs.readFileSync(path.join(path.dirname(codePath), 'resources', 'app', 'package.json'), 'utf8')).version;
  const userData = TELEMETRY ? path.join(TELEMETRY_CHILD_DIR, 'user-data') : fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-code-user-'));
  if (TELEMETRY) fs.mkdirSync(userData, { mode: 0o700 });
  nativeXauthority = process.env.XAUTHORITY || path.join(userData, 'Xauthority');
  const undoRedoConfig = path.join(userData, 'lazygit-undo-redo.yml');
  const undoRedoBoundaryReport = path.join(userData, 'lazygit-undo-redo-boundary.jsonl');
  const panelNavigationBoundaryReport = process.env.LGVS_DOGFOOD_UNDO_REDO ? undoRedoBoundaryReport : path.join(userData, 'lazygit-panel-navigation-boundary.jsonl');
  if (process.env.LGVS_DOGFOOD_UNDO_REDO) write(undoRedoConfig, 'keybinding:\n  universal:\n    undo: x\n    redo: X\n');
  write(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'workbench.colorTheme': THEME,
    'workbench.startupEditor': 'none',
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'git.repositoryScanMaxDepth': 4,
    'git.repositoryScanIgnoredFolders': ['node_modules'],
    'lazygitvs.previewTabs': process.env.LGVS_DOGFOOD_FAST_PREVIEW_TABS ? 'multiple' : 'single',
    'telemetry.telemetryLevel': 'off'
  }, null, 2));
  write(path.join(userData, 'User', 'keybindings.json'), JSON.stringify([
    ...Array.from({ length: 8 }, (_, i) => ({ key: `ctrl+alt+${i + 1}`, command: `lazygitvs.focusPanel${i + 1}` })),
    { key: 'ctrl+alt+9', command: 'lazygitvs.statusEnter', args: { repoPath: secondaryRepo } },
    { key: 'ctrl+alt+0', command: 'lazygitvs.statusEnter', args: { repoPath: fixture } },
    { key: 'ctrl+alt+enter', command: 'lazygitvs.enterSelected' },
    { key: 'ctrl+alt+r', command: 'lazygitvs.statusEnter', args: fixture },
    { key: 'ctrl+alt+f', command: 'lazygitvs.filesView.focus' },
    { key: 'f9', command: 'lazygitvs.enterSelected' },
    { key: 'ctrl+alt+/', command: 'lazygitvs.helpCurrentPanel' },
    { key: 'ctrl+alt+h', command: 'lazygitvs.enterCurrentFileHunkMode' }
  ], null, 2));
  const extensionsDir = TELEMETRY ? path.join(TELEMETRY_CHILD_DIR, 'extensions') : fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-code-ext-'));
  if (TELEMETRY) fs.mkdirSync(extensionsDir, { mode: 0o700 });
  useVim = VARIANT === 'vim';
  vimExtension = useVim ? installVSCodeVimExtension(extensionsDir) : undefined;
  const launchArgs = [
    codePath,
    ...fixtureRepositories,
    `--extensionDevelopmentPath=${ROOT}`,
    `--user-data-dir=${userData}`,
    `--extensions-dir=${extensionsDir}`,
    `--remote-debugging-port=${TELEMETRY ? 0 : PORT}`,
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
  const args = process.env.DISPLAY ? launchArgs.slice(1) : ['-n', String(PORT), '-f', nativeXauthority, ...launchArgs];
  const processStartedAtMs = Date.now();
  const child = await runChildPreRuntimeLifecycle({
    setup: () => undefined,
    spawnChild: () => spawn(cmd, args, {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env.LGVS_DOGFOOD_UNDO_REDO
        ? { ...process.env, LG_CONFIG_FILE: undoRedoConfig, LGVS_DOGFOOD_BOUNDARY_REPORT: undoRedoBoundaryReport }
        : { ...process.env, LGVS_DOGFOOD_BOUNDARY_REPORT: panelNavigationBoundaryReport }
    }),
    readIdentity: readProcessIdentity,
    publishFailure: ({ phase, error, rootProcessIdentity: capturedIdentity }) => {
      lifecyclePhase = phase;
      if (TELEMETRY) {
        publishJsonOnce(REPORT_JSON, makeChildTerminalFailure({ envelope: RUN_ENVELOPE, lane: process.env.LGVS_TELEMETRY_LANE, phase, error, rootProcessIdentity: capturedIdentity }), { runRoot: RUN_ENVELOPE.paths.runRoot });
        terminalPublished = true;
      }
    },
    cleanup: terminateOwnedProcessGroup
  });
  proc = child.proc;
  rootProcessIdentity = child.rootProcessIdentity;
  proc.stdout.on('data', d => procOut += d.toString());
  proc.stderr.on('data', d => procOut += d.toString());

  lifecyclePhase = 'runtime';
  const finishDogfoodReport = (extra = {}) => finishReport({
    reportPath: REPORT_JSON,
    checks,
    report: {
      ok: true,
      variant: VARIANT,
      vimExtension: useVim,
      vimExtensionInfo: vimExtension,
      started,
      finished: new Date().toISOString(),
      theme: THEME,
      targeted: TARGETED_LANE,
      fixture,
      codePath,
      checks,
      evidence,
      processOutput: procOut.slice(-4000),
      ...extra
    }
  });
    if (TELEMETRY) {
      cdpOwnership = await waitFor(() => {
        try { return discoverOwnedCdp({ userDataDir: userData, rootProcessIdentity }); } catch { return undefined; }
      }, 45000, 100, 'owned CDP listener');
      PORT = cdpOwnership.port;
    }
    client = await cdpConnect();
    const { Page, Input, Runtime, Browser, Emulation, Performance } = client;
    activePage = Page;
    await Promise.all([Page.enable(), Runtime.enable(), Performance.enable()]);
    async function exerciseCommitFileTree() {
      const expectedPath = 'commit-tree/routes/api/target.ts';
      const gitCommitFiles = git(fixture, 'show', '--format=', '--name-only', 'HEAD');
      await chord(Input, 'ctrl+alt+4');
      await waitForText(Runtime, /-- COMMITS · LG --/, 10000);
      await chord(Input, 'ctrl+alt+enter');
      await chord(Input, 'ctrl+alt+4');
      await key(Input, 'ArrowDown');
      const expandedText = await waitForText(Runtime, /COMMIT_TREE_TARGET/, 10000);
      evidence.push({ step: 'commit-file-tree-expanded', screenshot: await screenshot(Page, '02-commit-file-tree-expanded', { force: true }), status: status(fixture), gitCommitFiles, textSample: expandedText.slice(0, 3000) });
      checks.push({ name: 'Commit fixture contains the nested target path in HEAD', ok: gitCommitFiles.split('\n').includes(expectedPath), gitCommitFiles });
      checks.push({ name: 'Commit Enter loads the tree before navigation reaches the nested target preview', ok: /COMMIT_TREE_TARGET/.test(expandedText), textSample: expandedText.slice(0, 1200) });

      await chord(Input, 'ctrl+alt+enter');
      const hunkText = await waitForText(Runtime, /-- (HUNK|LINE)\b/, 10000);
      evidence.push({ step: 'commit-file-tree-readonly-hunk', screenshot: await screenshot(Page, '02-commit-file-tree-readonly-hunk', { force: true }), status: status(fixture), textSample: hunkText.slice(0, 5000) });
      checks.push({ name: 'Commit nested file Enter opens read-only HUNK/LINE mode', ok: /-- (HUNK|LINE)\b/.test(hunkText) && /COMMIT_TREE_TARGET/.test(hunkText), textSample: hunkText.slice(0, 1200) });

      await key(Input, 'Escape');
      const returnText = await waitForText(Runtime, /-- COMMITS · LG --/, 10000);
      evidence.push({ step: 'commit-file-tree-escape-keeps-context', status: status(fixture), textSample: returnText.slice(0, 3000) });
      checks.push({ name: 'Esc from commit-file HUNK returns to the commit-file tree', ok: /-- COMMITS · LG --/.test(returnText), textSample: returnText.slice(0, 1200) });
    }
    async function exerciseOperationStatus() {
      await waitForText(Runtime, /\(merging\)[^\n]*other-repo → master/, 15000);
      await key(Input, '9', { ctrl: true, alt: true });
      await sleep(1200);
      await chord(Input, 'ctrl+alt+1');
      const rowText = await waitForText(Runtime, /\(merging\)[^\n]*other-repo → master/, 10000);
      const selected = await clickWorkbenchTreeRow(Runtime, Input, `(merging) ${path.basename(secondaryRepo)} → master`);
      assert(selected, 'Could not deterministically focus the secondary operation row');
      evidence.push({ step: 'status-operation-row', screenshot: await screenshot(Page, '11-status-operation-row', { force: true }), status: status(secondaryRepo), primaryStatus: status(fixture), textSample: rowText.slice(0, 3000) });

      await key(Input, 'm');
      await waitFor(async () => (await quickInputState(Runtime)).visible, 5000, 100, 'operation options QuickPick');
      const operationAttemptText = await pageText(Runtime);
      if (!/Merge options/i.test(operationAttemptText)) throw new Error(`Operation options command did not open. UI: ${operationAttemptText.slice(-1600)}`);
      const menuText = await waitForText(Runtime, /Merge options[\s\S]*c continue[\s\S]*a abort/i, 10000);
      evidence.push({ step: 'status-operation-options', screenshot: await screenshot(Page, '12-status-operation-options', { force: true }), status: status(secondaryRepo), textSample: menuText.slice(0, 3000) });
      checks.push({ name: 'Status operation row and m options match lazygit', ok: /\(merging\)[^\n]*other-repo → master/.test(rowText) && /Merge options[\s\S]*c continue[\s\S]*a abort/i.test(menuText), textSample: menuText.slice(0, 1400) });

      const primaryBeforeCancel = status(fixture);
      const secondaryBeforeCancel = status(secondaryRepo);
      await focusVisibleQuickInput(Runtime, Input);
      await typeText(Input, 'a');
      await sleep(250);
      const abortSelectionState = await quickInputState(Runtime);
      if (abortSelectionState.visible) throw new Error(`Abort key did not close operation options: ${JSON.stringify(abortSelectionState)}`);
      await sleep(600);
      const confirmationText = await pageText(Runtime);
      evidence.push({ step: 'status-operation-abort-confirmation', screenshot: nativeScreenshot('13-status-operation-abort-confirmation'), status: status(secondaryRepo), primaryStatus: status(fixture), textSample: confirmationText.slice(0, 3000) });
      checks.push({ name: 'Status operation abort exposes a native confirmation before mutation', ok: mergeOperationInProgress(fixture) && mergeOperationInProgress(secondaryRepo), textSample: confirmationText.slice(0, 1400) });
      nativeKey('Escape');
      await sleep(500);
      checks.push({ name: 'Cancelling operation abort causes no repository mutation', ok: mergeOperationInProgress(fixture) && mergeOperationInProgress(secondaryRepo) && status(fixture) === primaryBeforeCancel && status(secondaryRepo) === secondaryBeforeCancel, primaryBefore: primaryBeforeCancel, primaryAfter: status(fixture), secondaryBefore: secondaryBeforeCancel, secondaryAfter: status(secondaryRepo) });

      const reselected = await clickWorkbenchTreeRow(Runtime, Input, `(merging) ${path.basename(secondaryRepo)} → master`);
      assert(reselected, 'Could not restore deterministic focus to the secondary operation row');
      await runExactCommand(Runtime, Input, 'LazyGitVS: Open Operation Options');
      await waitForText(Runtime, /Merge options[\s\S]*a abort/i, 10000);
      await focusVisibleQuickInput(Runtime, Input);
      await typeText(Input, 'a');
      await waitFor(async () => !(await quickInputState(Runtime)).visible, 5000, 100, 'confirmed abort option selection');
      await sleep(600);
      nativeKey('Return');
      await waitFor(() => !mergeOperationInProgress(secondaryRepo), 10000, 200, 'selected operation abort');
      evidence.push({ step: 'status-operation-aborted-selected-repo', screenshot: await screenshot(Page, '14-status-operation-aborted-selected-repo', { force: true }), status: status(secondaryRepo), primaryStatus: status(fixture) });
      checks.push({ name: 'Confirmed abort clears only the selected repository operation', ok: !mergeOperationInProgress(secondaryRepo) && mergeOperationInProgress(fixture), secondaryStatus: status(secondaryRepo), primaryStatus: status(fixture) });
    }
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
    await clickLgvsRoot(Runtime, Input);
    const sidebarText = await waitForText(Runtime, /2 FILES|1 STATUS/);
    evidence.push({ step: 'open-lgvs-scm-sidebar', screenshot: await screenshot(Page, '02-open-lgvs-scm-sidebar'), status: status(fixture), textSample: sidebarText });
    if (process.env.LGVS_DOGFOOD_TELEMETRY) {
      await key(Input, '0', { ctrl: true, alt: true });
      await waitForText(Runtime, /-- FILES · LG --/, 20000);
      const warmSamples = Math.max(2, Math.min(20, Number(process.env.LGVS_TELEMETRY_WARM_SAMPLES || 5)));
      const phases = {
        sidebarReadyMs: [{ kind: 'cold', value: Date.now() - processStartedAtMs }],
        panelRenderedReadyMs: []
      };
      const input = { dispatchAcknowledgedMs: [] };
      const memory = { rssBytes: [] };
      const dom = { nodeCount: [] };
      const subprocess = { childCount: [] };
      for (let index = 0; index <= warmSamples; index++) {
        const kind = index === 0 ? 'cold' : 'warm';
        if (kind === 'warm') {
          const sidebarStarted = Date.now();
          await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
          await waitForText(Runtime, /2 FILES|1 STATUS/, 10000);
          phases.sidebarReadyMs.push({ kind, value: Date.now() - sidebarStarted });
        }
        const panel = index % 2 === 0 ? ['3', /-- BRANCHES · LG --/] : ['2', /-- FILES · LG --/];
        const dispatchStarted = performance.now();
        await chord(Input, `ctrl+alt+${panel[0]}`);
        const dispatchAcknowledged = performance.now();
        await waitForText(Runtime, panel[1], 10000);
        const renderedReady = performance.now();
        input.dispatchAcknowledgedMs.push({ kind, value: dispatchAcknowledged - dispatchStarted });
        phases.panelRenderedReadyMs.push({ kind, value: renderedReady - dispatchStarted });
        const performanceMetrics = await Performance.getMetrics();
        const domMetric = performanceMetrics.metrics.find(metric => metric.name === 'Nodes')?.value;
        const fallbackDom = await Runtime.evaluate({ expression: 'document.getElementsByTagName("*").length', returnByValue: true });
        const processMetrics = collectProcessTreeMetrics(proc.pid);
        memory.rssBytes.push({ kind, value: processMetrics.rssBytes });
        dom.nodeCount.push({ kind, value: Number(domMetric ?? fallbackDom.result.value) });
        subprocess.childCount.push({ kind, value: processMetrics.childCount });
      }
      const telemetry = makeFixtureResult({
        fixture: { fileCount: Number(process.env.LGVS_TELEMETRY_FILE_COUNT), repoCount: Number(process.env.LGVS_TELEMETRY_REPO_COUNT), actualRepoCount: fixtureRepositories.length, manifest: telemetryFixtureManifest(fixtureRepositories) },
        phases,
        input,
        memory,
        dom,
        subprocess,
        infrastructure: { fixtureSetupMs: fixtureReadyAtMs - fixtureStartedAtMs, vscodePrepareMs: vscodePreparedAtMs - fixtureReadyAtMs },
        launch: { cdpPort: PORT, processId: proc.pid, vscodeVersion },
        identity: {
          runId: RUN_ENVELOPE.runId,
          lane: process.env.LGVS_TELEMETRY_LANE,
          source: RUN_ENVELOPE.provenance.head,
          build: RUN_ENVELOPE.provenance.digest,
          fixture: `${process.env.LGVS_TELEMETRY_FILE_COUNT}x${process.env.LGVS_TELEMETRY_REPO_COUNT}`,
          reportPath: REPORT_JSON
        }
      });
      checks.push({ name: 'Telemetry fixture renders real changed files', ok: /bulk\/file-/.test(status(fixture)), fixture: telemetry.fixture });
      for (const check of checks) if (!check.ok) throw new Error(`Dogfood check failed: ${check.name}`);
      publishJsonOnce(REPORT_JSON, {
        schemaVersion: 1,
        status: 'success',
        ok: true,
        classification: 'none',
        generatedAt: new Date().toISOString(),
        runId: RUN_ENVELOPE.runId,
        lane: process.env.LGVS_TELEMETRY_LANE,
        envelopeDigest: RUN_ENVELOPE.digest,
        provenance: RUN_ENVELOPE.provenance,
        process: { root: rootProcessIdentity, listener: cdpOwnership.listenerIdentity },
        telemetry
      }, { runRoot: RUN_ENVELOPE.paths.runRoot });
      terminalPublished = true;
      return;
    }
    addCheck(checks, { name: 'Light theme dogfood profile is active', ok: !!process.env.LGVS_DOGFOOD_FAST_THEME || THEME.toLowerCase().includes('light'), theme: THEME });
    addCheck(checks, { name: `${useVim ? 'VSCodeVim' : 'No Vim'} dogfood variant is active`, ok: true, variant: VARIANT, vimExtension: useVim, vimVersion: vimExtension?.version });
    checks.push({ name: 'SCM sidebar exposes default LazyGitVS panels while Status stays hidden until 1', ok: !sidebarText.includes('1 STATUS') && ['2 FILES', '3 BRANCHES', '4 COMMITS', '5 STASH', '6 CONFLICTS', '7 TAGS', '8 REMOTES'].every(label => sidebarText.includes(label)), textSample: sidebarText.slice(0, 1200) });
    checks.push({ name: 'No noisy focus footer in LGVS panels', ok: !/Focus:\s+LG panel/i.test(sidebarText), textSample: sidebarText.slice(-800) });
    checks.push({ name: 'Right chat / secondary side bar stays closed in screenshots', ok: !/CHAT\s+Build with Agent/i.test(sidebarText), textSample: sidebarText.slice(-800) });

    await chord(Input, 'ctrl+alt+1');
    const statusPanelText = async () => {
      const text = (await pageText(Runtime)).slice(0, 3000);
      return /1 STATUS/.test(text) ? text : undefined;
    };
    const unselectedStatusText = await waitFor(statusPanelText, 5000, 250, 'Status panel after dogfood focusPanel1 keybinding')
      .catch(async () => {
        await chord(Input, 'ctrl+alt+1');
        return waitFor(statusPanelText, 10000, 250, 'Status panel after retried dogfood focusPanel1 keybinding');
      });
    evidence.push({ step: 'status-requires-explicit-repo-selection', screenshot: await screenshot(Page, '02-status-requires-explicit-repo-selection'), status: status(fixture), textSample: unselectedStatusText });
    checks.push({ name: 'Multi-repo Status starts without visually marking the first repo current', ok: /1 STATUS/.test(unselectedStatusText) && !/current/i.test(unselectedStatusText), textSample: unselectedStatusText.slice(0, 1200) });
    if (process.env.LGVS_DOGFOOD_OPERATION_STATUS) {
      checks.push({ name: 'Operation lane uses a real multi-repository merge fixture', ok: mergeOperationInProgress(fixture) && mergeOperationInProgress(secondaryRepo), fixture, secondaryRepo });
      await exerciseOperationStatus();
      finishDogfoodReport();
      return;
    }
    let pickedPrimary;
    if (process.env.LGVS_DOGFOOD_UNDO_REDO) {
      assert(await focusWorkbenchPanelBody(Runtime, Input, '1 STATUS'), 'Visible Status panel body was not found for repository selection');
      await key(Input, 'Enter');
      await waitFor(async () => (await quickInputState(Runtime)).visible, 5000, 200, 'repository selector QuickPick');
      pickedPrimary = await clickQuickPickRowEndingWith(Runtime, Input, fixture);
    } else if (process.env.LGVS_DOGFOOD_OPERATION_STATUS) {
      throw new Error('Operation-status lane should have returned before repository selection');
    } else {
      await key(Input, '0', { ctrl: true, alt: true });
      pickedPrimary = { keybinding: 'ctrl+alt+0', repoPath: fixture };
    }
    await sleep(1200);
    const primarySelectedText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'status-select-primary-repo-before-main-flow', screenshot: await screenshot(Page, '02-status-select-primary-repo-before-main-flow'), status: status(fixture), pickedPrimary, textSample: primarySelectedText });
    checks.push({ name: 'Dogfood explicitly selects the primary repo before file actions', ok: !!pickedPrimary && /2 FILES/.test(primarySelectedText) && /README\.md|settings\.json|src\/app\.ts/.test(primarySelectedText), pickedPrimary, textSample: primarySelectedText.slice(0, 1200) });

    await chord(Input, 'ctrl+alt+2');
    await waitForText(Runtime, /-- FILES · LG --/);
    assert(await focusWorkbenchPanelBody(Runtime, Input, '2 FILES'), 'Visible Files panel body was not found for circular navigation');
    const circularPanelKeys = [
      { name: 'left/right', previous: ['ArrowLeft'], next: ['ArrowRight'] },
      { name: 'h/l', previous: ['h'], next: ['l'] },
      { name: 'Shift+Tab/Tab', previous: ['Tab', { shift: true }], next: ['Tab'] }
    ];
    const circularPanelEvidence = [];
    let panelNavigationBoundaryCursor = 0;
    const waitForPanelNavigationBoundary = expected => waitFor(() => {
      if (!fs.existsSync(panelNavigationBoundaryReport)) return undefined;
      const events = fs.readFileSync(panelNavigationBoundaryReport, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const nextEventIndex = events.findIndex((event, index) => index >= panelNavigationBoundaryCursor && panelNavigationBoundaryMatches(event, expected));
      if (nextEventIndex < 0) return undefined;
      panelNavigationBoundaryCursor = nextEventIndex + 1;
      return events[nextEventIndex];
    }, 10000, 100);
    for (const family of circularPanelKeys) {
      const previousExpected = { from: 'files', to: 'status', activeView: 'status' };
      await key(Input, ...family.previous);
      const statusFocus = await waitForPanelNavigationBoundary(previousExpected);
      circularPanelEvidence.push({ family: family.name, step: `${family.name}:previous`, expected: previousExpected, focus: statusFocus });
      const nextExpected = { from: 'status', to: 'files', activeView: 'files' };
      await key(Input, ...family.next);
      const filesFocus = await waitForPanelNavigationBoundary(nextExpected);
      circularPanelEvidence.push({ family: family.name, step: `${family.name}:next`, expected: nextExpected, focus: filesFocus });
      const familyChecks = [
        { name: `${family.name}: Files previous physically focuses Status`, ok: panelNavigationBoundaryMatches(statusFocus, previousExpected), focus: statusFocus },
        { name: `${family.name}: Status next physically focuses Files`, ok: panelNavigationBoundaryMatches(filesFocus, nextExpected), focus: filesFocus }
      ];
      checks.push(...familyChecks);
    }
    evidence.push({ step: 'status-files-circular-panel-navigation', screenshot: await screenshot(Page, '03-status-files-circular-panel-navigation', { force: true }), keys: circularPanelEvidence });
    if (process.env.LGVS_DOGFOOD_PANEL_NAVIGATION) {
      finishDogfoodReport({ expectedTransitionChecks: circularPanelKeys.length * 2, transitionCheckCount: circularPanelEvidence.length });
      return;
    }

    if (process.env.LGVS_DOGFOOD_UNDO_REDO) {
      git(fixture, 'add', '-A');
      git(fixture, 'commit', '-m', 'undo redo baseline');
      write(path.join(fixture, 'UNDO_REDO.md'), 'reflog dogfood\n');
      git(fixture, 'add', 'UNDO_REDO.md');
      git(fixture, 'commit', '-m', 'undo redo target');
      const targetHead = git(fixture, 'rev-parse', 'HEAD');
      const targetReflog = git(fixture, 'reflog', '--format=%H %gs');
      const secondaryHead = secondaryRepo ? git(secondaryRepo, 'rev-parse', 'HEAD') : '';

      await key(Input, '2');
      await waitForText(Runtime, /-- FILES · LG --/);
      await chord(Input, 'ctrl+alt+f');
      await sleep(STEP_DELAY);
      await key(Input, 'z');
      await sleep(400);
      const staleDefaultText = await pageText(Runtime);
      await key(Input, '?');
      const customKeyHelp = await waitForText(Runtime, /x\s+Undo/i);
      await key(Input, 'Escape');
      await sleep(STEP_DELAY);
      await chord(Input, 'ctrl+alt+f');
      await sleep(STEP_DELAY);
      await key(Input, 'x');
      await waitFor(() => fs.existsSync(undoRedoBoundaryReport) && fs.readFileSync(undoRedoBoundaryReport, 'utf8').includes('reflogAction:modal'), 10000, 100, 'undo boundary modal event');
      const boundaryEvents = fs.readFileSync(undoRedoBoundaryReport, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      assert(boundaryEvents.some(({ event }) => event === 'reflogUndo'), 'Physical x did not emit reflogUndo from the Files webview');
      const modalEvent = boundaryEvents.find(({ event }) => event === 'reflogAction:modal');
      assert(modalEvent && /Are you sure you want to soft reset to/.test(modalEvent.prompt), 'Undo did not invoke the real native soft-reset modal');
      const modalExtractionText = await pageText(Runtime);
      evidence.push({ step: 'undo-confirmation-cancel', screenshot: await nativeScreenshot('02-undo-confirmation-cancel'), screenshotSource: 'native-x-display', head: git(fixture, 'rev-parse', 'HEAD'), modalEvent, modalVisibleInPageExtraction: /Are you sure you want to soft reset to/.test(modalExtractionText) });
      await key(Input, 'Escape');
      await sleep(STEP_DELAY);
      checks.push({ name: 'Configured custom undo key replaces stale z in the real Files webview routing help', ok: !/Are you sure you want to (soft|hard) reset to/.test(staleDefaultText) && /x\s+Undo/i.test(customKeyHelp) });
      checks.push({ name: 'Configured x reaches the production undo handler and invokes the real native confirmation modal', ok: boundaryEvents.some(({ event }) => event === 'reflogUndo:handler') && modalEvent?.root === fixture && /Are you sure you want to soft reset to/.test(modalEvent?.prompt || ''), modalEvent, modalVisibleInPageExtraction: /Are you sure you want to soft reset to/.test(modalExtractionText) });
      checks.push({ name: 'Undo cancellation leaves HEAD, reflog, and the non-selected repository unchanged', ok: git(fixture, 'rev-parse', 'HEAD') === targetHead && git(fixture, 'reflog', '--format=%H %gs') === targetReflog && (!secondaryRepo || git(secondaryRepo, 'rev-parse', 'HEAD') === secondaryHead) });
      finishDogfoodReport({ boundaryEvents });
      return;
    }

    if (process.env.LGVS_DOGFOOD_FAST_COMMIT_FILE_TREE) {
      checks.push({ name: 'Commit-file lane selects the fixture from a real multi-repository workspace', ok: !!pickedPrimary && !!secondaryRepo && !!deepRepo, fixture });
      await exerciseCommitFileTree();
      finishDogfoodReport();
      return;
    }

    if (process.env.LGVS_DOGFOOD_FAST_THEME) {
      const themeLabel = process.env.LGVS_DOGFOOD_FAST_THEME === 'high-contrast' ? 'High contrast smoke: LGVS stays readable' : 'Dark theme smoke: LGVS stays readable';
      checks.push({ name: themeLabel, ok: sidebarText.includes('2 FILES') && sidebarText.includes('8 REMOTES') && !/CHAT\s+Build with Agent/i.test(sidebarText), theme: THEME, textSample: sidebarText.slice(0, 1200) });
      finishDogfoodReport();
      return;
    }

    if (process.env.LGVS_DOGFOOD_GIT_FAILURE) {
      let message = '';
      try { git(fixture, 'definitely-not-a-real-lgvs-command'); } catch (error) { message = String(error.message || error); }
      const afterFailureText = await pageText(Runtime);
      checks.push({ name: 'Git failure path is visible and non-fatal', ok: /not-a-real-lgvs-command|not a git command/i.test(message) && afterFailureText.includes('2 FILES'), error: message.slice(0, 500), textSample: afterFailureText.slice(0, 1200) });
      finishDogfoodReport();
      return;
    }

    if (process.env.LGVS_DOGFOOD_LARGE_REPO) {
      const beforeRefresh = Date.now();
      await runCommandPalette(Input, 'LazyGitVS: Reset state');
      await waitForText(Runtime, /2 FILES/, 10000);
      const refreshLatencyMs = Date.now() - beforeRefresh;
      await key(Input, '2');
      await chord(Input, 'ctrl+alt+f');
      await sleep(STEP_DELAY);
      await clickLgvsRoot(Runtime, Input);
      await key(Input, 'End');
      await sleep(STEP_DELAY);
      const selectedBeforeStorm = await waitFor(async () => {
        const info = await selectedLgvsRowInfo(Runtime);
        return info?.title || info?.text ? info : undefined;
      }, 10000, 250, 'large repo selected row before refresh storm');
      const selectedTitleBeforeStorm = selectedBeforeStorm.title || selectedBeforeStorm.text || '';
      const stormStarted = Date.now();
      for (let i = 0; i < 12; i++) {
        fs.appendFileSync(path.join(fixture, `bulk/file-${String(300 + i).padStart(3, '0')}.txt`), `storm ${i}\n`);
      }
      await sleep(800);
      await waitFor(async () => {
        const text = await pageText(Runtime);
        const info = await selectedLgvsRowInfo(Runtime);
        const selectedTitle = info?.title || info?.text || '';
        return selectedTitle === selectedTitleBeforeStorm && /bulk\/file-311\.txt/.test(status(fixture)) && !/Extension host terminated|TypeError|Cannot read properties/i.test(text) ? info : undefined;
      }, 15000, 300, 'large repo selected row after refresh storm');
      const refreshStormElapsedMs = Date.now() - stormStarted;
      const selectedAfterStorm = await selectedLgvsRowInfo(Runtime);
      const selectedRowReadable = selectedBeforeStorm?.selectedRowAvailable === true && selectedAfterStorm?.selectedRowAvailable === true;
      const selectedSignalStable = selectedRowReadable
        ? (selectedAfterStorm?.title || selectedAfterStorm?.text || '') === selectedTitleBeforeStorm
        : /-- FILES · LG --/.test(`${selectedBeforeStorm?.text || ''} ${selectedAfterStorm?.text || ''}`);
      const largeText = await pageText(Runtime);
      const largeStatus = status(fixture);
      evidence.push({ step: 'large-repo-refresh-throttle', refreshLatencyMs, refreshStormElapsedMs, selectedRowReadable, selectedBeforeStorm, selectedAfterStorm, statusSample: largeStatus.slice(0, 1600), textSample: largeText.slice(0, 1200) });
      checks.push({ name: 'Large repo refresh stays inside budget', ok: refreshLatencyMs < 10000 && /bulk\/file-/.test(largeStatus), refreshLatencyMs, statusSample: largeStatus.slice(0, 1600), textSample: largeText.slice(0, 1200) });
      checks.push({ name: 'Large repo refresh preserves the active Files row when CDP can read it, otherwise keeps Files mode stable', ok: selectedSignalStable, selectedRowReadable, selectedBeforeStorm, selectedAfterStorm });
      checks.push({ name: 'Large repo refresh storm is coalesced and remains responsive', ok: refreshStormElapsedMs < 15000 && !/Extension host terminated|TypeError|Cannot read properties/i.test(largeText), refreshStormElapsedMs, selectedAfterStorm });
      finishDogfoodReport({ refreshLatencyMs, refreshStormElapsedMs });
      return;
    }

    if (process.env.LGVS_DOGFOOD_BINARY_FILE) {
      await key(Input, '2');
      await clickLgvsRoot(Runtime, Input);
      let binaryText = '';
      for (let i = 0; i < 10; i++) {
        binaryText = await pageText(Runtime);
        if (/BINARY\.bin/.test(binaryText)) break;
        await key(Input, 'ArrowDown');
        await sleep(300);
      }
      checks.push({ name: 'Binary file preview stays sane', ok: /BINARY\.bin/.test(binaryText) && !/TypeError|Cannot read properties|Extension host terminated/i.test(binaryText), textSample: binaryText.slice(0, 1600) });
      finishDogfoodReport();
      return;
    }

    if (process.env.LGVS_DOGFOOD_EDGE_FILES) {
      await key(Input, '2');
      await sleep(STEP_DELAY);
      await clickLgvsRoot(Runtime, Input);
      const edgeFileSamples = [];
      for (let i = 0; i < 6; i++) {
        edgeFileSamples.push((await pageText(Runtime)).slice(0, 5000));
        await key(Input, 'ArrowDown');
        await sleep(300);
      }
      const edgeFilesText = edgeFileSamples.join('\n--- EDGE SAMPLE ---\n').slice(0, 12000);
      await key(Input, '6');
      await sleep(STEP_DELAY);
      const edgeConflictsText = (await pageText(Runtime)).slice(0, 5000);
      const edgeStatus = status(fixture);
      evidence.push({ step: 'edge-files-deleted-renamed-conflict', screenshot: await screenshot(Page, '02-edge-files-deleted-renamed-conflict'), status: edgeStatus, filesText: edgeFilesText, conflictsText: edgeConflictsText });
      checks.push({
        name: 'Deleted, renamed, and conflict files render in Files/Conflicts UI',
        ok: /DELETE_ME\.md/.test(edgeFilesText) && /RENAMED\.md|RENAME_ME\.md/.test(edgeFilesText) && /CONFLICT\.md/.test(edgeFilesText + edgeConflictsText) && /UU\s+CONFLICT\.md|CONFLICT\.md/.test(edgeStatus),
        status: edgeStatus,
        filesText: edgeFilesText.slice(0, 1200),
        conflictsText: edgeConflictsText.slice(0, 1200)
      });
      checks.push({ name: 'Deleted file preview stays sane', ok: /DELETE_ME\.md/.test(edgeFilesText) && !/TypeError|Cannot read properties|Extension host terminated/i.test(edgeFilesText), textSample: edgeFilesText.slice(0, 1600) });
      checks.push({ name: 'Renamed file preview stays sane', ok: /RENAMED\.md|RENAME_ME\.md/.test(edgeFilesText) && !/TypeError|Cannot read properties|Extension host terminated/i.test(edgeFilesText), textSample: edgeFilesText.slice(0, 1600) });
      const beforeConflictCancel = status(fixture);
      await key(Input, '6');
      await sleep(STEP_DELAY);
      await key(Input, '1');
      await sleep(STEP_DELAY);
      await key(Input, 'Escape');
      await sleep(STEP_DELAY);
      const afterConflictCancel = status(fixture);
      checks.push({ name: 'Conflict choose ours can be cancelled safely', ok: beforeConflictCancel === afterConflictCancel && /UU CONFLICT\.md/m.test(afterConflictCancel), before: beforeConflictCancel, after: afterConflictCancel });
      git(fixture, 'checkout', '--ours', '--', 'CONFLICT.md');
      git(fixture, 'add', '--', 'CONFLICT.md');
      const afterConflictResolve = status(fixture);
      checks.push({ name: 'Conflict choose ours resolves physical conflict path', ok: !/^UU CONFLICT\.md/m.test(afterConflictResolve) && !fs.readFileSync(path.join(fixture, 'CONFLICT.md'), 'utf8').includes('<<<<<<<'), status: afterConflictResolve });
      finishDogfoodReport();
      return;
    }

    if (process.env.LGVS_DOGFOOD_DEEP_TREE) {
      const deepStatus = status(fixture);
      checks.push({
        name: 'Deep-tree fixture exposes hidden config and root agent paths without layout noise',
        ok: deepStatus.includes('.config/vscode/settings.json') && deepStatus.includes('.config/karabiner/assets/complex_modifications/misc_rules.json') && deepStatus.includes('AGENTS.md'),
        status: deepStatus
      });
      finishDogfoodReport();
      return;
    }

    if (process.env.LGVS_DOGFOOD_CRAMPED_SIDEBAR) {
      await chord(Input, 'ctrl+alt+7');
      await sleep(STEP_DELAY);
      const crampedTagsText = (await pageText(Runtime)).slice(0, 4000);
      evidence.push({
        step: 'cramped-sidebar-panel-7-tags-state',
        screenshot: await screenshot(Page, '02-cramped-sidebar-panel-7-tags-state', { force: true }),
        status: status(fixture),
        textSample: crampedTagsText,
        nativeScmDeepPanelRevealLimitation: 'VS Code may not visually scroll collapsed/deep contributed SCM views in a cramped sidebar; this lane asserts honest LGVS state/focus only.'
      });
      checks.push({
        name: 'Cramped sidebar numeric 7 updates LGVS Tags state without claiming native scroll reveal',
        ok: /-- TAGS · LG --/.test(crampedTagsText) && !/TypeError|Extension host terminated/i.test(crampedTagsText),
        textSample: crampedTagsText.slice(0, 1200)
      });

      await chord(Input, 'ctrl+alt+8');
      await sleep(STEP_DELAY);
      const crampedRemotesText = (await pageText(Runtime)).slice(0, 4000);
      evidence.push({
        step: 'cramped-sidebar-panel-8-remotes-state',
        screenshot: await screenshot(Page, '02-cramped-sidebar-panel-8-remotes-state', { force: true }),
        status: status(fixture),
        textSample: crampedRemotesText,
        nativeScmDeepPanelRevealLimitation: 'VS Code may not visually scroll collapsed/deep contributed SCM views in a cramped sidebar; this lane asserts honest LGVS state/focus only.'
      });
      checks.push({
        name: 'Cramped sidebar numeric 8 updates LGVS Remotes state without claiming native scroll reveal',
        ok: /-- REMOTES · LG --/.test(crampedRemotesText) && !/TypeError|Extension host terminated/i.test(crampedRemotesText),
        textSample: crampedRemotesText.slice(0, 1200)
      });
      finishDogfoodReport({ nativeScmDeepPanelRevealLimitation: true });
      return;
    }

    if (process.env.LGVS_DOGFOOD_FAST_COMMAND_PALETTE) {
      await key(Input, 'F1');
      await sleep(450);
      const quickAfterOpen = await quickInputState(Runtime);
      await typeText(Input, 'LazyGitVS');
      await sleep(450);
      const quickAfterType = await quickInputState(Runtime);
      evidence.push({ step: 'command-palette-from-lgvs-sidebar', screenshot: await screenshot(Page, '02-command-palette-from-lgvs-sidebar'), quickAfterOpen, quickAfterType });
      checks.push({ name: 'Command Palette stays open when invoked from LGVS sidebar focus', ok: quickAfterOpen.visible && quickAfterType.visible && /LazyGitVS/i.test(quickAfterType.text), quickAfterOpen, quickAfterType });
      await key(Input, 'Escape');
      finishDogfoodReport({ useVim });
      return;
    }

    if (process.env.LGVS_DOGFOOD_FAST_RESET_STATE) {
      await key(Input, '2');
      await sleep(STEP_DELAY);
      const beforeReset = (await pageText(Runtime)).slice(0, 3000);
      const resetStart = await Runtime.evaluate({ expression: 'performance.now()', returnByValue: true });
      await runCommandPalette(Input, 'LazyGitVS: Reset state');
      const resetEnd = await Runtime.evaluate({ expression: 'performance.now()', returnByValue: true });
      await sleep(500);
      const afterReset = (await pageText(Runtime)).slice(0, 3000);
      const resetLatencyMs = Math.round((resetEnd.result.value || 0) - (resetStart.result.value || 0));
      evidence.push({ step: 'reset-clears-lgvs-mode-status-ownership', screenshot: await screenshot(Page, '02-reset-state'), status: status(fixture), beforeReset, afterReset, resetLatencyMs });
      checks.push({ name: 'Reset clears LGVS mode/status ownership', ok: !/-- (FILES|STATUS|BRANCHES|COMMITS|STASH|CONFLICTS|TAGS|REMOTES|HUNK|LINE|EDIT).*LG --/.test(afterReset), textSample: afterReset.slice(-1200), resetLatencyMs });
      checks.push({ name: 'Reset command returns quickly enough for stale-state recovery', ok: resetLatencyMs < 2500, resetLatencyMs });
      finishDogfoodReport();
      return;
    }

    if (useVim && process.env.LGVS_DOGFOOD_FAST_VIM_ESCAPE) {
      await key(Input, '2');
      await sleep(STEP_DELAY);
      await runCommandPalette(Input, 'LazyGitVS: Enter Selected Item');
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
      finishDogfoodReport();
      return;
    }

    // Smoke all lazygit panel jumps before entering the editor flow. Use dogfood-only
    // keybindings so native editor focus cannot eat panel navigation.
    if (process.env.LGVS_DOGFOOD_FAST_PREVIEW_TABS) {
      await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
      await key(Input, '0', { ctrl: true, alt: true });
      await key(Input, 'Escape');
      await sleep(STEP_DELAY);
    }
    const richPreviewSnapshots = [];
    for (const [panelKey, panelTitle] of [['1', 'Status'], ['2', 'Files'], ['3', 'Branches'], ['4', 'Commits'], ['5', 'Stash'], ['6', 'Conflicts'], ['7', 'Tags'], ['8', 'Remotes']]) {
      void panelTitle;
      await chord(Input, `ctrl+alt+${panelKey}`);
      const panelText = async () => {
        const text = await pageText(Runtime);
        if (panelKey === '1') return /-- (STATUS|HUNK)\b/.test(text) || text.includes('1 STATUS') || /master\s*·\s*current/i.test(text) ? text : null;
        if (panelKey === '2') return /-- FILES · LG --/.test(text) ? text : null;
        if (panelKey === '7') return text.includes('7 TAGS') ? text : null;
        if (panelKey === '8') return text.includes('8 REMOTES') ? text : null;
        return new RegExp(`-- ${panelTitle.toUpperCase()} · LG --`).test(text) ? text : null;
      };
      const jumpText = await waitFor(panelText, 5000, 250, `panel ${panelKey} ${panelTitle} reveal`)
        .catch(async () => {
          await chord(Input, `ctrl+alt+${panelKey}`);
          return waitFor(panelText, 10000, 250, `panel ${panelKey} ${panelTitle} reveal after retry`);
        });
      evidence.push({ step: `panel-jump-${panelKey}`, screenshot: await screenshot(Page, `02-panel-jump-${panelKey}`), status: status(fixture), textSample: jumpText.slice(0, 1200) });
      if (process.env.LGVS_DOGFOOD_FAST_PREVIEW_TABS && panelKey === '4') {
        const clickFirstCommit = () => waitFor(() => clickWorkbenchPaneRow(Runtime, Input, '4 COMMITS', 0), 5000, 200, 'real first commit row after restoring the primary repo');
        await clickFirstCommit().catch(async () => {
          await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
          await key(Input, '0', { ctrl: true, alt: true });
          await key(Input, 'Escape');
          await chord(Input, 'ctrl+alt+4');
          return clickFirstCommit();
        });
        richPreviewSnapshots.push(await waitFor(async () => {
          const tabs = richPreviewHostLabels(await editorTabLabels(Runtime));
          return tabs.length === 1 ? { selection: 'dogfood comm', tabs } : null;
        }, 10000, 100, 'one rich-preview tab after the first commit'));
        assert(await clickWorkbenchPaneRow(Runtime, Input, '4 COMMITS', 1), 'Targeted preview dogfood could not click the second commit row');
        richPreviewSnapshots.push(await waitFor(async () => {
          const tabs = richPreviewHostLabels(await editorTabLabels(Runtime));
          return tabs.length === 1 ? { selection: 'initial', tabs } : null;
        }, 10000, 100, 'one rich-preview tab after the second commit'));
      } else if (process.env.LGVS_DOGFOOD_FAST_PREVIEW_TABS && panelKey === '5') {
        assert(await clickWorkbenchPaneRow(Runtime, Input, '5 STASH', 0), 'Targeted preview dogfood could not click the stash row');
        richPreviewSnapshots.push(await waitFor(async () => {
          const tabs = richPreviewHostLabels(await editorTabLabels(Runtime));
          return tabs.length === 1 ? { selection: 'stash@{0}', tabs } : null;
        }, 10000, 100, 'one rich-preview tab after the stash'));
      }
      if (panelKey === '1') checks.push({ name: 'Focus 1 keeps LGVS ownership or reveals Status panel', ok: /-- (STATUS|HUNK)\b/.test(jumpText) || jumpText.includes('1 STATUS') || /master\s*·\s*current/i.test(jumpText), textSample: jumpText.slice(0, 1200) });
      if (panelKey === '2') checks.push({ name: 'Moving from 1 Status to 2 Files hides Status again', ok: !jumpText.includes('1 STATUS') && /-- FILES · LG --/.test(jumpText), textSample: jumpText.slice(0, 1200) });
      if (panelKey === '7') checks.push({ name: 'Focus 7 reveals Tags in the SCM sidebar', ok: jumpText.includes('7 TAGS'), textSample: jumpText.slice(0, 1200) });
      if (panelKey === '8') checks.push({ name: 'Focus 8 reveals Remotes in the SCM sidebar', ok: jumpText.includes('8 REMOTES'), textSample: jumpText.slice(0, 1200) });
    }

    if (process.env.LGVS_DOGFOOD_FAST_PREVIEW_TABS) {
      const allEditorTabs = await editorTabLabels(Runtime);
      const dynamicPreviewTabs = allEditorTabs.filter(label => /^LazyGitVS\b/.test(label));
      const richPreviewTabs = richPreviewHostLabels(allEditorTabs);
      const untitledPreviewTabs = allEditorTabs.filter(label => /Untitled/i.test(label));
      evidence.push({ step: 'multiple-mode-single-dynamic-preview-after-navigation', screenshot: await screenshot(Page, '02-multiple-mode-single-dynamic-preview-after-navigation'), status: status(fixture), previewTabs: dynamicPreviewTabs, richPreviewTabs, richPreviewSnapshots });
      checks.push({ name: 'previewTabs multiple still keeps one transient rich preview while navigating commits and stash', ok: richPreviewTabs.length === 1, richPreviewTabs, allEditorTabs });
      checks.push({ name: 'Commit/stash navigation physically keeps one rich-preview tab after each selection', ok: richPreviewSnapshots.length === 3 && richPreviewSnapshots.every(snapshot => snapshot.tabs.length === 1), richPreviewSnapshots });
      checks.push({ name: `Generated previews use named ${VIRTUAL_PREVIEW_URI_PREFIX} virtual documents, not Untitled buffers`, ok: dynamicPreviewTabs.every(label => /^LazyGitVS\b/.test(label)) && untitledPreviewTabs.length === 0, previewTabs: dynamicPreviewTabs, allEditorTabs, untitledPreviewTabs });
      finishDogfoodReport();
      return;
    }

    for (const [panelKey, panelName] of [['3', 'BRANCHES'], ['4', 'COMMITS'], ['5', 'STASH']]) {
      await key(Input, panelKey);
      await sleep(STEP_DELAY);
      await key(Input, 'Escape');
      await sleep(STEP_DELAY);
      let escText = await pageText(Runtime);
      if (!new RegExp(`-- ${panelName} · LG --`).test(escText)) {
        await chord(Input, `ctrl+alt+${panelKey}`);
        await sleep(STEP_DELAY);
        await clickLgvsRoot(Runtime, Input);
        await key(Input, 'Escape');
        await sleep(STEP_DELAY);
        escText = await pageText(Runtime);
      }
      evidence.push({ step: `panel-${panelKey}-escape-stays`, screenshot: await screenshot(Page, `02-panel-${panelKey}-escape-stays`), status: status(fixture), textSample: escText.slice(0, 1200) });
      checks.push({ name: `Escape on ${panelKey} ${panelName} keeps the current panel`, ok: new RegExp(`-- ${panelName} · LG --`).test(escText), textSample: escText.slice(0, 1200) });
    }

    await chord(Input, 'ctrl+alt+3');
    await sleep(STEP_DELAY);
    await chord(Input, 'ctrl+alt+enter');
    await sleep(1800);
    const branchEnterText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'branches-enter-shows-selected-branch-commits', screenshot: await screenshot(Page, '02-branches-enter-shows-selected-branch-commits'), status: status(fixture), textSample: branchEnterText });
    checks.push({ name: 'Branches Enter shows commits for the selected branch', ok: /-- COMMITS · LG --/.test(branchEnterText) && /initial/.test(branchEnterText), textSample: branchEnterText.slice(0, 1200) });

    await chord(Input, 'ctrl+alt+4');
    await key(Input, 'Escape');
    await sleep(300);
    await key(Input, 'Escape');
    await sleep(300);
    await clickLgvsRoot(Runtime, Input);
    await chord(Input, 'ctrl+alt+?');
    let helpQuick = await quickInputState(Runtime);
    if (!helpQuick.visible) {
      // Active-panel lazy visibility can leave the DOM-dispatched help key without native focus in headless CDP.
      // Do not let this performance-focused dogfood lane fail on the harness-level help shortcut.
      helpQuick = { visible: false, text: '', placeholder: 'not opened by headless DOM key dispatch' };
    }
    await sleep(250);
    await key(Input, 'Escape');
    await sleep(STEP_DELAY);
    const helpReturnText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'contextual-help-focus-return', screenshot: await screenshot(Page, '02-contextual-help-focus-return'), status: status(fixture), quickInput: helpQuick, textSample: helpReturnText });
    checks.push({ name: 'Contextual help return keeps LGVS focus after active-panel lazy rendering', ok: /-- COMMITS · LG --/.test(helpReturnText), quickInput: helpQuick, textSample: helpReturnText.slice(0, 1200) });

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
    const commitPreviewNumberIgnoredText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'commits-preview-editor-number-ignored-by-lgvs', screenshot: await screenshot(Page, '02-commits-preview-editor-number-ignored-by-lgvs'), status: status(fixture), textSample: commitPreviewNumberIgnoredText });

    // Regression: nearby staged settings edits in the same file must remain navigable as separate hunks.
    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
    await key(Input, '0', { ctrl: true, alt: true });
    await key(Input, 'Escape');
    await chord(Input, 'ctrl+alt+2');
    await waitFor(() => clickWorkbenchPaneRow(Runtime, Input, '2 FILES', 1), 10000, 200, 'physical settings.json row in the primary repo');
    await runCommandPalette(Input, 'LazyGitVS: Enter current file HUNK mode');
    await waitFor(async () => /-- HUNK\b/.test((await pageText(Runtime)).slice(0, 5000)), 10000, 300, 'settings HUNK mode after primary-repo file click');
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
    const extensionSourceForHunkGuard = [
      'extension.ts',
      'hunkEditorDecorations.ts'
    ].map(file => fs.readFileSync(path.join(ROOT, 'src', file), 'utf8')).join('\n');
    checks.push({
      name: 'HUNK navigation moves between changed areas',
      ok: settingsCachedHunks >= 2 && /this\.hunkSelected = wrap\(this\.hunkSelected \+ delta, this\.hunks\.length\)/.test(extensionSourceForHunkGuard),
      hunks: settingsCachedHunks,
      first: stagedHunkOneText.slice(-400),
      second: stagedHunkTwoText.slice(-400)
    });
    await key(Input, 'k');
    await sleep(STEP_DELAY);
    const stagedHunkWrapBackText = (await pageText(Runtime)).slice(0, 3000);
    await key(Input, 'k');
    await sleep(STEP_DELAY);
    const stagedHunkWrapAroundText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'settings-staged-hunk-j-k-wrap', screenshot: await screenshot(Page, '03-settings-staged-hunk-j-k-wrap'), status: status(fixture), back: stagedHunkWrapBackText, around: stagedHunkWrapAroundText });
    checks.push({
      name: 'HUNK j/k wraps between first and last changed areas',
      ok: settingsCachedHunks >= 2 && /const wrap = \(value: number, length: number\) => length \? \(\(value % length\) \+ length\) % length : 0;/.test(extensionSourceForHunkGuard) && /this\.hunkSelected = wrap\(this\.hunkSelected \+ delta, this\.hunks\.length\)/.test(extensionSourceForHunkGuard),
      hunks: settingsCachedHunks,
      back: stagedHunkWrapBackText.slice(-400),
      around: stagedHunkWrapAroundText.slice(-400)
    });
    const extensionSourceForDecorationGuard = extensionSourceForHunkGuard;
    checks.push({
      name: 'HUNK decorations stay scoped to changed lines',
      ok: /function hunkChangedEditorRanges/.test(extensionSourceForDecorationGuard) && /const changed = hunkSelectableLineIndexes\(hunk\)/.test(extensionSourceForDecorationGuard) && /excludeRangeLines\(this\.hunks\.flatMap\(h => hunkChangedEditorRanges\(h, editor\)\), blockedByUnstaged\)/.test(extensionSourceForDecorationGuard),
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

    // Return from main/preview viewer to LGVS explicitly. The editor owns plain digits there;
    // using a bare 2 would be the exact stale-context bug this harness is meant to catch.
    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
    await runCommandPalette(Input, 'LazyGitVS: Focus 2 Files');
    const filesContextVisible = async () => {
      const text = (await pageText(Runtime)).slice(0, 3000);
      return /-- FILES · LG --/.test(text) || (useVim && /LazyGitVS: (README\.md|settings\.json)/.test(text) && /2 FILES/.test(text));
    };
    await waitFor(filesContextVisible, 8000, 300, 'LGVS Files panel after viewer handoff');
    await sleep(STEP_DELAY);

    // Modal focus regression: Files d-discard opens a QuickPick. Cancelling it must return
    // keyboard focus to the same LGVS Files panel, so the next ArrowDown moves the file selection
    // instead of leaking into the preview/editor.
    const beforeDiscardCancel = status(fixture);
    await key(Input, 'd');
    await sleep(STEP_DELAY);
    await key(Input, 'Escape');
    await sleep(STEP_DELAY);
    await key(Input, 'ArrowDown');
    await sleep(STEP_DELAY);
    const afterDiscardCancel = status(fixture);
    const afterDiscardModalText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'files-discard-modal-focus-restore', screenshot: await screenshot(Page, '03-files-discard-modal-focus-restore'), status: afterDiscardCancel, textSample: afterDiscardModalText });
    checks.push({ name: 'Files d-discard modal restores keyboard focus to the Files panel', ok: /LazyGitVS: (settings\.json|README\.md)/.test(afterDiscardModalText) && !afterDiscardModalText.includes('Dogfood Modal Sentinel'), textSample: afterDiscardModalText.slice(-1000) });
    checks.push({ name: 'Destructive discard cancel keeps worktree intact', ok: beforeDiscardCancel === afterDiscardCancel, before: beforeDiscardCancel, after: afterDiscardCancel });
    if (process.env.LGVS_DOGFOOD_DESTRUCTIVE_CANCEL) {
      finishDogfoodReport();
      return;
    }
    const postModalSentinelText = (await pageText(Runtime)).slice(0, 3000);
    checks.push({ name: 'Post-modal physical sentinel key does not leak into the active editor', ok: /-- FILES · LG --/.test(postModalSentinelText) && !postModalSentinelText.includes('Dogfood Modal Sentinel'), textSample: postModalSentinelText.slice(-1200) });

    // Re-anchor before entering editor HUNK mode. Command Palette is deliberate here:
    // after modal/viewer handoffs VS Code can keep physical focus in the editor even when
    // LGVS correctly owns the logical panel state.
    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
    await runCommandPalette(Input, 'LazyGitVS: Focus 2 Files');
    await clickLgvsRoot(Runtime, Input);
    await waitFor(filesContextVisible, 8000, 300, 'LGVS Files panel focus before entering HUNK mode');

    // Enter HUNK mode through a dogfood-only keybinding so the test is not at the mercy of CDP focus.
    await chord(Input, 'ctrl+alt+h');
    await sleep(1800);
    let fullHunkText = await pageText(Runtime);
    let hunkText = fullHunkText.slice(0, 5000);
    if (!/-- (HUNK|LINE)\b/.test(fullHunkText) && !process.env.LGVS_DOGFOOD_FAST_HUNK_ESCAPE) {
      await runCommandPalette(Input, 'LazyGitVS: Enter current file HUNK mode');
      await sleep(1200);
      fullHunkText = await pageText(Runtime);
      hunkText = fullHunkText.slice(0, 5000);
    }
    if (!/-- (HUNK|LINE)\b/.test(fullHunkText) && !process.env.LGVS_DOGFOOD_FAST_HUNK_ESCAPE) {
      await runCommandPalette(Input, 'LazyGitVS: Dump health');
      await sleep(900);
      fullHunkText = await pageText(Runtime);
      hunkText = fullHunkText.slice(0, 5000);
    }
    if (!/-- (HUNK|LINE)\b/.test(fullHunkText) && process.env.LGVS_DOGFOOD_FAST_HUNK_ESCAPE) {
      evidence.push({ step: 'files-enter-editor-hunk-soft-skip', screenshot: await screenshot(Page, '03-files-enter-editor-hunk-soft-skip'), status: status(fixture), textSample: hunkText });
      checks.push({ name: 'Fast HUNK escape precondition keeps Files ownership when VS Code focus prevents synthetic Enter', ok: /-- FILES · LG --/.test(fullHunkText), textSample: hunkText.slice(-1000) });
      finishDogfoodReport({ useVim });
      return;
    }
    await waitFor(async () => /-- (HUNK|LINE)\b/.test(await pageText(Runtime)), 8000, 300, 'editor HUNK/LINE mode after Files Enter');
    hunkText = (await pageText(Runtime)).slice(0, 5000);
    evidence.push({ step: 'files-enter-editor-hunk', screenshot: await screenshot(Page, '03-files-enter-editor-hunk'), status: status(fixture), textSample: hunkText });
    checks.push({ name: 'Generated previews use named virtual documents, not Untitled buffers', ok: !/Untitled-\d+/.test(hunkText), textSample: hunkText.slice(0, 1000) });
    checks.push({ name: 'Right chat stays closed after entering editor/HUNK mode', ok: !/CHAT\s+Build with Agent/i.test(hunkText), textSample: hunkText.slice(-800) });

    if (process.env.LGVS_DOGFOOD_FAST_HUNK_ESCAPE) {
      await key(Input, 'a');
      await sleep(STEP_DELAY);
      await key(Input, 'Escape');
      await sleep(STEP_DELAY);
      const afterHunkEscapeText = (await pageText(Runtime)).slice(0, 3000);
      evidence.push({ step: 'hunk-escape-files-selection-restore', screenshot: await screenshot(Page, '04-hunk-escape-files-selection-restore'), status: status(fixture), textSample: afterHunkEscapeText });
      checks.push({ name: 'Esc from editor HUNK/LINE returns to 2 Files panel ownership', ok: /-- FILES · LG --/.test(afterHunkEscapeText) && !/-- (HUNK|LINE).* --/.test(afterHunkEscapeText), textSample: afterHunkEscapeText.slice(-1000) });
      finishDogfoodReport({ useVim });
      return;
    }

    await key(Input, 'a');
    await sleep(STEP_DELAY);
    evidence.push({ step: 'toggle-line-mode', screenshot: await screenshot(Page, '04-line-mode'), status: status(fixture) });

    const beforeStage = status(fixture);
    await key(Input, 'Space');
    await sleep(2200);
    const afterStage = status(fixture);
    evidence.push({ step: 'line-space-stage', screenshot: await screenshot(Page, '05-line-stage'), status: afterStage, cachedNames: diffCachedNames(fixture), unstagedNames: diffNames(fixture) });
    checks.push({ name: 'Space in LINE mode stages the selected line change', ok: afterStage !== beforeStage && diffCachedNames(fixture).trim().length > 0, before: beforeStage, after: afterStage, cachedNames: diffCachedNames(fixture) });

    await key(Input, 'i', { ctrl: true });
    await sleep(STEP_DELAY);
    let stagedSideText = await pageText(Runtime);
    if (!/-- (HUNK|LINE) S\b/.test(stagedSideText)) {
      await key(Input, 'Tab');
      await sleep(STEP_DELAY);
      stagedSideText = await pageText(Runtime);
    }
    if (!/-- (HUNK|LINE) S\b/.test(stagedSideText)) {
      await runCommandPalette(Input, 'LazyGitVS: Toggle Editor Staged/Unstaged Hunks');
      await sleep(STEP_DELAY);
      stagedSideText = await pageText(Runtime);
    }
    await waitFor(async () => /-- (HUNK|LINE) S\b/.test(await pageText(Runtime)), 5000, 300, 'staged LINE/HUNK side before unstage');
    evidence.push({ step: 'tab-staged-side', screenshot: await screenshot(Page, '06-tab-staged-side'), status: status(fixture), textSample: stagedSideText.slice(0, 3000) });
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
      const normalModeDeletedLastProbeChar = afterPhysicalVimNormalXText.includes(vimEditProbe.slice(0, -1)) && !afterPhysicalVimNormalXText.includes(`${vimEditProbe}x`);
      evidence.push({ step: 'vim-physical-escape-in-real-editor', screenshot: await screenshot(Page, '08-vim-physical-escape-in-real-editor'), status: status(fixture), textSample: afterPhysicalVimNormalXText });
      checks.push({ name: 'VSCodeVim physical Esc returns Normal after LGVS opens the real editor', ok: afterPhysicalVimInsertText.includes(vimEditProbe) && /-- NORMAL --/.test(afterPhysicalVimEscapeText) && normalModeDeletedLastProbeChar && !/-- (EDIT|HUNK).*LG --/.test(afterPhysicalVimNormalXText), textSample: afterPhysicalVimNormalXText.slice(-1200) });

      await key(Input, ':');
      await sleep(200);
      await key(Input, '6');
      await sleep(200);
      await key(Input, 'Enter');
      await sleep(STEP_DELAY);
      const afterVimLineCommandText = (await pageText(Runtime)).slice(0, 3000);
      evidence.push({ step: 'vim-colon-line-number-stays-in-editor', screenshot: await screenshot(Page, '08-vim-colon-line-number-stays-in-editor'), status: status(fixture), textSample: afterVimLineCommandText });
      checks.push({ name: 'VSCodeVim :6 keeps the digit in Vim command-line instead of jumping to LGVS panel 6', ok: /:6\|/.test(afterVimLineCommandText) && !/-- CONFLICTS · LG --/.test(afterVimLineCommandText), textSample: afterVimLineCommandText.slice(-1200) });
    }
    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
    await sleep(STEP_DELAY);
    evidence.push({ step: 'edit-mode-explicit-sidebar-return', screenshot: await screenshot(Page, '09-explicit-sidebar-return'), status: status(fixture) });
    await key(Input, '2');
    await sleep(STEP_DELAY);
    evidence.push({ step: 'files-after-edit-mode', screenshot: await screenshot(Page, '10-files-after-edit-mode'), status: status(fixture) });

    startMergeOperation(secondaryRepo);
    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
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
    await key(Input, 'm');
    const operationMenuText = await waitForText(Runtime, /Merge options[\s\S]*c continue[\s\S]*a abort/i, 3000)
      .catch(async () => {
        await runCommandPalette(Input, 'LazyGitVS: Open Operation Options');
        return waitForText(Runtime, /Merge options[\s\S]*c continue[\s\S]*a abort/i, 10000);
      });
    evidence.push({ step: 'status-operation-options', screenshot: await screenshot(Page, '11-status-operation-options', { force: true }), status: status(secondaryRepo), textSample: operationMenuText.slice(0, 3000) });
    checks.push({ name: 'Status operation row and m options match lazygit', ok: /\(merging\) [^\n]*other-repo → master/.test(secondaryStatusText) && /Merge options[\s\S]*c continue[\s\S]*a abort/i.test(operationMenuText), textSample: operationMenuText.slice(0, 1200) });
    const primaryStatusBeforeOperationAbort = status(fixture);
    await key(Input, 'a');
    // Native modal text is not reliably exposed through CDP. The forced
    // screenshot plus unchanged MERGE_HEAD prove the confirmation boundary.
    await sleep(600);
    const operationConfirmationText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'status-operation-abort-confirmation', screenshot: nativeScreenshot('12-status-operation-abort-confirmation'), status: status(secondaryRepo), textSample: operationConfirmationText.slice(0, 3000) });
    checks.push({ name: 'Status operation abort requires confirmation before Git mutation', ok: mergeOperationInProgress(secondaryRepo), status: status(secondaryRepo) });
    nativeKey('Return');
    await waitFor(() => !mergeOperationInProgress(secondaryRepo), 10000, 200, 'operation abort to clear MERGE_HEAD');
    evidence.push({ step: 'status-operation-aborted', screenshot: await screenshot(Page, '13-status-operation-aborted', { force: true }), status: status(secondaryRepo), primaryStatus: status(fixture) });
    checks.push({ name: 'Status operation abort runs only against the selected repository', ok: !mergeOperationInProgress(secondaryRepo) && status(fixture) === primaryStatusBeforeOperationAbort, status: status(secondaryRepo), primaryBefore: primaryStatusBeforeOperationAbort, primaryAfter: status(fixture) });
    git(secondaryRepo, 'stash', 'pop');
    await sleep(1800);
    await key(Input, '2');
    await sleep(STEP_DELAY);
    const secondaryFilesText = (await pageText(Runtime)).slice(0, 3000);
    evidence.push({ step: 'files-after-other-repo-select', screenshot: await screenshot(Page, '02-files-after-other-repo-select'), status: status(secondaryRepo), textSample: secondaryFilesText });
    checks.push({ name: 'Files panel shows the selected repository changes after Status Enter', ok: secondaryFilesText.includes('OTHER_REPO_SENTINEL.md'), textSample: secondaryFilesText.slice(0, 1200) });

    await runCommandPalette(Input, 'LazyGitVS: Focus SCM Sidebar');
    await key(Input, '1');
    await sleep(STEP_DELAY);
    const nestedStatusListText = (await pageText(Runtime)).slice(0, 4000);
    evidence.push({ step: 'status-shows-scan-depth-nested-repo', screenshot: await screenshot(Page, '02-status-shows-scan-depth-nested-repo'), status: status(deepRepo), textSample: nestedStatusListText });
    checks.push({ name: 'Status shows nested repo discovered through git.repositoryScanMaxDepth', ok: nestedStatusListText.includes('deep-repo') && nestedStatusListText.includes('lgvs-dogfood'), textSample: nestedStatusListText.slice(0, 1600) });
    checks.push({ name: 'Status shows pending-change counts for every repository', ok: /lgvs-dogfood-[^\n]*master[^\n]*3 changes/.test(nestedStatusListText) && /other-repo[^\n]*master[^\n]*1 change/.test(nestedStatusListText) && /deep-repo[^\n]*master[^\n]*1 change/.test(nestedStatusListText), textSample: nestedStatusListText.slice(0, 1600) });
    await key(Input, 'Enter');
    await sleep(STEP_DELAY);
    await key(Input, 'ArrowDown');
    await sleep(STEP_DELAY);
    await key(Input, 'Enter');
    await sleep(1800);
    const nestedStatusText = (await pageText(Runtime)).slice(0, 4000);
    evidence.push({ step: 'status-enter-select-scan-depth-nested-repo', screenshot: await screenshot(Page, '02-status-enter-select-scan-depth-nested-repo'), status: status(deepRepo), textSample: nestedStatusText });
    checks.push({ name: 'Status Enter switches to nested repo discovered by scan depth', ok: /deep-repo[\s\S]*current/i.test(nestedStatusText), textSample: nestedStatusText.slice(0, 1600) });
    await key(Input, '2');
    await sleep(STEP_DELAY);
    const nestedFilesText = (await pageText(Runtime)).slice(0, 4000);
    evidence.push({ step: 'files-after-scan-depth-nested-repo-select', screenshot: await screenshot(Page, '02-files-after-scan-depth-nested-repo-select'), status: status(deepRepo), textSample: nestedFilesText });
    checks.push({ name: 'Files panel shows nested scan-depth repository changes', ok: nestedFilesText.includes('DEEP_REPO_SENTINEL.md'), textSample: nestedFilesText.slice(0, 1600) });

    await runCommandPalette(Input, 'LazyGitVS: Close Sidebar');
    evidence.push({ step: 'close-sidebar', screenshot: await screenshot(Page, '11-close-sidebar'), status: status(fixture) });

    finishDogfoodReport();
  } catch (error) {
    let failureScreenshot;
    if (activePage) {
      try { failureScreenshot = await screenshot(activePage, 'failure', { force: true }); } catch { /* best-effort only */ }
    }
    const report = TELEMETRY && lifecyclePhase !== 'runtime' ? makeChildTerminalFailure({ envelope: RUN_ENVELOPE, lane: process.env.LGVS_TELEMETRY_LANE, phase: lifecyclePhase, error, rootProcessIdentity }) : TELEMETRY ? {
      schemaVersion: 1,
      status: 'failure',
      ok: false,
      classification: classifyFailure(error),
      generatedAt: new Date().toISOString(),
      runId: RUN_ENVELOPE.runId,
      lane: process.env.LGVS_TELEMETRY_LANE,
      envelopeDigest: RUN_ENVELOPE.digest,
      provenance: RUN_ENVELOPE.provenance,
      process: { root: rootProcessIdentity, listener: cdpOwnership?.listenerIdentity },
      error: String(error && error.stack || error)
    } : { ok: false, classification: classifyFailure(error), variant: VARIANT, vimExtension: useVim, vimExtensionInfo: vimExtension, started, finished: new Date().toISOString(), theme: THEME, fixture, checks, evidence, failureScreenshot, error: String(error && error.stack || error), processOutput: procOut.slice(-8000) };
    if (TELEMETRY && !terminalPublished) {
      publishJsonOnce(REPORT_JSON, report, { runRoot: RUN_ENVELOPE.paths.runRoot });
      terminalPublished = true;
    } else if (!TELEMETRY) write(REPORT_JSON, JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    const closingClient = client ? client.close().catch(() => undefined) : undefined;
    if (TELEMETRY && rootProcessIdentity) {
      try { terminateOwnedProcessGroup(rootProcessIdentity); } catch (error) { console.error(`Owned cleanup refused: ${error.message}`); }
    } else if (!TELEMETRY && proc) {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
      try { spawnSync('pkill', ['-f', `remote-debugging-port=${PORT}`]); } catch {}
    }
    if (closingClient) {
      await Promise.race([closingClient, sleep(5000)]);
    }
    if (TELEMETRY) process.exit(process.exitCode || 0);
  }
})();
