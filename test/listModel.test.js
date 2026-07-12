const assert = require('assert');
const { ListModelCache } = require('../out/listModel');

const items = [
  { path: 'src/a.ts', value: 1 },
  { path: 'src/b.ts', value: 2 },
  { path: 'README.md', value: 3 }
];
const project = source => source.map(item => ({ ...item, identity: `repo:path:${item.path.replace(/\\/g, '/')}` }));
const request = overrides => ({
  modelId: 'repo:files',
  ownerGeneration: 1,
  sourceRevision: 1,
  projectionRevision: 1,
  treeRevision: 1,
  items,
  project,
  identity: row => row.identity,
  ...overrides
});

const cache = new ListModelCache({ duplicateIdentity: 'error' });
const first = cache.read(request());
const second = cache.read(request({ selection: 2 }));
assert.strictEqual(second, first, 'selection is not semantic and must return the same snapshot');
assert.strictEqual(second.rows, first.rows);
assert.strictEqual(second.rows[0], first.rows[0]);
assert.strictEqual(second.identityToIndex, first.identityToIndex);
assert.strictEqual(first.identityAt(1), 'repo:path:src/b.ts');
assert.strictEqual(first.indexOfIdentity('repo:path:src/b.ts'), 1);
assert.strictEqual(first.indexOfIdentity('missing'), undefined);
assert(Object.isFrozen(first));
assert(Object.isFrozen(first.semanticKey));
assert(Object.isFrozen(first.rows));
assert(first.rows.every(Object.isFrozen));
assert(Object.isFrozen(first.identityToIndex));
first.rows[0].path = 'mutated';
assert.strictEqual(first.rows[0].path, 'src/a.ts', 'frozen rows reject runtime mutation');

const mutableItems = [{ path: 'nested', value: { count: 1 }, tags: ['old'] }];
const immutableSnapshot = new ListModelCache().read(request({
  modelId: 'nested',
  items: mutableItems,
  project: sourceItems => sourceItems.map(item => ({ ...item, identity: item.path }))
}));
mutableItems[0].value.count = 9;
mutableItems[0].tags.push('new');
immutableSnapshot.rows[0].value.count = 7;
assert.throws(() => immutableSnapshot.rows[0].tags.push('blocked'), TypeError);
assert.deepStrictEqual(immutableSnapshot.rows[0].value, { count: 1 });
assert.deepStrictEqual(immutableSnapshot.rows[0].tags, ['old']);
assert(Object.isFrozen(immutableSnapshot.rows[0].value));
assert(Object.isFrozen(immutableSnapshot.rows[0].tags));
const symbolKey = Symbol('stable metadata');
const symbolSnapshot = new ListModelCache().read(request({
  modelId: 'symbol-row',
  items: [{ path: 'symbol', [symbolKey]: 'kept' }],
  project: sourceItems => sourceItems
}));
assert.strictEqual(symbolSnapshot.rows[0][symbolKey], 'kept', 'the flat-row ownership fast path preserves symbol fields');
assert(Object.isFrozen(symbolSnapshot.rows[0]));
const transferredRow = { path: 'transferred', nested: Object.freeze({ value: 1 }), identity: 'repo:path:transferred' };
const transferredSnapshot = new ListModelCache().read(request({
  modelId: 'transferred-row',
  items: [],
  project: () => [transferredRow],
  projectedRows: 'transfer'
}));
assert.strictEqual(transferredSnapshot.rows[0], transferredRow, 'fresh projected rows transfer without a second allocation');
assert(Object.isFrozen(transferredRow));
assert(Object.isFrozen(transferredRow.nested));
const sharedTransferred = { value: 1 };
const cycleTransferred = { value: 1 };
cycleTransferred.self = cycleTransferred;
const nestedSymbol = Symbol('nested ownership');
const graphRow = { path: 'graph', left: sharedTransferred, right: sharedTransferred, cycleTransferred, [nestedSymbol]: { value: 1 }, identity: 'repo:path:graph' };
const graphSnapshot = new ListModelCache().read(request({ modelId: 'transferred-graph', items: [], project: () => [graphRow], projectedRows: 'transfer' }));
assert.strictEqual(graphSnapshot.rows[0], graphRow);
assert.strictEqual(graphSnapshot.rows[0].left, graphSnapshot.rows[0].right, 'transfer preserves shared ownership');
assert.strictEqual(graphSnapshot.rows[0].cycleTransferred.self, graphSnapshot.rows[0].cycleTransferred, 'transfer preserves cycles');
for (const value of [graphRow, sharedTransferred, cycleTransferred, graphRow[nestedSymbol]]) assert(Object.isFrozen(value));
assert.strictEqual(Reflect.set(sharedTransferred, 'value', 9), false);
assert.strictEqual(Reflect.set(cycleTransferred, 'extra', true), false);
assert.strictEqual(Reflect.set(graphRow[nestedSymbol], 'value', 9), false);
assert.strictEqual(graphSnapshot.rows[0].left.value, 1);
assert.strictEqual(graphSnapshot.rows[0].cycleTransferred.extra, undefined);
assert.strictEqual(graphSnapshot.rows[0][nestedSymbol].value, 1);
assert.deepStrictEqual(cache.stats(), {
  reads: 2, hits: 1, misses: 1, buildsStarted: 1, buildsPublished: 1, buildsDiscarded: 0,
  snapshotAllocations: 1, rowArrayAllocations: 1, rowAllocations: 3, identityIndexAllocations: 1,
  sourceInvalidations: 0, projectionInvalidations: 0, treeInvalidations: 0, duplicateIdentityErrors: 0
});

for (let selection = 0; selection < 100; selection++) cache.read(request({ selection }));
assert.strictEqual(cache.stats().buildsPublished, 1, '100 selection reads must not rebuild');
assert.strictEqual(cache.stats().hits, 101);

