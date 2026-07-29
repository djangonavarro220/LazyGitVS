const assert = require('assert');
const { settleFocusRequest } = require('../out/focusRequest');

function fakeTimers() {
  const timers = [];
  return {
    set(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clear(timer) { timer.cleared = true; },
    timers
  };
}

(async () => {
  const pendingTimers = fakeTimers();
  let resolvePending;
  const pending = new Promise(resolve => { resolvePending = resolve; });
  const pendingSettled = settleFocusRequest(pending, 250, pendingTimers.set, pendingTimers.clear);
  assert.strictEqual(pendingTimers.timers.length, 1);
  assert.strictEqual(pendingTimers.timers[0].delay, 250);
  pendingTimers.timers[0].callback();
  await pendingSettled;
  assert.strictEqual(pendingTimers.timers[0].cleared, true);
  resolvePending();

  const resolvedTimers = fakeTimers();
  await settleFocusRequest(Promise.resolve(), 250, resolvedTimers.set, resolvedTimers.clear);
  assert.strictEqual(resolvedTimers.timers[0].cleared, true);

  const rejectedTimers = fakeTimers();
  await settleFocusRequest(Promise.reject(new Error('focus failed')), 250, rejectedTimers.set, rejectedTimers.clear);
  assert.strictEqual(rejectedTimers.timers[0].cleared, true);
})();
