#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ledgerPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'lazygit-parity-ledger.json'));
const claimsDir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'docs'));
const repositoryRoot = path.resolve(__dirname, '..');
const errors = [];
let ledger;
try {
  ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
} catch (error) {
  console.error(`Invalid parity ledger: ${error.message}`);
  process.exit(1);
}

if (!ledger.upstream || !/^[0-9a-f]{40}$/.test(ledger.upstream.commit || '')) errors.push('upstream.commit must be a full immutable Git commit');
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

if (!isIsoDate(ledger.reviewedAt)) errors.push('reviewedAt must be a valid ISO date');
if (!Array.isArray(ledger.rows) || ledger.rows.length === 0) errors.push('rows must be a non-empty array');

const ids = new Set();
const claims = new Map();
for (const [index, row] of (ledger.rows || []).entries()) {
  const label = row.id || `row ${index}`;
  for (const field of ['id', 'surface', 'key', 'upstreamBehavior', 'lgvsBehavior', 'parity', 'upstreamCommit', 'lgvsCommit', 'reviewedAt']) {
    if (typeof row[field] !== 'string' || !row[field].trim()) errors.push(`${label}: missing ${field}`);
  }
  if (ids.has(row.id)) errors.push(`duplicate row id: ${row.id}`);
  ids.add(row.id);
  if (row.upstreamCommit !== ledger.upstream?.commit || row.reviewedAt !== ledger.reviewedAt) errors.push(`${label}: stale row; upstreamCommit/reviewedAt must match the ledger audit`);
  if (!/^[0-9a-f]{40}$/.test(row.lgvsCommit || '')) errors.push(`${label}: lgvsCommit must be a full immutable Git commit`);
  else {
    const exists = spawnSync('git', ['cat-file', '-e', `${row.lgvsCommit}^{commit}`], { cwd: repositoryRoot });
    if (exists.status !== 0) errors.push(`${label}: lgvsCommit does not exist: ${row.lgvsCommit}`);
    else {
      const reachable = spawnSync('git', ['merge-base', '--is-ancestor', row.lgvsCommit, 'HEAD'], { cwd: repositoryRoot });
      if (reachable.status !== 0) errors.push(`${label}: lgvsCommit is not reachable from reviewed HEAD: ${row.lgvsCommit}`);
    }
  }
  if (!['exact', 'adapted', 'gap'].includes(row.parity)) errors.push(`${label}: invalid parity ${row.parity}`);
  if (row.parity === 'adapted' && (!row.vscodeException || typeof row.vscodeException.rationale !== 'string' || !row.vscodeException.rationale.trim())) {
    errors.push(`${label}: adapted parity requires an explicit VS Code exception rationale`);
  }
  if (!Array.isArray(row.evidence) || row.evidence.length === 0) errors.push(`${label}: evidence is required`);
  for (const evidence of row.evidence || []) {
    if (typeof evidence !== 'string' || !evidence.includes(ledger.upstream?.commit || '__missing__')) errors.push(`${label}: evidence must be pinned to upstream.commit`);
    if (/\/blob\/(master|main)\//.test(evidence)) errors.push(`${label}: stale mutable evidence URL`);
  }
  const claimKey = `${row.surface}\u0000${row.key}`;
  const previous = claims.get(claimKey);
  if (previous) {
    const sameClaim = previous.upstreamBehavior === row.upstreamBehavior && previous.lgvsBehavior === row.lgvsBehavior && previous.parity === row.parity;
    errors.push(`${sameClaim ? 'duplicate' : 'contradictory'} rows for ${row.surface} ${row.key}: ${previous.id} and ${row.id}`);
  } else {
    claims.set(claimKey, row);
  }
}

function markdownFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(entryPath);
  }
  return files;
}

function proseParity(line) {
  if (/\bexact parity with upstream\b/i.test(line) || (/\bmatches upstream\b/i.test(line) && !/\b(?:but|except|gap|difference)\b/i.test(line))) return 'exact';
  if (/\b(?:canonical|explicit|parity) gap\b/i.test(line)) return 'gap';
  if (/\b(?:adapted parity|VS Code-native (?:difference|exception))\b/i.test(line)) return 'adapted';
  return undefined;
}

function mentionsRow(line, row) {
  const normalized = line.toLowerCase();
  const surface = row.surface.toLowerCase().replace(/local /, '');
  const key = row.key.replace(/[<>]/g, '').toLowerCase();
  const surfaceMentioned = normalized.includes(surface) || (surface.endsWith('s') && normalized.includes(surface.slice(0, -1)));
  const keyMentioned = key.length === 1 ? line.includes(`\`${row.key}\``) || new RegExp(`\\b${key}\\b`, 'i').test(line) : normalized.includes(key);
  return surfaceMentioned && keyMentioned;
}

if (isIsoDate(ledger.reviewedAt) && fs.existsSync(claimsDir)) {
  const rowsById = new Map((ledger.rows || []).map(row => [row.id, row]));
  for (const file of markdownFiles(claimsDir)) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (/(?:re-audit(?:ed)?|auditado)/i.test(line)) {
        for (const match of line.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
          if (!isIsoDate(match[0]) || match[0] < ledger.reviewedAt) errors.push(`stale audit claim in ${path.relative(process.cwd(), file)}:${index + 1}: ${match[0]} predates ${ledger.reviewedAt}`);
        }
      }
      const marker = line.match(/<!--\s*parity-claim:\s*(\{.*\})\s*-->/);
      if (!marker) {
        const parity = proseParity(line);
        if (parity) {
          for (const row of rowsById.values()) {
            if (mentionsRow(line, row) && parity !== row.parity) {
              errors.push(`contradictory canonical parity prose in ${path.relative(process.cwd(), file)}:${index + 1}: ${row.id} is ${row.parity}, not ${parity}`);
            }
          }
        }
        return;
      }
      try {
        const claim = JSON.parse(marker[1]);
        const canonical = rowsById.get(claim.id);
        if (!canonical || claim.parity !== canonical.parity || claim.reviewedAt !== canonical.reviewedAt) {
          errors.push(`contradictory external claim in ${path.relative(process.cwd(), file)}:${index + 1}: ${claim.id || 'missing id'}`);
        }
      } catch (error) {
        errors.push(`invalid external parity claim in ${path.relative(process.cwd(), file)}:${index + 1}: ${error.message}`);
      }
    });
  }
}

if (errors.length) {
  for (const error of errors) console.error(`parity ledger: ${error}`);
  process.exit(1);
}
console.log(`Parity ledger valid: ${ledger.rows.length} rows at ${ledger.upstream.commit.slice(0, 12)}.`);
