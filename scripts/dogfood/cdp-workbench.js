const WORKBENCH_PAGE = /Visual Studio Code|Extension Development Host/i;
const READY_STATES = new Set(['loading', 'interactive', 'complete']);
const DEFAULT_DEADLINE_MS = 8000;
const PROBE_CAP_MS = 2000;
const TARGET_POLL_BACKOFF_MS = 25;
const STOP_FINGERPRINT = 'cdp-root-dom-unreachable|stage=pre-input|operation=Runtime.evaluate(document.readyState)|reselect=once|deadlineMs=8000';

class CdpRootDomUnreachableError extends Error {
  constructor({ targets, attemptedTargetIds, timeoutMs }) {
    super(STOP_FINGERPRINT);
    this.name = 'CdpRootDomUnreachableError';
    this.classification = 'cdp-root-dom-unreachable';
    this.fingerprint = STOP_FINGERPRINT;
    this.stage = 'pre-input';
    this.operation = 'Runtime.evaluate(document.readyState)';
    this.reselect = 'once';
    this.deadlineMs = timeoutMs;
    this.timeoutMs = timeoutMs;
    this.probeTimeoutMs = PROBE_CAP_MS;
    this.targets = targets;
    this.attemptedTargetIds = attemptedTargetIds;
  }
}

function eligiblePages(targets) {
  return targets.filter(target => target?.type === 'page').sort((a, b) => Number(WORKBENCH_PAGE.test(b.title || '')) - Number(WORKBENCH_PAGE.test(a.title || '')));
}

function targetKey(target) {
  return target.id || target.webSocketDebuggerUrl;
}

function within(ms, operation) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CDP root readiness probe timed out')), ms); })
  ]).finally(() => clearTimeout(timer));
}

async function connectResponsiveWorkbench({ listTargets, connect, timeoutMs = DEFAULT_DEADLINE_MS, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const started = now();
  const attemptedTargetIds = [];
  const observed = [];
  const seen = new Set();
  while (now() - started < timeoutMs) {
    const targets = eligiblePages(await listTargets());
    for (const target of targets) {
      const key = targetKey(target);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      observed.push({ id: target.id, url: target.webSocketDebuggerUrl });
      const remaining = timeoutMs - (now() - started);
      if (remaining <= 0) break;
      attemptedTargetIds.push(target.id);
      let client;
      try {
        client = await connect(target);
        const result = await within(Math.min(PROBE_CAP_MS, remaining), client.Runtime.evaluate({ expression: 'document.readyState', returnByValue: true }));
        if (READY_STATES.has(result?.result?.value)) return { client, target };
      } catch { /* Try the next eligible page without attributing product state. */ }
      if (client?.close) Promise.resolve(client.close()).catch(() => undefined);
    }
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(TARGET_POLL_BACKOFF_MS, remaining));
  }
  throw new CdpRootDomUnreachableError({ targets: observed, attemptedTargetIds, timeoutMs });
}

module.exports = { connectResponsiveWorkbench, CdpRootDomUnreachableError };
