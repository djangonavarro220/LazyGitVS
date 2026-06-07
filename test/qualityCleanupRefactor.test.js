const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const dogfood = fs.readFileSync(path.join(root, 'scripts', 'dogfood-ui.js'), 'utf8');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test('preview document providers live outside extension.ts', () => {
  assert(exists('src/previewDocuments.ts'), 'preview document providers must be split out of extension.ts');
  const previewDocuments = read('src/previewDocuments.ts');
  assert.match(previewDocuments, /export class EmptyProvider/, 'empty provider must be exported from previewDocuments.ts');
  assert.match(previewDocuments, /export class VirtualPreviewProvider/, 'virtual preview provider must be exported from previewDocuments.ts');
  assert.match(extension, /from '\.\/previewDocuments'/, 'extension.ts must import preview document providers');
  assert(!/class VirtualPreviewProvider/.test(extension), 'extension.ts must not keep the preview provider implementation inline');
});

test('dogfood fixture and report plumbing are split out of the big UI driver', () => {
  assert(exists('scripts/dogfood/fixtures.js'), 'dogfood fixtures must live in scripts/dogfood/fixtures.js');
  assert(exists('scripts/dogfood/reporting.js'), 'dogfood reporting helpers must live in scripts/dogfood/reporting.js');
  assert.match(dogfood, /require\('\.\/dogfood\/fixtures'\)/, 'dogfood-ui.js must import fixture helpers');
  assert.match(dogfood, /require\('\.\/dogfood\/reporting'\)/, 'dogfood-ui.js must import reporting helpers');
  assert(!/function makeFixture\(/.test(dogfood), 'dogfood-ui.js must not keep fixture creation inline');
});

test('dogfood report writing is centralized instead of repeated per lane', () => {
  const repeatedInlineReports = (dogfood.match(/const report = \{ ok: true/g) || []).length;
  assert(repeatedInlineReports <= 1, `dogfood-ui.js still repeats inline report creation ${repeatedInlineReports} times`);
  const reporting = read('scripts/dogfood/reporting.js');
  assert.match(reporting, /function finishReport/, 'reporting helper must centralize check assertion, JSON write, and console output');
});

test('theme lanes are explicitly smoke tests, not fake contrast tests', () => {
  const manifest = read('scripts/dogfood/coverage-manifest.json');
  assert(manifest.includes('dark-theme-smoke'), 'manifest must keep dark theme smoke scenario explicit');
  assert(manifest.includes('high-contrast-theme-smoke'), 'manifest must keep high contrast smoke scenario explicit');
  assert(dogfood.includes('Dark theme smoke: LGVS stays readable'), 'dogfood should name dark lane as smoke, not contrast proof');
  assert(dogfood.includes('High contrast smoke: LGVS stays readable'), 'dogfood should name high contrast lane as smoke, not contrast proof');
  assert(!dogfood.includes('High contrast dogfood smoke stays readable'), 'old ambiguous high-contrast wording should be removed');
});
