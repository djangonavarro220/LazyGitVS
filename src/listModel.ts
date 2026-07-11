export type ListModelRevision = number;

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

export type IdentityIndex<I> = Readonly<{
  get(identity: I): number | undefined;
  has(identity: I): boolean;
  readonly size: number;
}>;

export type ListModelRequest<T, R, I> = Readonly<{
  modelId: string;
  sourceRevision: ListModelRevision;
  projectionRevision: ListModelRevision;
  treeRevision: ListModelRevision;
  items: readonly T[];
  project(items: readonly T[], request: ListModelRequest<T, R, I>): readonly R[];
  identity(row: R): I;
  isCurrent?: () => boolean;
}>;

export type ListModelSnapshot<R, I> = Readonly<{
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

function frozenRow<R>(row: R): Readonly<R> {
  if (row !== null && typeof row === 'object') {
    return Object.freeze({ ...(row as Record<PropertyKey, unknown>) }) as Readonly<R>;
  }
  return row as Readonly<R>;
}

export class ListModelCache<T, R, I> {
  private published: ListModelSnapshot<R, I> | undefined;
  private generation = 0;
  private readonly epochs = new Map<string, Epochs>();
  private counters: MutableStats = { ...ZERO_STATS };
  private readonly duplicateIdentity: 'error' | 'first-wins';

  constructor(options: ListModelCacheOptions = {}) {
    this.duplicateIdentity = options.duplicateIdentity ?? 'first-wins';
  }

  read(request: ListModelRequest<T, R, I>): ListModelSnapshot<R, I> {
    this.counters.reads++;
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

    if (this.published && this.sameKey(this.published.semanticKey, key)) {
      this.counters.hits++;
      return this.published;
    }

    this.counters.misses++;
    this.counters.buildsStarted++;
    if (this.published?.modelId === request.modelId && this.isOlder(request, this.published)) {
      this.counters.buildsDiscarded++;
      return this.published;
    }

    const projected = request.project(request.items, request);
    const rows = projected.map(frozenRow);
    const identities = new Array<I>(rows.length);
    const index = new Map<I, number>();
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const identity = request.identity(rows[rowIndex] as R);
      identities[rowIndex] = identity;
      if (index.has(identity)) {
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
      if (this.published) return this.published;
      throw new Error(`List model publication became stale: ${request.modelId}`);
    }

    const identityToIndex = Object.freeze({
      get: (identity: I) => index.get(identity),
      has: (identity: I) => index.has(identity),
      size: index.size
    });
    const generation = this.generation + 1;
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

    this.generation = generation;
    this.published = snapshot;
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

  private isOlder(request: ListModelRequest<T, R, I>, snapshot: ListModelSnapshot<R, I>): boolean {
    return request.sourceRevision < snapshot.sourceRevision
      || request.projectionRevision < snapshot.projectionRevision
      || request.treeRevision < snapshot.treeRevision;
  }
}
