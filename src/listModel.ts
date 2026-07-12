export type ListModelRevision = number;

export type ListModelIdentity = string | number | bigint | boolean | symbol | null | undefined;

export type ListModelInvalidationScope = Readonly<{
  modelId: string;
  kind: 'source' | 'projection' | 'tree';
}>;

export type ListModelStats = Readonly<{
  reads: number;
  hits: number;
  misses: number;
  buildsStarted: number;
  buildsPublished: number;
  buildsDiscarded: number;
  snapshotAllocations: number;
  rowArrayAllocations: number;
  rowAllocations: number;
  identityIndexAllocations: number;
  sourceInvalidations: number;
  projectionInvalidations: number;
  treeInvalidations: number;
  duplicateIdentityErrors: number;
}>;

export type IdentityIndex<I extends ListModelIdentity> = Readonly<{
  get(identity: I): number | undefined;
  has(identity: I): boolean;
  readonly size: number;
}>;

export type ListModelRequest<T, R, I extends ListModelIdentity> = Readonly<{
  modelId: string;
  /** Monotonic token issued by the model owner. Revisions below are cache-key values, not clocks. */
  ownerGeneration: number;
  sourceRevision: ListModelRevision;
  projectionRevision: ListModelRevision;
  treeRevision: ListModelRevision;
  items: readonly T[];
  project(items: readonly T[], request: ListModelRequest<T, R, I>): readonly R[];
  /** Transfer freshly projected rows whose nested values are already immutable, avoiding a second copy. */
  projectedRows?: 'copy' | 'transfer';
  identity(row: R): I;
  isCurrent?: () => boolean;
}>;

export type ListModelSnapshot<R, I extends ListModelIdentity> = Readonly<{
  modelId: string;
  generation: number;
  semanticKey: Readonly<{
    modelId: string;
    sourceRevision: ListModelRevision;
    projectionRevision: ListModelRevision;
    treeRevision: ListModelRevision;
    sourceEpoch: number;
    projectionEpoch: number;
    treeEpoch: number;
  }>;
  rows: readonly Readonly<R>[];
  identityToIndex: IdentityIndex<I>;
  sourceRevision: ListModelRevision;
  projectionRevision: ListModelRevision;
  treeRevision: ListModelRevision;
  identityAt(index: number): I | undefined;
  indexOfIdentity(identity: I): number | undefined;
}>;

export type ListModelCacheOptions = Readonly<{
  duplicateIdentity?: 'error' | 'first-wins';
  maxModels?: number;
}>;

type MutableStats = { -readonly [K in keyof ListModelStats]: number };
type Epochs = { source: number; projection: number; tree: number };

const ZERO_STATS: MutableStats = {
  reads: 0,
  hits: 0,
  misses: 0,
  buildsStarted: 0,
  buildsPublished: 0,
  buildsDiscarded: 0,
  snapshotAllocations: 0,
  rowArrayAllocations: 0,
  rowAllocations: 0,
  identityIndexAllocations: 0,
  sourceInvalidations: 0,
  projectionInvalidations: 0,
  treeInvalidations: 0,
  duplicateIdentityErrors: 0
};

function ownedFrozenValue<T>(value: T, seen = new Map<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing !== undefined) return existing as T;
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(ownedFrozenValue(entry, seen));
    return Object.freeze(copy) as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('List model rows may contain only owned plain objects, arrays, and primitive values');
  }
  if (prototype === Object.prototype) {
    const flatCopy = { ...(value as Record<PropertyKey, unknown>) };
    let isFlat = true;
    for (const key in flatCopy) {
      const entry = flatCopy[key];
      if (entry !== null && typeof entry === 'object') {
        isFlat = false;
        break;
      }
    }
    if (isFlat) {
      for (const key of Object.getOwnPropertySymbols(flatCopy)) {
        const entry = flatCopy[key];
        if (entry !== null && typeof entry === 'object') {
          isFlat = false;
          break;
        }
      }
    }
    if (isFlat) return Object.freeze(flatCopy) as T;
  }
  const existing = seen.get(value as object);
  if (existing !== undefined) return existing as T;
  const stringKeys = Object.keys(value as object);
  const symbolKeys = Object.getOwnPropertySymbols(value as object);
  const keys: PropertyKey[] = symbolKeys.length === 0 ? stringKeys : [...stringKeys, ...symbolKeys];
  const copy = Object.create(prototype) as Record<PropertyKey, unknown>;
  seen.set(value as object, copy);
  for (const key of keys) {
    copy[key] = ownedFrozenValue((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(copy) as T;
}

function freezeTransferredValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('List model rows may contain only owned plain objects, arrays, and primitive values');
  }
  return Object.freeze(value);
}

export class ListModelCache<T, R, I extends ListModelIdentity> {
  private readonly published = new Map<string, ListModelSnapshot<R, I>>();
  private readonly epochs = new Map<string, Epochs>();
  private counters: MutableStats = { ...ZERO_STATS };
  private readonly duplicateIdentity: 'error' | 'first-wins';
  private readonly maxModels: number;

