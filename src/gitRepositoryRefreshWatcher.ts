export type DisposableLike = { dispose(): unknown };
export type EventLike<T> = (listener: (value: T) => unknown) => DisposableLike;

export type GitRepositoryLike = {
  state?: { onDidChange?: EventLike<unknown> };
};

export type GitApiLike = {
  repositories?: GitRepositoryLike[];
  onDidOpenRepository?: EventLike<GitRepositoryLike>;
  onDidCloseRepository?: EventLike<GitRepositoryLike>;
};

type GitExtensionExportsLike = { getAPI(version: number): GitApiLike };
type GitExtensionLike = { activate(): PromiseLike<GitExtensionExportsLike> };
export type ExtensionsLike = { getExtension(id: string): GitExtensionLike | undefined };

export class GitRepositoryRefreshWatcher implements DisposableLike {
  private readonly repositories = new Map<GitRepositoryLike, DisposableLike>();
  private apiSubscriptions: DisposableLike[] = [];
  private disposed = false;

  constructor(private readonly scheduleRefresh: () => void) {}

  connect(api: GitApiLike): void {
    if (this.disposed) return;
    this.disconnect();
    for (const repository of api.repositories ?? []) this.watch(repository);
    if (api.onDidOpenRepository) this.apiSubscriptions.push(api.onDidOpenRepository(repository => this.watch(repository)));
    if (api.onDidCloseRepository) this.apiSubscriptions.push(api.onDidCloseRepository(repository => this.unwatch(repository)));
  }

  dispose(): void {
    this.disposed = true;
    this.disconnect();
  }

  private watch(repository: GitRepositoryLike): void {
    if (this.disposed || this.repositories.has(repository)) return;
    const onDidChange = repository.state?.onDidChange;
    if (!onDidChange) return;
    this.repositories.set(repository, onDidChange(() => { if (!this.disposed) this.scheduleRefresh(); }));
  }

  private unwatch(repository: GitRepositoryLike): void {
    this.repositories.get(repository)?.dispose();
    this.repositories.delete(repository);
  }

  private disconnect(): void {
    for (const subscription of this.apiSubscriptions) subscription.dispose();
    this.apiSubscriptions = [];
    for (const subscription of this.repositories.values()) subscription.dispose();
    this.repositories.clear();
  }
}

export function createGitRepositoryRefreshWatcher(scheduleRefresh: () => void, extensions: ExtensionsLike): GitRepositoryRefreshWatcher {
  const watcher = new GitRepositoryRefreshWatcher(scheduleRefresh);
  const gitExtension = extensions.getExtension('vscode.git');
  if (gitExtension) void gitExtension.activate().then(exports => watcher.connect(exports.getAPI(1)), () => undefined);
  return watcher;
}
