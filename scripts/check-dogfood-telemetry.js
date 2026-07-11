#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { validateTelemetryReport } = require('./dogfood/telemetry');

const file = path.resolve(process.argv[2] || 'dogfood-output/telemetry.json');
let report;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`Telemetry report could not be read: ${error.message}`);
  process.exit(1);
}
const expectedIdentity = {
  ...(process.env.LGVS_TELEMETRY_RUN_ID ? { runId: process.env.LGVS_TELEMETRY_RUN_ID } : {}),
  ...(process.env.LGVS_TELEMETRY_LANE ? { lane: process.env.LGVS_TELEMETRY_LANE } : {}),
  ...(process.env.LGVS_TELEMETRY_SOURCE ? { source: process.env.LGVS_TELEMETRY_SOURCE } : {}),
  ...(process.env.LGVS_TELEMETRY_BUILD ? { build: process.env.LGVS_TELEMETRY_BUILD } : {})
};
const stat = fs.statSync(file);
const errors = validateTelemetryReport(report, { expectedIdentity, reportPath: file });
if (Math.abs(stat.mtimeMs - Date.parse(report.generatedAt)) > 5000) errors.push('report file freshness does not match generatedAt');
if (errors.length) {
  console.error(`Telemetry contract failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`Telemetry contract passed: ${report.runs.length} fixtures`);