  constructor(options: ListModelCacheOptions = {}) {
    this.duplicateIdentity = options.duplicateIdentity ?? 'first-wins';
    this.maxModels = options.maxModels ?? 32;
    if (!Number.isInteger(this.maxModels) || this.maxModels < 1) throw new RangeError('maxModels must be a positive integer');
  }

  read(request: ListModelRequest<T, R, I>): ListModelSnapshot<R, I> {
    this.counters.reads++;
    const published = this.published.get(request.modelId);
    const epochs = this.epochsFor(request.modelId);
    const key = Object.freeze({
      modelId: request.modelId,
      sourceRevision: request.sourceRevision,
      projectionRevision: request.projectionRevision,
      treeRevision: request.treeRevision,
      sourceEpoch: epochs.source,
      projectionEpoch: epochs.projection,
      treeEpoch: epochs.tree
    });

    if (published && this.sameKey(published.semanticKey, key)) {
      this.counters.hits++;
      this.touch(request.modelId, published);
      return published;
    }

    this.counters.misses++;
    this.counters.buildsStarted++;
    if (published && request.ownerGeneration <= published.generation) {
      this.counters.buildsDiscarded++;
      return published;
    }

    const projected = request.project(request.items, request);
    const ownedValues = new Map<object, unknown>();

    const rows = new Array<Readonly<R>>(projected.length);
    const identities = new Array<I>(projected.length);
    const index = new Map<I, number>();
    for (let rowIndex = 0; rowIndex < projected.length; rowIndex++) {
      const row = (request.projectedRows === 'transfer'
        ? freezeTransferredValue(projected[rowIndex])
        : ownedFrozenValue(projected[rowIndex], ownedValues)) as Readonly<R>;
      rows[rowIndex] = row;
      const identity = request.identity(row as R);
      const identityType = typeof identity;
      if (identityType === 'function' || (identityType === 'object' && identity !== null)) {
        this.counters.buildsDiscarded++;
        throw new TypeError(`List model identity must be an immutable primitive in ${request.modelId}`);
      }
      identities[rowIndex] = identity;
      if (index.get(identity) !== undefined) {
        this.counters.duplicateIdentityErrors++;
        if (this.duplicateIdentity === 'error') {
          this.counters.buildsDiscarded++;
          throw new Error(`Duplicate list model identity in ${request.modelId}: ${String(identity)}`);
        }
      } else {
        index.set(identity, rowIndex);
      }
    }
    Object.freeze(rows);
    Object.freeze(identities);

    if (request.isCurrent && !request.isCurrent()) {
      this.counters.buildsDiscarded++;
      if (published) return published;
      throw new Error(`List model publication became stale: ${request.modelId}`);
    }

    const identityToIndex = Object.freeze({
      get: (identity: I) => index.get(identity),
      has: (identity: I) => index.has(identity),
      size: index.size
    });
    const generation = request.ownerGeneration;
    const snapshot = Object.freeze({
      modelId: request.modelId,
      generation,
      semanticKey: key,
      rows,
      identityToIndex,
      sourceRevision: request.sourceRevision,
      projectionRevision: request.projectionRevision,
      treeRevision: request.treeRevision,
      identityAt: (rowIndex: number) => identities[rowIndex],
      indexOfIdentity: (identity: I) => index.get(identity)
    });

    this.touch(request.modelId, snapshot);
    while (this.published.size > this.maxModels) {
      const oldest = this.published.keys().next().value as string;
      this.published.delete(oldest);
    }
    this.counters.buildsPublished++;
    this.counters.snapshotAllocations++;
    this.counters.rowArrayAllocations++;
    this.counters.rowAllocations += rows.length;
    this.counters.identityIndexAllocations++;
    return snapshot;
  }

  invalidate(scope: ListModelInvalidationScope): void {
    const epochs = this.epochsFor(scope.modelId);
    epochs[scope.kind]++;
    if (scope.kind === 'source') this.counters.sourceInvalidations++;
    else if (scope.kind === 'projection') this.counters.projectionInvalidations++;
    else this.counters.treeInvalidations++;
  }

  stats(): ListModelStats {
    return Object.freeze({ ...this.counters });
  }

  resetStatsForTest(): void {
    this.counters = { ...ZERO_STATS };
  }

  private epochsFor(modelId: string): Epochs {
    let epochs = this.epochs.get(modelId);
    if (!epochs) {
      epochs = { source: 0, projection: 0, tree: 0 };
      this.epochs.set(modelId, epochs);
    }
    return epochs;
  }

  private sameKey(a: ListModelSnapshot<R, I>['semanticKey'], b: ListModelSnapshot<R, I>['semanticKey']): boolean {
    return a.modelId === b.modelId
      && a.sourceRevision === b.sourceRevision
      && a.projectionRevision === b.projectionRevision
      && a.treeRevision === b.treeRevision
      && a.sourceEpoch === b.sourceEpoch
      && a.projectionEpoch === b.projectionEpoch
      && a.treeEpoch === b.treeEpoch;
  }

  private touch(modelId: string, snapshot: ListModelSnapshot<R, I>): void {
    this.published.delete(modelId);
    this.published.set(modelId, snapshot);
  }
}
