const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const ledgerPath = path.join(root, 'docs', 'lazygit-parity-ledger.json');
const validatorPath = path.join(root, 'scripts', 'validate-parity-ledger.js');

function run(file = ledgerPath, docsDir) {
  const args = [validatorPath, file];
  if (docsDir) args.push(docsDir);
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
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
assert(ledger.rows.every(row => /^[0-9a-f]{40}$/.test(row.upstreamCommit)));
assert(ledger.rows.every(row => /^[0-9a-f]{40}$/.test(row.lgvsCommit)));
assert(ledger.rows.filter(row => row.parity === 'adapted').every(row => row.vscodeException?.rationale));

const stale = run(mutatedLedger(value => { value.rows[0].upstreamCommit = '0'.repeat(40); }));
assert.notStrictEqual(stale.status, 0);
assert.match(stale.stderr, /stale/i);

const duplicate = run(mutatedLedger(value => { value.rows.push({ ...value.rows[0] }); }));
assert.notStrictEqual(duplicate.status, 0);
assert.match(duplicate.stderr, /duplicate/i);

const semanticDuplicate = run(mutatedLedger(value => {
  value.rows.push({ ...value.rows[0], id: 'branches.enter.duplicate' });
}));
assert.notStrictEqual(semanticDuplicate.status, 0);
assert.match(semanticDuplicate.stderr, /duplicate/i);

const contradictory = run(mutatedLedger(value => {
  value.rows.push({ ...value.rows[0], id: 'branches.enter.conflict', upstreamBehavior: 'Checkout' });
}));
assert.notStrictEqual(contradictory.status, 0);
assert.match(contradictory.stderr, /contradict/i);

const invalidDate = run(mutatedLedger(value => { value.reviewedAt = '2026-02-31'; }));
assert.notStrictEqual(invalidDate.status, 0);
assert.match(invalidDate.stderr, /ISO date/i);

const missingLgvsCommit = run(mutatedLedger(value => { delete value.rows[0].lgvsCommit; }));
assert.notStrictEqual(missingLgvsCommit.status, 0);
assert.match(missingLgvsCommit.stderr, /lgvsCommit/i);

const nonexistentLgvsCommit = run(mutatedLedger(value => { value.rows[0].lgvsCommit = 'f'.repeat(40); }));
assert.notStrictEqual(nonexistentLgvsCommit.status, 0);
assert.match(nonexistentLgvsCommit.stderr, /does not exist/i);

const missingException = run(mutatedLedger(value => { delete value.rows.find(row => row.parity === 'adapted').vscodeException; }));
assert.notStrictEqual(missingException.status, 0);
assert.match(missingException.stderr, /VS Code exception/i);

const claimsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-parity-claims-'));
fs.writeFileSync(path.join(claimsDir, 'stale.md'), 'Branches Enter was re-audited on 2026-06-24.\n');
const staleExternalClaim = run(ledgerPath, claimsDir);
assert.notStrictEqual(staleExternalClaim.status, 0);
assert.match(staleExternalClaim.stderr, /stale audit claim/i);

fs.rmSync(path.join(claimsDir, 'stale.md'));
const nestedClaimsDir = path.join(claimsDir, 'nested');
fs.mkdirSync(nestedClaimsDir);
fs.writeFileSync(path.join(nestedClaimsDir, 'claim.md'), 'Commit Enter was re-audited on 2026-06-24.\n');
const nestedStaleClaim = run(ledgerPath, claimsDir);
assert.notStrictEqual(nestedStaleClaim.status, 0);
assert.match(nestedStaleClaim.stderr, /stale audit claim/i);

fs.rmSync(nestedClaimsDir, { recursive: true });
fs.writeFileSync(path.join(claimsDir, 'claim.md'), 'Commit C has exact parity with upstream.\n');
const contradictoryProse = run(ledgerPath, claimsDir);
assert.notStrictEqual(contradictoryProse.status, 0);
assert.match(contradictoryProse.stderr, /contradictory canonical parity prose/i);

fs.writeFileSync(path.join(claimsDir, 'claim.md'), '<!-- parity-claim: {"id":"commits.C","parity":"exact","reviewedAt":"2026-07-11"} -->\n');
const contradictoryExternalClaim = run(ledgerPath, claimsDir);
assert.notStrictEqual(contradictoryExternalClaim.status, 0);
assert.match(contradictoryExternalClaim.stderr, /contradictory external claim/i);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.strictEqual(pkg.scripts['check:parity-ledger'], 'node scripts/validate-parity-ledger.js');
const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
assert.match(ci, /npm run check:parity-ledger/);

console.log('parity ledger tests passed');
