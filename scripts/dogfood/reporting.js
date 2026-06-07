const fs = require('fs');
const path = require('path');

function targetLane(env = process.env) {
  return [
    env.LGVS_DOGFOOD_FAST_PREVIEW_TABS && 'preview-tabs',
    env.LGVS_DOGFOOD_FAST_VIM_ESCAPE && 'vim-escape',
    env.LGVS_DOGFOOD_FAST_RESET_STATE && 'reset-state',
    env.LGVS_DOGFOOD_FAST_COMMAND_PALETTE && 'command-palette',
    env.LGVS_DOGFOOD_FAST_HUNK_ESCAPE && 'hunk-escape',
    env.LGVS_DOGFOOD_DEEP_TREE && 'deep-tree',
    env.LGVS_DOGFOOD_EDGE_FILES && 'edge-files',
    env.LGVS_DOGFOOD_BINARY_FILE && 'binary-file',
    env.LGVS_DOGFOOD_LARGE_REPO && 'large-repo',
    env.LGVS_DOGFOOD_GIT_FAILURE && 'git-failure',
    env.LGVS_DOGFOOD_DESTRUCTIVE_CANCEL && 'destructive-cancel',
    env.LGVS_DOGFOOD_FAST_THEME && `${env.LGVS_DOGFOOD_FAST_THEME}-theme`
  ].filter(Boolean).join('-') || 'full';
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

function finishReport({ reportPath, checks, report }) {
  assertChecks(checks);
  writeJson(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

module.exports = { targetLane, assertChecks, finishReport, writeJson };
