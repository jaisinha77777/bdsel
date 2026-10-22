import { describe, expect, it } from 'vitest';
import {
  HostNotAllowedError,
  RobotsDisallowedError,
  buildUserAgent,
  createPoliteFetcher,
  parseRetryAfter,
} from '../src/http';
import { createFixtureFetcher, readFixture } from '../src/testing';

const noWait = { now: () => 0, sleep: async () => undefined };

describe('createPoliteFetcher', () => {
  it('sends the toolkit User-Agent and fetches robots.txt once per origin', async () => {
    const seenAgents: string[] = [];
    const base = createFixtureFetcher({
      'https://shibori.in/robots.txt': { body: readFixture('shibori', 'robots.txt') },
      'https://shibori.in/': (_url, init) => {
        seenAgents.push(new Headers(init?.headers).get('user-agent') ?? '');
        return { body: 'ok' };
      },
    });
    const fetcher = createPoliteFetcher({
      baseFetch: base,
      minIntervalMs: 0,
      userAgent: buildUserAgent('qa@example.com'),
    });
    await fetcher('https://shibori.in/');
    await fetcher('https://shibori.in/');
    expect(seenAgents[0]).toMatch(/^ValamStoreToolkit\/1\.0 .*qa@example\.com/);
    expect(base.requests.filter((r) => r.url.endsWith('/robots.txt'))).toHaveLength(1);
  });

  it('refuses hosts that are not brand domains', async () => {
    const fetcher = createPoliteFetcher({ baseFetch: createFixtureFetcher({}), minIntervalMs: 0 });
    await expect(fetcher('https://example.com/')).rejects.toBeInstanceOf(HostNotAllowedError);
  });

  it('refuses paths disallowed by robots.txt', async () => {
    const base = createFixtureFetcher({
      'https://shibori.in/robots.txt': { body: readFixture('shibori', 'robots.txt') },
    });
    const fetcher = createPoliteFetcher({ baseFetch: base, minIntervalMs: 0 });
    await expect(fetcher('https://shibori.in/cart')).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it('treats a 5xx robots.txt as disallow-all and a 404 as allow-all', async () => {
    const base = createFixtureFetcher({
      'https://cafora.in/robots.txt': { status: 503 },
      'https://shibori.in/': { body: 'home' },
    });
    const fetcher = createPoliteFetcher({ baseFetch: base, minIntervalMs: 0, maxRetries: 0 });
    await expect(fetcher('https://cafora.in/')).rejects.toBeInstanceOf(RobotsDisallowedError);
    // shibori.in/robots.txt is not in the route table -> 404 -> allowed.
    expect((await fetcher('https://shibori.in/')).status).toBe(200);
  });

  it('retries 429 responses honouring Retry-After', async () => {
    let calls = 0;
    const base = createFixtureFetcher({
      'https://joyfeel.in/products.json': () =>
        ++calls === 1 ? { status: 429, headers: { 'retry-after': '1' } } : { body: '{}' },
    });
    const fetcher = createPoliteFetcher({
      baseFetch: base,
      minIntervalMs: 0,
      respectRobots: false,
      clock: noWait,
    });
    expect((await fetcher('https://joyfeel.in/products.json')).status).toBe(200);
    expect(calls).toBe(2);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null, 0)).toBeNull();
  });
});
