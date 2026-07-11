#!/usr/bin/env node
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const ledgerPath = path.resolve(process.argv[2] || path.join(repositoryRoot, 'docs', 'lazygit-parity-ledger.json'));
const claimsDir = path.resolve(process.argv[3] || path.join(repositoryRoot, 'docs'));
const errors = [];
let ledger;
try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); }
catch (error) { console.error(`Invalid parity ledger: ${error.message}`); process.exit(1); }

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const isHash = value => /^[0-9a-f]{40}$/.test(value || '');
let upstreamRoot;
let temporaryUpstreamRoot;
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
    let contents;
    if (commit) {
      const object = git(repo, ['show', `${commit}:${entry.path}`]);
      if (object.status !== 0) { errors.push(`${item}: path does not exist at ${commit}: ${entry.path}`); return; }
      contents = object.stdout;
    } else {
      const evidencePath = path.resolve(repo, entry.path);
      if (!evidencePath.startsWith(`${repo}${path.sep}`) || !fs.existsSync(evidencePath)) { errors.push(`${item}: path does not exist in verified archive: ${entry.path}`); return; }
      contents = fs.readFileSync(evidencePath, 'utf8');
    }
    const lines = contents.split(/\r?\n/);
    if (entry.endLine > lines.length) { errors.push(`${item}: impossible range ${entry.startLine}-${entry.endLine}; ${entry.path} has ${lines.length} lines`); return; }
    const range = lines.slice(entry.startLine - 1, entry.endLine).join('\n');
    for (const token of entry.tokens) if (!range.includes(token)) errors.push(`${item}: range is missing expected token ${JSON.stringify(token)}`);
  });
}

function provisionUpstreamArchive() {
  if (!validRelativePath(ledger.upstream?.archive)) {
    errors.push('upstream.archive must be a portable repository-relative path');
    return;
  }
  const archivePath = path.resolve(repositoryRoot, ledger.upstream.archive);
  if (!archivePath.startsWith(`${repositoryRoot}${path.sep}`) || !fs.existsSync(archivePath)) {
    errors.push(`upstream archive does not exist: ${ledger.upstream.archive}`);
    return;
  }
  const archive = fs.readFileSync(archivePath);
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  if (digest !== ledger.upstream.archiveSha256) errors.push(`upstream archive SHA-256 mismatch: expected ${ledger.upstream.archiveSha256}, got ${digest}`);
  let tar;
  try { tar = zlib.gunzipSync(archive); }
  catch (error) { errors.push(`upstream archive is not valid gzip: ${error.message}`); return; }
  const embeddedCommit = spawnSync('git', ['get-tar-commit-id'], { input: tar, encoding: 'utf8', maxBuffer: tar.length + 1024 });
  if (embeddedCommit.status !== 0 || embeddedCommit.stdout.trim() !== ledger.upstream.commit) errors.push(`upstream archive commit mismatch: expected ${ledger.upstream.commit}, got ${embeddedCommit.stdout.trim() || 'none'}`);
  temporaryUpstreamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lgvs-upstream-'));
  const extracted = spawnSync('tar', ['-xzf', archivePath, '-C', temporaryUpstreamRoot, '--strip-components=1'], { encoding: 'utf8' });
  if (extracted.status !== 0) { errors.push(`cannot extract upstream archive: ${extracted.stderr.trim()}`); return; }
  git(temporaryUpstreamRoot, ['init', '-q']);
  git(temporaryUpstreamRoot, ['config', 'core.autocrlf', 'false']);
  const added = git(temporaryUpstreamRoot, ['add', '-A']);
  const tree = added.status === 0 ? git(temporaryUpstreamRoot, ['write-tree']) : added;
  if (tree.status !== 0 || tree.stdout.trim() !== ledger.upstream.tree) errors.push(`upstream archive tree mismatch: expected ${ledger.upstream.tree}, got ${tree.stdout.trim() || 'none'}`);
  upstreamRoot = temporaryUpstreamRoot;
}

