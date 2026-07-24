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
