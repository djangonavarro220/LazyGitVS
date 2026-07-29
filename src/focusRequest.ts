export type FocusTimer = (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
export type FocusTimerClear = (timer: ReturnType<typeof setTimeout>) => void;

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
