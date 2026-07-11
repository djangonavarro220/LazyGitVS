#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const ledgerPath = path.resolve(process.argv[2] || path.join(repositoryRoot, 'docs', 'lazygit-parity-ledger.json'));
const claimsDir = path.resolve(process.argv[3] || path.join(repositoryRoot, 'docs'));
const upstreamRoot = process.env.LGVS_UPSTREAM_REPO && path.resolve(process.env.LGVS_UPSTREAM_REPO);
const errors = [];
let ledger;
try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); }
catch (error) { console.error(`Invalid parity ledger: ${error.message}`); process.exit(1); }

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const isHash = value => /^[0-9a-f]{40}$/.test(value || '');
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function commitExists(repo, commit, label) {
  const result = git(repo, ['cat-file', '-e', `${commit}^{commit}`]);
  if (result.status !== 0) errors.push(`${label} does not exist as a commit: ${commit}`);
  return result.status === 0;
}
function validRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
}
function verifyEvidence(repo, commit, evidence, label, requiredCommit) {
  if (!Array.isArray(evidence) || evidence.length === 0) { errors.push(`${label}: evidence is required`); return; }
  evidence.forEach((entry, index) => {
    const item = `${label} evidence ${index + 1}`;
    if (!entry || typeof entry !== 'object' || !validRelativePath(entry.path)) { errors.push(`${item}: invalid repository-relative path`); return; }
    if (requiredCommit && entry.commit !== requiredCommit) errors.push(`${item}: evidence commit must equal lgvsCommit ${requiredCommit}`);
    if (!Number.isInteger(entry.startLine) || !Number.isInteger(entry.endLine) || entry.startLine < 1 || entry.endLine < entry.startLine) {
      errors.push(`${item}: invalid inclusive line range`); return;
    }
    if (!Array.isArray(entry.tokens) || entry.tokens.length === 0 || entry.tokens.some(token => typeof token !== 'string' || !token)) {
      errors.push(`${item}: non-empty expected evidence tokens are required`); return;
    }
    const object = git(repo, ['show', `${commit}:${entry.path}`]);
    if (object.status !== 0) { errors.push(`${item}: path does not exist at ${commit}: ${entry.path}`); return; }
    const lines = object.stdout.split(/\r?\n/);
    if (entry.endLine > lines.length) { errors.push(`${item}: impossible range ${entry.startLine}-${entry.endLine}; ${entry.path} has ${lines.length} lines`); return; }
    const range = lines.slice(entry.startLine - 1, entry.endLine).join('\n');
    for (const token of entry.tokens) if (!range.includes(token)) errors.push(`${item}: range is missing expected token ${JSON.stringify(token)}`);
  });
}

