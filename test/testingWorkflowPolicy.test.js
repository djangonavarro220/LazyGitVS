const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
const testingDoc = fs.readFileSync(path.join(root, 'docs', 'testing-and-verification.md'), 'utf8');
const building = fs.readFileSync(path.join(root, 'BUILDING.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const dogfooding = fs.readFileSync(path.join(root, 'docs', 'dogfooding-ui.md'), 'utf8');

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

test('every test file is wired into npm test', () => {
  const testFiles = fs.readdirSync(path.join(root, 'test'))
    .filter(file => file.endsWith('.test.js'))
    .sort();
  const npmTest = pkg.scripts.test;
  for (const file of testFiles) {
    assert(npmTest.includes(`node test/${file}`), `${file} is not included in package.json scripts.test`);
  }
});

test('testing policy is a hard agent rule and not just a forgotten doc', () => {
  assert.match(agents, /Test every feature and bug fix/);
  assert.match(agents, /100% target where practical/);
  assert.match(agents, /docs\/testing-and-verification\.md/);
  assert.match(testingDoc, /Every feature request and every bug fix should ship with tests/);
  assert.match(testingDoc, /aiming for 100% coverage of the touched behavior/);
  assert.match(testingDoc, /If a behavior cannot be fully automated, document the gap/);
});

test('public developer docs point future agents to the testing playbook', () => {
  for (const [name, text] of Object.entries({ BUILDING: building, README: readme, dogfooding })) {
    assert(text.includes('docs/testing-and-verification.md'), `${name} must link docs/testing-and-verification.md`);
  }
});

test('dogfood lanes required by the playbook exist as npm scripts', () => {
  for (const script of ['dogfood:ui', 'dogfood:ui:no-vim', 'dogfood:ui:vim', 'dogfood:ui:preview-tabs', 'dogfood:ui:vim-escape', 'dogfood:ui:reset-state', 'dogfood:ui:command-palette', 'dogfood:ui:hunk-escape']) {
    assert(pkg.scripts[script], `${script} must exist`);
  }
  assert.match(pkg.scripts['dogfood:ui:no-vim'], /LGVS_DOGFOOD_VARIANT=no-vim/);
  assert.match(pkg.scripts['dogfood:ui:vim'], /LGVS_DOGFOOD_VARIANT=vim/);
  assert.match(pkg.scripts['dogfood:ui:reset-state'], /LGVS_DOGFOOD_FAST_RESET_STATE=1/);
  assert.match(pkg.scripts['dogfood:ui:command-palette'], /LGVS_DOGFOOD_FAST_COMMAND_PALETTE=1/);
  assert.match(pkg.scripts['dogfood:ui:hunk-escape'], /LGVS_DOGFOOD_FAST_HUNK_ESCAPE=1/);
});

test('test playbook names focused, full, dogfood and package verification commands', () => {
  for (const command of ['npm test', 'npm run dogfood:ui', 'npm run package', 'npm run package:dist']) {
    assert(testingDoc.includes(command), `testing playbook must include ${command}`);
  }
  assert.match(testingDoc, /node test\/<file>\.test\.js/);
});
