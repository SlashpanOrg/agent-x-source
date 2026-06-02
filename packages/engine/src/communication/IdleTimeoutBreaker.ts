export class IdleTimeoutBreaker {
  private consecutiveTimeouts = 0;
  private readonly maxConsecutive: number;

  constructor(maxConsecutive = 5) {
    this.maxConsecutive = maxConsecutive;
  }

  step(): void {
    this.consecutiveTimeouts++;
  }

  shouldBreak(): boolean {
    return this.consecutiveTimeouts >= this.maxConsecutive;
  }

  reset(): void {
    this.consecutiveTimeouts = 0;
  }

  getCount(): number {
    return this.consecutiveTimeouts;
  }

  getMax(): number {
    return this.maxConsecutive;
  }
}
