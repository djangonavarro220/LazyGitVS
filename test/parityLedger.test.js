const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const ledgerPath = path.join(root, 'docs', 'lazygit-parity-ledger.json');
const validatorPath = path.join(root, 'scripts', 'validate-parity-ledger.js');

function run(file = ledgerPath) {
  return spawnSync(process.execPath, [validatorPath, file], { cwd: root, encoding: 'utf8' });
}

function mutatedLedger(mutate) {
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  mutate(ledger);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-parity-ledger-'));
  const file = path.join(dir, 'ledger.json');
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
  return file;
}

assert.strictEqual(run().status, 0, run().stderr);

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
assert.match(ledger.upstream.commit, /^[0-9a-f]{40}$/);
assert(ledger.rows.some(row => row.id === 'branches.enter' && row.upstreamBehavior === 'View commits'));
assert(ledger.rows.some(row => row.id === 'commits.C' && row.upstreamBehavior === 'Copy (cherry-pick)'));

const stale = run(mutatedLedger(value => { value.rows[0].sourceCommit = '0'.repeat(40); }));
assert.notStrictEqual(stale.status, 0);
assert.match(stale.stderr, /stale/i);

const duplicate = run(mutatedLedger(value => { value.rows.push({ ...value.rows[0] }); }));
assert.notStrictEqual(duplicate.status, 0);
assert.match(duplicate.stderr, /duplicate/i);

const contradictory = run(mutatedLedger(value => {
  value.rows.push({ ...value.rows[0], id: 'branches.enter.conflict', upstreamBehavior: 'Checkout' });
}));
assert.notStrictEqual(contradictory.status, 0);
assert.match(contradictory.stderr, /contradict/i);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.strictEqual(pkg.scripts['check:parity-ledger'], 'node scripts/validate-parity-ledger.js');
const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
assert.match(ci, /npm run check:parity-ledger/);

console.log('parity ledger tests passed');
