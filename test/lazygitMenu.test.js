const assert = require('assert');
const { decorateMenuItems, findMenuItemByKey } = require('../out/lazygitMenu');

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

test('decorateMenuItems prefixes lazygit keys and adds cancel', () => {
  const items = decorateMenuItems([{ key: 'a', label: 'Stash all' }]);
  assert.equal(items[0].label, 'esc Cancel');
  assert.equal(items[1].label, 'a Stash all');
});

test('findMenuItemByKey resolves exact typed lazygit key case-sensitively', () => {
  const items = [{ key: 's', label: 'stash all' }, { key: 'S', label: 'stash options' }];
  assert.equal(findMenuItemByKey(items, 's').label, 'stash all');
  assert.equal(findMenuItemByKey(items, 'S').label, 'stash options');
  assert.equal(findMenuItemByKey(items, 'st'), undefined);
});

test('findMenuItemByKey resolves bracket keys case-insensitively', () => {
  const items = [{ key: '<space>', label: 'stage' }, { key: '<esc>', label: 'cancel' }];
  assert.equal(findMenuItemByKey(items, '<SPACE>').label, 'stage');
});
