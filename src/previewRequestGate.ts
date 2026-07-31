export class PreviewRequestGate {
  private generation = 0;
  private activeKey: string | undefined;

  begin(key: string): number {
    if (key !== this.activeKey) {
      this.activeKey = key;
      this.generation += 1;
    }
    return this.generation;
  }

  isCurrent(request: number): boolean { return request === this.generation; }
}

type PendingLatestTask<T> = {
  task: (isCurrent: () => boolean) => Promise<T> | T;
  resolve: (value: T | undefined) => void;
  reject: (error: unknown) => void;
  generation: number;
};

/** Serialize externally visible effects while dropping superseded work that has not started. */
export class LatestWinsAsyncGate {
  private generation = 0;
  private running = false;
  private pending?: PendingLatestTask<unknown>;

  request<T>(task: (isCurrent: () => boolean) => Promise<T> | T): Promise<T | undefined> {
    const generation = ++this.generation;
    return new Promise<T | undefined>((resolve, reject) => {
      this.pending?.resolve(undefined);
      this.pending = { task, resolve: resolve as (value: unknown) => void, reject, generation };
      void this.drain();
    });
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const pending = this.pending;
        this.pending = undefined;
        if (pending.generation !== this.generation) {
          pending.resolve(undefined);
          continue;
        }
        try {
          const value = await pending.task(() => pending.generation === this.generation);
          pending.resolve(pending.generation === this.generation ? value : undefined);
        } catch (error) {
          pending.reject(error);
        }
      }
    } finally {
      this.running = false;
      if (this.pending) void this.drain();
    }
  }
}
