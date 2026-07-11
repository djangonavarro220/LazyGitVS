#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ledgerPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'lazygit-parity-ledger.json'));
const errors = [];
let ledger;
try {
  ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
} catch (error) {
  console.error(`Invalid parity ledger: ${error.message}`);
  process.exit(1);
}

if (!ledger.upstream || !/^[0-9a-f]{40}$/.test(ledger.upstream.commit || '')) errors.push('upstream.commit must be a full immutable Git commit');
if (!/^\d{4}-\d{2}-\d{2}$/.test(ledger.reviewedAt || '')) errors.push('reviewedAt must be an ISO date');
if (!Array.isArray(ledger.rows) || ledger.rows.length === 0) errors.push('rows must be a non-empty array');

const ids = new Set();
const claims = new Map();
for (const [index, row] of (ledger.rows || []).entries()) {
  const label = row.id || `row ${index}`;
  for (const field of ['id', 'surface', 'key', 'upstreamBehavior', 'lgvsBehavior', 'parity', 'sourceCommit', 'reviewedAt']) {
    if (typeof row[field] !== 'string' || !row[field].trim()) errors.push(`${label}: missing ${field}`);
  }
  if (ids.has(row.id)) errors.push(`duplicate row id: ${row.id}`);
  ids.add(row.id);
  if (row.sourceCommit !== ledger.upstream?.commit || row.reviewedAt !== ledger.reviewedAt) errors.push(`${label}: stale row; sourceCommit/reviewedAt must match the ledger audit`);
  if (!['exact', 'adapted', 'gap'].includes(row.parity)) errors.push(`${label}: invalid parity ${row.parity}`);
  if (!Array.isArray(row.evidence) || row.evidence.length === 0) errors.push(`${label}: evidence is required`);
  for (const evidence of row.evidence || []) {
    if (typeof evidence !== 'string' || !evidence.includes(ledger.upstream?.commit || '__missing__')) errors.push(`${label}: evidence must be pinned to upstream.commit`);
    if (/\/blob\/(master|main)\//.test(evidence)) errors.push(`${label}: stale mutable evidence URL`);
  }
  const claimKey = `${row.surface}\u0000${row.key}`;
  const previous = claims.get(claimKey);
  if (previous && (previous.upstreamBehavior !== row.upstreamBehavior || previous.parity !== row.parity)) {
    errors.push(`contradictory rows for ${row.surface} ${row.key}: ${previous.id} and ${row.id}`);
  } else if (!previous) {
    claims.set(claimKey, row);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`parity ledger: ${error}`);
  process.exit(1);
}
console.log(`Parity ledger valid: ${ledger.rows.length} rows at ${ledger.upstream.commit.slice(0, 12)}.`);
