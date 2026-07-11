const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCHEMA_VERSION = 1;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function executableIdentity(file) {
  const realpath = fs.realpathSync(file);
  const stat = fs.statSync(realpath);
  if (!stat.isFile()) throw new Error(`Executable is not a file: ${file}`);
  return {
    realpath,
    sha256: hashFile(realpath),
    stat: { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mode: stat.mode, mtimeNs: stat.mtimeNs === undefined ? String(Math.round(stat.mtimeMs * 1e6)) : String(stat.mtimeNs) }
  };
}

function captureProvenance({ repoRoot, extensionVersion, nodeExecutable, vscodeExecutable }) {
  const cwd = fs.realpathSync(repoRoot);
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const head = git(['rev-parse', 'HEAD']);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  if (!/^[0-9a-f]{40}$/.test(head) || !/^[0-9a-f]{40}$/.test(tree)) throw new Error('Git provenance is invalid');
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Telemetry provenance requires a clean worktree');
  if (typeof extensionVersion !== 'string' || !extensionVersion) throw new Error('Extension version is required');
  const provenance = {
    schemaVersion: SCHEMA_VERSION,
    head,
    tree,
    extensionVersion,
    platform: process.platform,
    arch: process.arch,
    node: executableIdentity(nodeExecutable),
    vscode: executableIdentity(vscodeExecutable)
  };
  return Object.freeze({ ...provenance, digest: digest(provenance) });
}