cache.invalidate({ modelId: 'other:model', kind: 'source' });
assert.strictEqual(cache.read(request()), first, 'invalidation is model scoped');
cache.invalidate({ modelId: 'repo:files', kind: 'projection' });
const projected = cache.read(request({ ownerGeneration: 2 }));
assert.notStrictEqual(projected, first);
assert.strictEqual(projected.generation, 2);
cache.invalidate({ modelId: 'repo:files', kind: 'tree' });
const tree = cache.read(request({ ownerGeneration: 3 }));
assert.strictEqual(tree.generation, 3);
cache.invalidate({ modelId: 'repo:files', kind: 'source' });
const source = cache.read(request({ ownerGeneration: 4 }));
assert.strictEqual(source.generation, 4);
assert.deepStrictEqual(
  { source: cache.stats().sourceInvalidations, projection: cache.stats().projectionInvalidations, tree: cache.stats().treeInvalidations },
  { source: 2, projection: 1, tree: 1 }
);

const newer = cache.read(request({ ownerGeneration: 5, sourceRevision: 5, projectionRevision: 10, treeRevision: 10 }));
const resetRevisions = cache.read(request({ ownerGeneration: 6, sourceRevision: 6, projectionRevision: 1, treeRevision: 1 }));
assert.notStrictEqual(resetRevisions, newer, 'a newer owner generation may reset independent revisions');
assert.strictEqual(resetRevisions.sourceRevision, 6);
const stale = cache.read(request({ ownerGeneration: 4, sourceRevision: 99, projectionRevision: 99, treeRevision: 99 }));
assert.strictEqual(stale, resetRevisions, 'an out-of-order owner generation cannot replace the published generation');
assert.strictEqual(cache.stats().buildsDiscarded, 1);

let current = true;
const guardedCache = new ListModelCache();
const guarded = guardedCache.read(request({ isCurrent: () => current }));
current = false;
const discarded = guardedCache.read(request({ ownerGeneration: 2, sourceRevision: 2, projectionRevision: 2, treeRevision: 2, isCurrent: () => current }));
assert.strictEqual(discarded, guarded, 'a terminal generation guard rejects stale publication');
assert.strictEqual(guardedCache.stats().buildsDiscarded, 1);
assert.strictEqual(guardedCache.stats().buildsPublished, 1);

const duplicateCache = new ListModelCache({ duplicateIdentity: 'error' });
assert.throws(() => duplicateCache.read(request({
  items: [{ path: 'same', value: 1 }, { path: 'same', value: 2 }]
})), /Duplicate list model identity/);
assert.strictEqual(duplicateCache.stats().duplicateIdentityErrors, 1);
assert.strictEqual(duplicateCache.stats().buildsDiscarded, 1);

const productionCache = new ListModelCache();
const duplicateSnapshot = productionCache.read(request({
  items: [{ path: 'same', value: 1 }, { path: 'same', value: 2 }]
}));
assert.strictEqual(duplicateSnapshot.indexOfIdentity('repo:path:same'), 0, 'production duplicate handling is deterministic first-wins');
assert.strictEqual(productionCache.stats().duplicateIdentityErrors, 1);

for (const invalidIdentity of [{ path: 'mutable' }, () => 'callable']) {
  const invalidIdentityCache = new ListModelCache({ duplicateIdentity: 'error' });
  assert.throws(() => invalidIdentityCache.read(request({
    modelId: `invalid:${typeof invalidIdentity}`,
    identity: () => invalidIdentity
  })), /identity must be an immutable primitive/);
  assert.strictEqual(invalidIdentityCache.stats().buildsDiscarded, 1);
  assert.strictEqual(invalidIdentityCache.stats().buildsPublished, 0);
  assert.strictEqual(invalidIdentityCache.stats().identityIndexAllocations, 0);
}

const multiModelCache = new ListModelCache({ maxModels: 2 });
const modelA = multiModelCache.read(request({ modelId: 'A' }));
multiModelCache.read(request({ modelId: 'B' }));
assert.strictEqual(multiModelCache.read(request({ modelId: 'A' })), modelA, 'A-B-A unchanged reads reuse A');
assert.strictEqual(multiModelCache.stats().buildsPublished, 2);

for (const identityParts of [
  ['repo', ':path:', 'src/a.ts'],
  ['commit:', '0123456789abcdef0123456789abcdef01234567', ':path:src/a.ts'],
  ['refs/heads/', 'feature/', 'x'],
  ['refs/remotes/', 'origin/feature/', 'x'],
  ['refs/tags/', 'v1.0.', '0'],
  ['stash:', 'fedcba9876543210fedcba9876543210fedcba98', ':path:src/a.ts']
]) {
  const identity = identityParts.join('');
  const identityCache = new ListModelCache({ duplicateIdentity: 'error' });
  const snapshot = identityCache.read(request({
    modelId: identity,
    items: [{ path: identity, value: 1 }],
    project: sourceItems => sourceItems.map(item => ({ ...item, identity })),
    identity: row => row.identity
  }));
  const restoredIdentity = identityParts.map(part => `${part}`).join('');
  assert.strictEqual(snapshot.indexOfIdentity(restoredIdentity), 0, `restores exact semantic identity by string value ${identity}`);
}

const statsCopy = cache.stats();
assert(Object.isFrozen(statsCopy));
cache.resetStatsForTest();
assert(Object.values(cache.stats()).every(value => value === 0));
assert.strictEqual(cache.read(request({ ownerGeneration: 6, sourceRevision: 6, projectionRevision: 1, treeRevision: 1 })), resetRevisions, 'resetting counters does not evict the model');
assert.strictEqual(cache.stats().hits, 1);

console.log('listModel tests passed');
