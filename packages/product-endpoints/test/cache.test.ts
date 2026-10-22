import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/cache';

describe('TtlCache', () => {
  it('serves hits until the TTL expires', async () => {
    let now = 0;
    let loads = 0;
    const cache = new TtlCache<number>(1000, 10, () => now);
    const loader = async () => ++loads;
    expect(await cache.getOrLoad('k', loader)).toEqual({ value: 1, hit: false });
    now = 999;
    expect(await cache.getOrLoad('k', loader)).toEqual({ value: 1, hit: true });
    now = 1000;
    expect(await cache.getOrLoad('k', loader)).toEqual({ value: 2, hit: false });
  });

  it('shares one in-flight load and never caches failures', async () => {
    const cache = new TtlCache<string>(1000);
    let loads = 0;
    const slow = () =>
      new Promise<string>((resolve) => setTimeout(() => resolve(`v${++loads}`), 5));
    const [a, b] = await Promise.all([cache.getOrLoad('k', slow), cache.getOrLoad('k', slow)]);
    expect([a.value, b.value, loads]).toEqual(['v1', 'v1', 1]);
    await expect(cache.getOrLoad('bad', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect((await cache.getOrLoad('bad', async () => 'ok')).hit).toBe(false);
  });

  it('evicts the oldest entry when full', async () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    expect((await cache.getOrLoad('a', async () => 9)).value).toBe(9);
  });
});