function rejectSymlinkComponents(candidate, stopAt) {
  let current = path.resolve(candidate);
  const stop = path.resolve(stopAt || path.parse(current).root);
  while (current !== stop) {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error(`Symlink path component is not allowed: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function canonicalExistingDirectory(directory) {
  const resolved = path.resolve(directory);
  rejectSymlinkComponents(resolved);
  const real = fs.realpathSync(resolved);
  if (!fs.statSync(real).isDirectory()) throw new Error(`Not a directory: ${directory}`);
  return real;
}

function assertOwnedPath(runRoot, candidate, expectedParent) {
  const root = canonicalExistingDirectory(runRoot);
  const parent = canonicalExistingDirectory(expectedParent);
  const resolved = path.resolve(candidate);
  const relativeParent = path.relative(parent, resolved);
  const relativeRoot = path.relative(root, resolved);
  if (!relativeParent || relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent)) throw new Error('Path is not a child of its designated parent');
  if (!relativeRoot || relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)) throw new Error('Path escapes the run root');
  rejectSymlinkComponents(resolved, parent);
  const existing = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) throw new Error('Owned path must not be a symlink');
  return resolved;
}

function makeRunPaths(runRoot) {
  return {
    runRoot,
    childrenDir: path.join(runRoot, 'children'),
    aggregateResult: path.join(runRoot, 'result.json'),
    screenshotsDir: path.join(runRoot, 'screenshots'),
    tempDir: path.join(runRoot, 'tmp'),
    ownershipDir: path.join(runRoot, 'ownership')
  };
}

function createRunEnvelope({ outputPath, repoRoot, runId, lane, provenance }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId || '')) throw new Error('Invalid runId');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(lane || '')) throw new Error('Invalid lane');
  const outputParent = canonicalExistingDirectory(path.dirname(path.resolve(outputPath)));
  rejectSymlinkComponents(outputParent);
  const runsDir = path.join(outputParent, 'runs');
  try { fs.mkdirSync(runsDir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  rejectSymlinkComponents(runsDir, outputParent);
  const runRoot = path.join(fs.realpathSync(runsDir), runId);
  fs.mkdirSync(runRoot, { mode: 0o700 });
  const paths = makeRunPaths(runRoot);
  for (const directory of [paths.childrenDir, paths.screenshotsDir, paths.tempDir, paths.ownershipDir]) fs.mkdirSync(directory, { mode: 0o700 });
  const body = {
    schemaVersion: SCHEMA_VERSION,
    contract: 'lgvs-telemetry-run-envelope',
    runId,
    lane,
    repoRoot: fs.realpathSync(repoRoot),
    createdAt: new Date().toISOString(),
    ...(provenance === undefined ? {} : { provenance }),
    paths
  };
  const envelope = { ...body, digest: digest(body) };
  const envelopePath = path.join(runRoot, 'envelope.json');
  publishJsonOnce(envelopePath, envelope, { runRoot });
  fs.chmodSync(envelopePath, 0o400);
  return Object.freeze({ ...envelope, envelopePath });
}

function readRunEnvelope(envelopePath, expectedDigest) {
  const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
  const body = { ...envelope };
  delete body.digest;
  if (envelope.schemaVersion !== SCHEMA_VERSION || envelope.contract !== 'lgvs-telemetry-run-envelope' || digest(body) !== envelope.digest) throw new Error('Telemetry run envelope is invalid');
  if (expectedDigest && envelope.digest !== expectedDigest) throw new Error('Telemetry run envelope digest does not match');
  if (path.resolve(envelopePath) !== path.join(envelope.paths.runRoot, 'envelope.json')) throw new Error('Telemetry run envelope path is invalid');
  return Object.freeze({ ...envelope, envelopePath: path.resolve(envelopePath) });
}

function publishJsonOnce(finalPath, value, { runRoot }) {
  const parent = path.dirname(path.resolve(finalPath));
  const final = assertOwnedPath(runRoot, finalPath, parent);
  const temporary = path.join(parent, `.${path.basename(final)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.linkSync(temporary, final);
    const directoryFd = fs.openSync(parent, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    fs.unlinkSync(temporary);
    const finalDirectoryFd = fs.openSync(parent, 'r');
    try { fs.fsyncSync(finalDirectoryFd); } finally { fs.closeSync(finalDirectoryFd); }
    return final;
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function parseProcessStat(text) {
  const close = text.lastIndexOf(')');
  if (close < 0) throw new Error('Malformed process stat');
  const fields = text.slice(close + 2).split(' ');
  return { ppid: Number(fields[1]), processGroup: Number(fields[2]), session: Number(fields[3]), startTicks: fields[19] };
}

function readProcessIdentity(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) throw new Error('Invalid pid');
  const numericPid = Number(pid);
  const parsed = parseProcessStat(fs.readFileSync(`/proc/${numericPid}/stat`, 'utf8'));
  return { pid: numericPid, ...parsed, executable: fs.realpathSync(`/proc/${numericPid}/exe`) };
}

function sameProcess(left, right) {
  return left.pid === right.pid && left.startTicks === right.startTicks && left.executable === right.executable && left.processGroup === right.processGroup && left.session === right.session;
}

function assertOwnedDescendant(rootIdentity, candidateIdentity) {
  const liveRoot = readProcessIdentity(rootIdentity.pid);
  if (!sameProcess(liveRoot, rootIdentity)) throw new Error('Root process identity changed or exited');
  let current = readProcessIdentity(candidateIdentity.pid);
  if (!sameProcess(current, candidateIdentity)) throw new Error('Candidate process identity changed or exited');
  const visited = new Set();
  while (true) {
    if (sameProcess(current, rootIdentity)) return true;
    if (visited.has(current.pid) || current.ppid <= 0) break;
    visited.add(current.pid);
    current = readProcessIdentity(current.ppid);
  }
  throw new Error('Candidate is not an owned descendant');
}

function listenerPid(port) {
  const wanted = Number(port).toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text;
    try { text = fs.readFileSync(table, 'utf8'); } catch { continue; }
    for (const line of text.trim().split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      const [address, hexPort] = fields[1].split(':');
      if (hexPort === wanted && fields[3] === '0A' && (/^(0100007F|00000000000000000000000001000000)$/.test(address))) inodes.add(fields[9]);
    }
  }
  for (const entry of fs.readdirSync('/proc').filter(item => /^\d+$/.test(item))) {
    let fds;
    try { fds = fs.readdirSync(`/proc/${entry}/fd`); } catch { continue; }
    for (const fd of fds) {
      try {
        const match = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${entry}/fd/${fd}`));
        if (match && inodes.has(match[1])) return Number(entry);
      } catch {}
    }
  }
  throw new Error('Could not identify the loopback CDP listener');
}

function discoverOwnedCdp({ userDataDir, rootProcessIdentity }) {
  const directory = canonicalExistingDirectory(userDataDir);
  const activePortPath = path.join(directory, 'DevToolsActivePort');
  rejectSymlinkComponents(activePortPath, directory);
  const lines = fs.readFileSync(activePortPath, 'utf8').trim().split(/\r?\n/);
  if (!/^\d+$/.test(lines[0] || '')) throw new Error('Malformed DevToolsActivePort');
  const port = Number(lines[0]);
  if (port < 1 || port > 65535) throw new Error('Invalid DevToolsActivePort port');
  const listenerIdentity = readProcessIdentity(listenerPid(port));
  assertOwnedDescendant(rootProcessIdentity, listenerIdentity);
  return { port, browserPath: lines[1] || '', rootProcessIdentity, listenerIdentity };
}

function terminateOwnedProcessGroup(rootIdentity, signal = 'SIGTERM', kill = process.kill) {
  const live = readProcessIdentity(rootIdentity.pid);
  if (!sameProcess(live, rootIdentity)) throw new Error('Refusing cleanup because process identity changed');
  if (live.processGroup !== rootIdentity.pid) throw new Error('Refusing cleanup of a foreign process group');
  kill(-rootIdentity.processGroup, signal);
}

function validateEnvelopeBinding({ envelope, report, reportPath, stat, expectedLane }) {
  const errors = [];
  const body = { ...envelope };
  delete body.digest;
  delete body.envelopePath;
  if (envelope?.schemaVersion !== SCHEMA_VERSION || envelope?.contract !== 'lgvs-telemetry-run-envelope' || digest(body) !== envelope?.digest) errors.push('envelope digest is invalid');
  if (report?.schemaVersion !== SCHEMA_VERSION || !['success', 'failure'].includes(report?.status)) errors.push('report must have a terminal status');
  if (report?.runId !== envelope?.runId || report?.lane !== expectedLane || report?.envelopeDigest !== envelope?.digest) errors.push('report envelope identity is invalid');
  if (stableJson(report?.provenance) !== stableJson(envelope?.provenance)) errors.push('report provenance does not match envelope');
  try { assertOwnedPath(envelope.paths.runRoot, reportPath, envelope.paths.childrenDir); } catch (error) { errors.push(error.message); }
  const generatedAt = Date.parse(report?.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt < Date.parse(envelope?.createdAt) || generatedAt > stat.mtimeMs + 1000 || Math.abs(stat.mtimeMs - generatedAt) > 5000) errors.push('report publication time is outside the envelope');
  const root = report?.process?.root;
  const listener = report?.process?.listener;
  const identityFields = ['pid', 'ppid', 'processGroup', 'session', 'startTicks', 'executable'];
  if (!root || !listener || identityFields.some(field => root[field] === undefined || listener[field] === undefined)) errors.push('report process ownership is required');
  else if (root.processGroup !== listener.processGroup || root.session !== listener.session) errors.push('report listener ownership identity is invalid');
  return errors;
}

module.exports = {
  SCHEMA_VERSION,
  assertOwnedDescendant,
  assertOwnedPath,
  captureProvenance,
  createRunEnvelope,
  discoverOwnedCdp,
  publishJsonOnce,
  readRunEnvelope,
  readProcessIdentity,
  terminateOwnedProcessGroup,
  validateEnvelopeBinding
};
