#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/dogfood/coverage-manifest.json'), 'utf8'));
const reports = new Map();
for (const [lane, rel] of Object.entries(manifest.reports || {})) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  try { reports.set(lane, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (error) { reports.set(lane, { ok: false, error: String(error) }); }
}
const rows = [];
for (const scenario of manifest.scenarios) {
  const report = reports.get(scenario.lane);
  const check = report?.checks?.find(c => c.name === scenario.check);
  const ok = !!(report && report.ok && check && check.ok);
  rows.push({ ...scenario, ok, reportPresent: !!report, checkPresent: !!check });
}
const covered = rows.filter(r => r.ok).length;
const total = rows.length;
const byLane = {};
for (const row of rows) {
  const lane = byLane[row.lane] ??= { total: 0, covered: 0, missing: [] };
  lane.total++;
  if (row.ok) lane.covered++;
  else lane.missing.push(row.id);
}
const summary = { ok: covered === total, covered, total, percent: total ? Number((covered / total * 100).toFixed(2)) : 100, lanes: byLane, missing: rows.filter(r => !r.ok).map(r => ({ id: r.id, lane: r.lane, check: r.check, reportPresent: r.reportPresent, checkPresent: r.checkPresent })) };
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
