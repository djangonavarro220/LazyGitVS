const assert = require('assert');
const { PreviewRequestGate } = require('../out/previewRequestGate.js');

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

(async () => {
  const gate = new PreviewRequestGate();
  let published = '';
  async function preview(name, delay) {
    const request = gate.begin(name);
    await sleep(delay);
    if (!gate.isCurrent(request)) return;
    published = name;
  }

  await Promise.all([preview('slow-old', 30), preview('fast-current', 1)]);
  assert.strictEqual(published, 'fast-current', 'a stale Git response must never overwrite the currently selected commit preview');

  const first = gate.begin('first');
  const second = gate.begin('second');
  const duplicateSecond = gate.begin('second');
  assert.strictEqual(gate.isCurrent(first), false);
  assert.strictEqual(gate.isCurrent(second), true);
  assert.strictEqual(duplicateSecond, second, 'duplicate refreshes for the same selection must coalesce instead of starving publication');
  console.log('previewRequestGate tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