if (!ledger.upstream || !isHash(ledger.upstream.commit)) errors.push('upstream.commit must be a full immutable Git commit');
if (ledger.upstream?.repository !== 'https://github.com/jesseduffield/lazygit') errors.push('upstream.repository must identify jesseduffield/lazygit');
if (!isHash(ledger.upstream?.tree)) errors.push('upstream.tree must be a full immutable Git tree');
if (!/^[0-9a-f]{64}$/.test(ledger.upstream?.archiveSha256 || '')) errors.push('upstream.archiveSha256 must be an immutable SHA-256');
if (isHash(ledger.upstream?.commit) && isHash(ledger.upstream?.tree) && /^[0-9a-f]{64}$/.test(ledger.upstream?.archiveSha256 || '')) provisionUpstreamArchive();
if (!isHash(ledger.reviewedLgvs?.commit) || !isHash(ledger.reviewedLgvs?.tree)) errors.push('reviewedLgvs commit and tree must be full immutable Git hashes');
else if (commitExists(repositoryRoot, ledger.reviewedLgvs.commit, 'reviewedLgvs.commit')) {
  const reviewedTree = git(repositoryRoot, ['rev-parse', `${ledger.reviewedLgvs.commit}^{tree}`]);
  if (reviewedTree.status !== 0 || reviewedTree.stdout.trim() !== ledger.reviewedLgvs.tree) errors.push('reviewedLgvs tree does not belong to reviewedLgvs commit');
  if (git(repositoryRoot, ['merge-base', '--is-ancestor', ledger.reviewedLgvs.commit, 'HEAD']).status !== 0) errors.push('reviewedLgvs commit is not reachable from HEAD');
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
    if (isHash(ledger.reviewedLgvs?.commit) && git(repositoryRoot, ['merge-base', '--is-ancestor', row.lgvsCommit, ledger.reviewedLgvs.commit]).status !== 0) errors.push(`${label}: lgvsCommit is not reachable from reviewed LGVS snapshot: ${row.lgvsCommit}`);
    verifyEvidence(repositoryRoot, row.lgvsCommit, row.lgvsEvidence, `${label}: LGVS`, row.lgvsCommit);
  }
  if (upstreamRoot && isHash(ledger.upstream?.commit)) verifyEvidence(upstreamRoot, null, row.upstreamEvidence, `${label}: upstream`);
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
        const canonical = rowsById.get(claim.id);
        const location = `${path.relative(process.cwd(), file)}:${index + 1}`;
        if (typeof claim.claim !== 'string' || !claim.claim) { errors.push(`legacy unbound parity claim in ${location}: ${claim.id || 'missing id'}`); return; }
        if (seenMarkers.has(claim.id)) errors.push(`duplicate external parity claim for ${claim.id}: ${seenMarkers.get(claim.id)} and ${location}`);
        else seenMarkers.set(claim.id, location);
        if (!canonical || claim.parity !== canonical.parity || claim.reviewedAt !== canonical.reviewedAt) errors.push(`contradictory external claim in ${location}: ${claim.id || 'missing id'}`);
        let proseIndex = index + 1;
        while (proseIndex < lines.length && !lines[proseIndex].trim()) proseIndex += 1;
        if (proseIndex >= lines.length || normalizedClaimLine(lines[proseIndex]) !== claim.claim) errors.push(`marker/prose disagreement in ${location}: ${claim.id || 'missing id'}`);
      } catch (error) { errors.push(`invalid external parity claim in ${path.relative(process.cwd(), file)}:${index + 1}: ${error.message}`); }
    });
  }
  for (const row of (ledger.rows || [])) if (!seenMarkers.has(row.id)) errors.push(`missing external parity claim for ${row.id}`);
}

if (temporaryUpstreamRoot) fs.rmSync(temporaryUpstreamRoot, { recursive: true, force: true });
if (errors.length) { for (const error of errors) console.error(`parity ledger: ${error}`); process.exit(1); }
console.log(`Parity ledger valid: ${ledger.rows.length} rows at ${ledger.upstream.commit.slice(0, 12)}.`);
