export class RefreshCoordinator {
  private inFlight?: Promise<void>;
  private pending = false;
  private pendingPreview = false;

  get isInFlight() { return Boolean(this.inFlight); }
  get hasPending() { return this.pending; }

  request(updatePreview: boolean, run: (updatePreview: boolean) => Promise<void>): Promise<void> {
    this.pending = true;
    this.pendingPreview ||= updatePreview;
    if (!this.inFlight) {
      this.inFlight = (async () => {
        try {
          while (this.pending) {
            const preview = this.pendingPreview;
            this.pending = false;
            this.pendingPreview = false;
            await run(preview);
          }
        } finally {
          this.inFlight = undefined;
        }
      })();
    }
    return this.inFlight;
  }
}
