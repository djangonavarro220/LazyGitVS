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
const projected = cache.read(request());
assert.notStrictEqual(projected, first);
assert.strictEqual(projected.generation, 2);
cache.invalidate({ modelId: 'repo:files', kind: 'tree' });
const tree = cache.read(request());
assert.strictEqual(tree.generation, 3);
cache.invalidate({ modelId: 'repo:files', kind: 'source' });
const source = cache.read(request());
assert.strictEqual(source.generation, 4);
assert.deepStrictEqual(
  { source: cache.stats().sourceInvalidations, projection: cache.stats().projectionInvalidations, tree: cache.stats().treeInvalidations },
  { source: 2, projection: 1, tree: 1 }
);

const newer = cache.read(request({ sourceRevision: 5, projectionRevision: 5, treeRevision: 5 }));
const stale = cache.read(request({ sourceRevision: 4, projectionRevision: 5, treeRevision: 5 }));
assert.strictEqual(stale, newer, 'an older revision cannot replace the published generation');
assert.strictEqual(cache.stats().buildsDiscarded, 1);

let current = true;
const guardedCache = new ListModelCache();
const guarded = guardedCache.read(request({ isCurrent: () => current }));
current = false;
const discarded = guardedCache.read(request({ sourceRevision: 2, projectionRevision: 2, treeRevision: 2, isCurrent: () => current }));
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

for (const identity of [
  'repo:path:src/a.ts',
  'commit:0123456789abcdef0123456789abcdef01234567:path:src/a.ts',
  'refs/heads/feature/x',
  'refs/remotes/origin/feature/x',
  'refs/tags/v1.0.0',
  'stash:fedcba9876543210fedcba9876543210fedcba98:path:src/a.ts'
]) {
  const identityCache = new ListModelCache({ duplicateIdentity: 'error' });
  const snapshot = identityCache.read(request({
    modelId: identity,
    items: [{ path: identity, value: 1 }],
    project: sourceItems => sourceItems.map(item => ({ ...item, identity })),
    identity: row => row.identity
  }));
  assert.strictEqual(snapshot.indexOfIdentity(identity), 0, `restores exact semantic identity ${identity}`);
}

const statsCopy = cache.stats();
assert(Object.isFrozen(statsCopy));
cache.resetStatsForTest();
assert(Object.values(cache.stats()).every(value => value === 0));
assert.strictEqual(cache.read(request({ sourceRevision: 5, projectionRevision: 5, treeRevision: 5 })), newer, 'resetting counters does not evict the model');
assert.strictEqual(cache.stats().hits, 1);

console.log('listModel tests passed');
