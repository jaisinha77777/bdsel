import { describe, expect, it } from 'vitest';
import { HostRateLimiter, type Clock } from '../src/rate-limiter';

/** Frozen fake clock: sleeping returns immediately and records the requested waits. */
function fakeClock(): Clock & { sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => 1_000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
}

describe('HostRateLimiter', () => {
  it('spaces concurrent requests to the same host', async () => {
    const clock = fakeClock();
    const limiter = new HostRateLimiter(500, clock);
    await Promise.all([limiter.acquire('a'), limiter.acquire('a'), limiter.acquire('a')]);
    expect(clock.sleeps).toEqual([500, 1000]);
  });

  it('does not delay different hosts', async () => {
    const clock = fakeClock();
    const limiter = new HostRateLimiter(500, clock);
    await Promise.all([limiter.acquire('a'), limiter.acquire('b')]);
    expect(clock.sleeps).toEqual([]);
  });

  it('rejects negative intervals', () => {
    expect(() => new HostRateLimiter(-1)).toThrow(RangeError);
  });
});