if (!ledger.upstream || !isHash(ledger.upstream.commit)) errors.push('upstream.commit must be a full immutable Git commit');
if (ledger.upstream?.repository !== 'https://github.com/jesseduffield/lazygit') errors.push('upstream.repository must identify jesseduffield/lazygit');
if (!/^[0-9a-f]{64}$/.test(ledger.upstream?.archiveSha256 || '')) errors.push('upstream.archiveSha256 must be an immutable SHA-256');
if (!upstreamRoot) errors.push('LGVS_UPSTREAM_REPO must point to the pinned local upstream checkout');
else if (!fs.existsSync(upstreamRoot)) errors.push(`LGVS_UPSTREAM_REPO does not exist: ${upstreamRoot}`);
else if (isHash(ledger.upstream?.commit)) {
  const remote = git(upstreamRoot, ['config', '--get', 'remote.origin.url']);
  if (remote.status !== 0 || !/github\.com[/:]jesseduffield\/lazygit(?:\.git)?\s*$/.test(remote.stdout)) errors.push('LGVS_UPSTREAM_REPO is not the configured jesseduffield/lazygit repository');
  commitExists(upstreamRoot, ledger.upstream.commit, 'upstream.commit');
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
  if (!isHash(row.lgvsCommit)) errors.push(`${label}: lgvsCommit must be a full immutable Git commit`);
  else if (commitExists(repositoryRoot, row.lgvsCommit, `${label}: lgvsCommit`)) {
    if (git(repositoryRoot, ['merge-base', '--is-ancestor', row.lgvsCommit, 'HEAD']).status !== 0) errors.push(`${label}: lgvsCommit is not reachable from reviewed HEAD: ${row.lgvsCommit}`);
    verifyEvidence(repositoryRoot, row.lgvsCommit, row.lgvsEvidence, `${label}: LGVS`, row.lgvsCommit);
  }
  if (upstreamRoot && isHash(ledger.upstream?.commit)) verifyEvidence(upstreamRoot, ledger.upstream.commit, row.upstreamEvidence, `${label}: upstream`);
  if (!['exact', 'adapted', 'gap'].includes(row.parity)) errors.push(`${label}: invalid parity ${row.parity}`);
  if (row.parity === 'adapted' && (!row.vscodeException || typeof row.vscodeException.rationale !== 'string' || !row.vscodeException.rationale.trim())) errors.push(`${label}: adapted parity requires an explicit VS Code exception rationale`);
  const claimKey = `${row.surface}\u0000${row.key}`;
  const previous = claims.get(claimKey);
  if (previous) {
    const same = previous.upstreamBehavior === row.upstreamBehavior && previous.lgvsBehavior === row.lgvsBehavior && previous.parity === row.parity;
    errors.push(`${same ? 'duplicate' : 'contradictory'} rows for ${row.surface} ${row.key}: ${previous.id} and ${row.id}`);
  } else claims.set(claimKey, row);
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
function normalizedClaimLine(line) { return line.trim().replace(/^[-*]\s+/, ''); }
if (isIsoDate(ledger.reviewedAt) && fs.existsSync(claimsDir)) {
  const rowsById = new Map((ledger.rows || []).map(row => [row.id, row]));
  const seenMarkers = new Map();
  for (const file of markdownFiles(claimsDir)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/(?:re-audit(?:ed)?|auditado)/i.test(line)) for (const match of line.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
        if (!isIsoDate(match[0]) || match[0] < ledger.reviewedAt) errors.push(`stale audit claim in ${path.relative(process.cwd(), file)}:${index + 1}: ${match[0]} predates ${ledger.reviewedAt}`);
      }
      if (/Source:.*jesseduffield\/lazygit/i.test(line) && !line.includes(ledger.upstream.commit)) errors.push(`stale upstream provenance in ${path.relative(process.cwd(), file)}:${index + 1}`);
      const marker = line.match(/<!--\s*parity-claim:\s*(\{.*\})\s*-->/);
      if (!marker) return;
      try {
        const claim = JSON.parse(marker[1]);
        // Older unbound markers are historical annotations, not canonical repetitions.
        // Only records carrying their exact adjacent claim text participate in validation.
        if (typeof claim.claim !== 'string' || !claim.claim) return;
        const canonical = rowsById.get(claim.id);
        const location = `${path.relative(process.cwd(), file)}:${index + 1}`;
        if (seenMarkers.has(claim.id)) errors.push(`duplicate external parity claim for ${claim.id}: ${seenMarkers.get(claim.id)} and ${location}`);
        else seenMarkers.set(claim.id, location);
        if (!canonical || claim.parity !== canonical.parity || claim.reviewedAt !== canonical.reviewedAt) errors.push(`contradictory external claim in ${location}: ${claim.id || 'missing id'}`);
        let proseIndex = index + 1;
        while (proseIndex < lines.length && !lines[proseIndex].trim()) proseIndex += 1;
        if (proseIndex >= lines.length || normalizedClaimLine(lines[proseIndex]) !== claim.claim) errors.push(`marker/prose disagreement in ${location}: ${claim.id || 'missing id'}`);
      } catch (error) { errors.push(`invalid external parity claim in ${path.relative(process.cwd(), file)}:${index + 1}: ${error.message}`); }
    });
  }
}

if (errors.length) { for (const error of errors) console.error(`parity ledger: ${error}`); process.exit(1); }
console.log(`Parity ledger valid: ${ledger.rows.length} rows at ${ledger.upstream.commit.slice(0, 12)}.`);
