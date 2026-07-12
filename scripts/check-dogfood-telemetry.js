#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { validateTelemetryReport } = require('./dogfood/telemetry');
const { assertImmutablePublishedFile, readEnvelopeForAggregate } = require('./dogfood/run-envelope');

const file = path.resolve(process.argv[2] || 'dogfood-output/telemetry.json');
let report;
let envelope;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
  envelope = readEnvelopeForAggregate(file, report.envelopeDigest);
} catch (error) {
  console.error(`Telemetry report or immutable run envelope could not be read: ${error.message}`);
  process.exit(1);
}
const expectedIdentity = {
  ...(process.env.LGVS_TELEMETRY_RUN_ID ? { runId: process.env.LGVS_TELEMETRY_RUN_ID } : {}),
  ...(process.env.LGVS_TELEMETRY_LANE ? { lane: process.env.LGVS_TELEMETRY_LANE } : {}),
  ...(process.env.LGVS_TELEMETRY_SOURCE ? { source: process.env.LGVS_TELEMETRY_SOURCE } : {}),
  ...(process.env.LGVS_TELEMETRY_BUILD ? { build: process.env.LGVS_TELEMETRY_BUILD } : {})
};
let stat;
try { stat = assertImmutablePublishedFile(file); } catch (error) {
  console.error(`Telemetry aggregate is not immutable: ${error.message}`);
  process.exit(1);
}
const errors = validateTelemetryReport(report, { expectedIdentity, reportPath: file, envelope });
const generatedAt = Date.parse(report.generatedAt);
if (!Number.isFinite(generatedAt) || generatedAt < Date.parse(envelope.createdAt) || generatedAt > stat.mtimeMs + 1000 || Math.abs(stat.mtimeMs - generatedAt) > 5000) errors.push('aggregate freshness does not match envelope and publication');
if (errors.length) {
  console.error(`Telemetry contract failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`Telemetry contract passed: ${report.runs.length} fixtures`);
