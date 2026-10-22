/**
 * Per-key (per-host) rate limiter. Each call to `acquire(key)` reserves the next free
 * slot for that key, so concurrent callers are spaced `minIntervalMs` apart instead of
 * bursting. Reservation happens synchronously, which makes it safe under Promise.all.
 */

/** Injectable clock so tests can run without real waiting. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class HostRateLimiter {
  /** Earliest timestamp at which the next request for a key may start. */
  private readonly nextSlot = new Map<string, number>();

  constructor(
    private readonly minIntervalMs: number,
    private readonly clock: Clock = realClock,
  ) {
    if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
      throw new RangeError(`minIntervalMs must be >= 0, got ${minIntervalMs}`);
    }
  }

  /** Resolves once the caller may send its request for `key`. */
  async acquire(key: string): Promise<void> {
    const now = this.clock.now();
    const slot = Math.max(now, this.nextSlot.get(key) ?? 0);
    this.nextSlot.set(key, slot + this.minIntervalMs);
    const wait = slot - now;
    if (wait > 0) {
      await this.clock.sleep(wait);
    }
  }
}
