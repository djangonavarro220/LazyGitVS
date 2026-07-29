const assert = require('assert');
const { connectResponsiveWorkbench, CdpRootDomUnreachableError } = require('../scripts/dogfood/cdp-workbench');

function target(id, title = id) {
  return { id, title, type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1/${id}` };
}

async function staleFirstReadySecond() {
  const stale = { closed: false, Runtime: { evaluate: () => new Promise(() => {}) }, close() { this.closed = true; } };
  const ready = { Runtime: { async evaluate(request) { assert.deepStrictEqual(request, { expression: 'document.readyState', returnByValue: true }); return { result: { value: 'interactive' } }; } }, close() {} };
  const first = target('stale', 'Visual Studio Code');
  const second = target('ready', 'Other page');
  const calls = [];
  const selected = await connectResponsiveWorkbench({
    listTargets: async () => [first, second], connect: async page => { calls.push(page.id); return page.id === 'stale' ? stale : ready; }, timeoutMs: 3000
  });
  assert.strictEqual(selected.target.id, 'ready');
  assert.strictEqual(selected.client.Input, undefined);
  assert.deepStrictEqual(calls, ['stale', 'ready']);
  assert.strictEqual(stale.closed, true);
}

async function allUnresponsiveStopsBeforeInput() {
  const page = target('stale');
  await assert.rejects(
    () => connectResponsiveWorkbench({ listTargets: async () => [page], connect: async () => ({ Runtime: { evaluate: () => new Promise(() => {}) }, close() {} }) }),
    error => error instanceof CdpRootDomUnreachableError && error.classification === 'cdp-root-dom-unreachable' && error.fingerprint === 'cdp-root-dom-unreachable|stage=pre-input|operation=Runtime.evaluate(document.readyState)|reselect=once|deadlineMs=8000'
  );
}

(async () => {
  await staleFirstReadySecond();
  await allUnresponsiveStopsBeforeInput();
  console.log('ok - responsive workbench selection is bounded before input');
})().catch(error => { console.error(error); process.exitCode = 1; });
