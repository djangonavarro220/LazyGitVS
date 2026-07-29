const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vscode = require('vscode');

const requestPath = process.env.LGVS_DOGFOOD_BOOTSTRAP_REQUEST;
const resultPath = process.env.LGVS_DOGFOOD_BOOTSTRAP_RESULT;
const donePath = process.env.LGVS_DOGFOOD_BOOTSTRAP_DONE;
const boundaryPath = process.env.LGVS_DOGFOOD_BOUNDARY_REPORT;
const deadlineMs = 30000;

function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function publish(file, value) { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value)); fs.renameSync(temporary, file); }
function publishProgress(request, progress, extra = {}) { publish(resultPath, { identity: request?.identity, digest: request?.digest, progress, ...extra }); }
function waitFor(file, accept) {
  return new Promise((resolve, reject) => {
    const check = () => { try { const value = readJson(file); if (accept(value)) finish(resolve, value); } catch {} };
    const timer = setTimeout(() => finish(reject, new Error(`Bootstrap deadline exceeded: ${path.basename(file)}`)), deadlineMs);
    const watcher = fs.watch(path.dirname(file), check);
    const finish = (settle, value) => { clearTimeout(timer); watcher.close(); settle(value); };
    check();
  });
}
function boundaryAck() {
  try {
    const records = fs.readFileSync(boundaryPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    return records.find(record => record.event === 'panelFocus' && record.activeView === 'files' && record.to === 'files');
  } catch { return undefined; }
}
function waitForBoundary() {
  return new Promise((resolve, reject) => {
    const check = () => { const value = boundaryAck(); if (value) finish(resolve, value); };
    const timer = setTimeout(() => finish(reject, new Error('Bootstrap boundary acknowledgement deadline exceeded')), deadlineMs);
    const watcher = fs.watch(path.dirname(boundaryPath), check);
    const finish = (settle, value) => { clearTimeout(timer); watcher.close(); settle(value); };
    check();
  });
}

exports.run = async () => {
  if (!requestPath || !resultPath || !donePath || !boundaryPath) throw new Error('Bootstrap paths are required');
  publish(resultPath, { progress: 'loaded' });
  const request = await waitFor(requestPath, value => value?.digest === digest(value.identity) && value.boundaryPath === boundaryPath);
  publishProgress(request, 'request-read');
  try {
    const command = vscode.commands.executeCommand('lazygitvs.openDashboard');
    publishProgress(request, 'command-issued');
    void Promise.resolve(command).then(
      () => publishProgress(request, 'command-settled'),
      () => publishProgress(request, 'command-error', { error: 'command-rejected' })
    );
  } catch { publishProgress(request, 'command-error', { error: 'command-threw' }); }
  const observed = await waitForBoundary();
  publishProgress(request, 'success', { event: 'panelFocus', activeView: 'files', boundary: observed });
  await waitFor(donePath, value => value?.digest === request.digest);
};
