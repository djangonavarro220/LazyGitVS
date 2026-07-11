const assert = require('assert');
const cp = require('child_process');

const originalExecFile = cp.execFile;
let invocation;
cp.execFile = (file, args, options, callback) => {
  invocation = { file, args, options };
  const entries = Array.from({ length: 10_000 }, (_, index) => `${String(index).padStart(40, '0')}\0commit: scale-${index}\0`).join('');
  callback(null, entries, '');
};

const { findReflogAction, readReflog, REFLOG_ENTRY_LIMIT } = require('../out/undoRedo');

(async () => {
  try {
    const started = process.hrtime.bigint();
    const entries = await readReflog('/tmp');
    const action = findReflogAction(entries, 'undo');
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.strictEqual(REFLOG_ENTRY_LIMIT, 10_000);
    assert.strictEqual(entries.length, REFLOG_ENTRY_LIMIT);
    assert.strictEqual(invocation.file, 'git');
    assert(invocation.args.includes(`--max-count=${REFLOG_ENTRY_LIMIT}`), 'git must bound the reflog before buffering it');
    assert.strictEqual(invocation.options.maxBuffer, 4 * 1024 * 1024);
    assert(action, 'the newest valid action must still be found at scale');
    assert(elapsedMs < 250, `10k-entry read and parse took ${elapsedMs.toFixed(1)}ms`);
    console.log(`undoRedoPerformance tests passed (${elapsedMs.toFixed(1)}ms for ${entries.length} entries)`);
  } finally {
    cp.execFile = originalExecFile;
  }
})().catch(error => {
  cp.execFile = originalExecFile;
  console.error(error);
  process.exitCode = 1;
});