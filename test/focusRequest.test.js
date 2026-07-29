const assert = require('assert');
const { detachFocusRequest, settleFocusRequest, FocusRequestStateMachine } = require('../out/focusRequest');

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
  let resolveDetached;
  const detached = new Promise(resolve => { resolveDetached = resolve; });
  assert.strictEqual(detachFocusRequest(detached), undefined, 'detached focus must return before an unresolved operation');
  resolveDetached();

  const unhandledRejections = [];
  const onUnhandledRejection = reason => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);
  detachFocusRequest(Promise.reject(new Error('detached focus failed')));
  await new Promise(resolve => setImmediate(resolve));
  process.off('unhandledRejection', onUnhandledRejection);
  assert.deepStrictEqual(unhandledRejections, [], 'detached focus must consume async rejection');

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

  const requests = new FocusRequestStateMachine();
  const first = requests.begin('files');
  const firstRender = requests.rendered('files');
  assert.strictEqual(requests.ready('files', firstRender), first, 'the matching rendered generation may dispatch a pending request');
  assert.strictEqual(requests.acknowledge('files', firstRender, first.request), first, 'only the matching physical panel focus completes the request');
  assert.strictEqual(requests.pending(), undefined);

  const stale = requests.begin('files');
  const staleRender = requests.rendered('files');
  const current = requests.begin('files');
  const currentRender = requests.rendered('files');
  assert.strictEqual(requests.ready('files', staleRender), undefined, 'stale ready generations cannot dispatch a newer request');
  assert.strictEqual(requests.acknowledge('files', staleRender, stale.request), undefined, 'stale focus acknowledgements cannot complete a newer request');
  assert.strictEqual(requests.ready('files', currentRender), current);
  assert.strictEqual(requests.acknowledge('files', currentRender, stale.request), undefined, 'an acknowledgement for an older request cannot complete the current request');
  assert.strictEqual(requests.acknowledge('files', currentRender, current.request), current);

  const branches = requests.begin('branches', 'files');
  const filesRender = requests.rendered('files');
  assert.strictEqual(requests.ready('files', filesRender), undefined, 'a ready event from another panel cannot dispatch the pending transition');
  const branchesRender = requests.rendered('branches');
  assert.strictEqual(requests.ready('branches', branchesRender), branches);
  assert.strictEqual(requests.ready('branches', branchesRender), undefined, 'duplicate ready events cannot dispatch focusBody twice');
  assert.strictEqual(requests.acknowledge('branches', branchesRender, branches.request), branches);
})();
