const fs = require('fs');
const path = require('path');

function targetLane(env = process.env) {
  return [
    env.LGVS_DOGFOOD_FAST_PREVIEW_TABS && 'preview-tabs',
    env.LGVS_DOGFOOD_FAST_VIM_ESCAPE && 'vim-escape',
    env.LGVS_DOGFOOD_FAST_RESET_STATE && 'reset-state',
    env.LGVS_DOGFOOD_FAST_COMMAND_PALETTE && 'command-palette',
    env.LGVS_DOGFOOD_FAST_HUNK_ESCAPE && 'hunk-escape',
    env.LGVS_DOGFOOD_PANEL_NAVIGATION && 'panel-navigation',
    env.LGVS_DOGFOOD_FAST_COMMIT_FILE_TREE && 'commit-file-tree',
    env.LGVS_DOGFOOD_DEEP_TREE && 'deep-tree',
    env.LGVS_DOGFOOD_CRAMPED_SIDEBAR && 'cramped-sidebar',
    env.LGVS_DOGFOOD_EDGE_FILES && 'edge-files',
    env.LGVS_DOGFOOD_BINARY_FILE && 'binary-file',
    env.LGVS_DOGFOOD_TELEMETRY && `telemetry-${env.LGVS_TELEMETRY_FILE_COUNT}f-${env.LGVS_TELEMETRY_REPO_COUNT}r`,
    env.LGVS_DOGFOOD_LARGE_REPO && 'large-repo',
    env.LGVS_DOGFOOD_GIT_FAILURE && 'git-failure',
    env.LGVS_DOGFOOD_DESTRUCTIVE_CANCEL && 'destructive-cancel',
    env.LGVS_DOGFOOD_OPERATION_STATUS && 'operation-status',
    env.LGVS_DOGFOOD_UNDO_REDO && 'undo-redo',
    env.LGVS_DOGFOOD_FAST_THEME && `${env.LGVS_DOGFOOD_FAST_THEME}-theme`
  ].filter(Boolean).join('-') || 'full';
}

function panelNavigationBoundaryMatches(event, expected) {
  return event?.event === 'panelFocus'
    && event.from === expected.from
    && event.to === expected.to
    && event.activeView === expected.activeView;
}

function assertChecks(checks) {
  for (const check of checks) {
    if (!check.ok) throw new Error(`Dogfood check failed: ${check.name}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function assertScreenshotEvidence(report) {
  for (const item of report.evidence || []) {
    if (!item.screenshot) continue;
    const stat = fs.statSync(item.screenshot, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`Dogfood screenshot evidence is missing: ${item.screenshot}`);
  }
}

function finishReport({ reportPath, checks, report }) {
  assertChecks(checks);
  assertScreenshotEvidence(report);
  writeJson(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

module.exports = { targetLane, panelNavigationBoundaryMatches, assertChecks, assertScreenshotEvidence, finishReport, writeJson };
