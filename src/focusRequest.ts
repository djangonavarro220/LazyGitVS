export type FocusTimer = (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
export type FocusTimerClear = (timer: ReturnType<typeof setTimeout>) => void;

export type PanelFocusRequest = { request: number; panel: string; from: string; generation: number };

export class FocusRequestStateMachine {
  private nextRequest = 0;
  private readonly renderedGenerations = new Map<string, number>();
  private pendingRequest: PanelFocusRequest | undefined;
  private dispatchedRequest: number | undefined;

  begin(panel: string, from = panel): PanelFocusRequest {
    this.pendingRequest = { request: ++this.nextRequest, panel, from, generation: 0 };
    this.dispatchedRequest = undefined;
    return this.pendingRequest;
  }

  rendered(panel: string): number {
    const generation = (this.renderedGenerations.get(panel) ?? 0) + 1;
    this.renderedGenerations.set(panel, generation);
    if (this.pendingRequest?.panel === panel) {
      this.pendingRequest.generation = generation;
      this.dispatchedRequest = undefined;
    }
    return generation;
  }

  ready(panel: string, generation: number): PanelFocusRequest | undefined {
    const pending = this.pendingRequest;
    if (this.renderedGenerations.get(panel) !== generation || pending?.panel !== panel || pending.generation !== generation || this.dispatchedRequest === pending.request) return undefined;
    this.dispatchedRequest = pending.request;
    return pending;
  }

  acknowledge(panel: string, generation: number, request: number): PanelFocusRequest | undefined {
    const pending = this.pendingRequest;
    if (!pending || this.renderedGenerations.get(panel) !== generation || pending.panel !== panel || pending.generation !== generation || pending.request !== request || this.dispatchedRequest !== request) return undefined;
    this.pendingRequest = undefined;
    this.dispatchedRequest = undefined;
    return pending;
  }

  pending(): PanelFocusRequest | undefined { return this.pendingRequest; }
}

export function detachFocusRequest(request: PromiseLike<unknown>): void {
  void Promise.resolve(request).catch(() => undefined);
}

export function settleFocusRequest(request: PromiseLike<unknown>, timeoutMs = 250, timer: FocusTimer = setTimeout, clearTimer: FocusTimerClear = clearTimeout): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimer(timeout);
      resolve();
    };
    timeout = timer(finish, timeoutMs);
    Promise.resolve(request).then(finish, finish);
  });
}
