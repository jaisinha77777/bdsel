/**
 * "Polite" HTTP client used for every outbound request to a client store.
 *
 * Guarantees:
 *  - Only hosts from config/brands.ts (and their www. variants) are contacted.
 *  - robots.txt is fetched once per origin and honoured (RFC 9309 semantics:
 *    4xx => allow all, 5xx => disallow all).
 *  - Requests to the same host are spaced by `minIntervalMs`.
 *  - Every request carries a descriptive User-Agent with a contact address.
 *  - 429/503 responses are retried a bounded number of times, honouring Retry-After.
 */
import { allowedHosts as configuredHosts } from '@valam/config';
import { HostRateLimiter, realClock, type Clock } from './rate-limiter';
import { ALLOW_ALL, DISALLOW_ALL, isPathAllowed, parseRobotsTxt, type RobotsTxt } from './robots';

/** Same shape as the global fetch, narrowed to string URLs. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Product token matched against robots.txt user-agent groups. */
export const ROBOTS_TOKEN = 'ValamStoreToolkit';

/** Builds the User-Agent header sent with every request. */
export function buildUserAgent(contact = 'devops@example.com'): string {
  return `${ROBOTS_TOKEN}/1.0 (+https://github.com/jaisinha77777/bdsel; ${contact})`;
}

export class HostNotAllowedError extends Error {
  constructor(public readonly url: string) {
    super(`Refusing to fetch ${url}: host is not a configured brand domain`);
    this.name = 'HostNotAllowedError';
  }
}

export class RobotsDisallowedError extends Error {
  constructor(public readonly url: string) {
    super(`robots.txt disallows fetching ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

export interface PoliteFetcherOptions {
  /** Underlying fetch implementation (defaults to global fetch). */
  baseFetch?: Fetcher;
  userAgent?: string;
  /** Minimum gap between two requests to the same host. Default 1000 ms. */
  minIntervalMs?: number;
  /** Per-request timeout. Default 15000 ms. */
  timeoutMs?: number;
  /** Hosts that may be contacted; `null` disables the allowlist (tests only). */
  allowedHosts?: ReadonlySet<string> | null;
  /** Whether to check robots.txt before each request. Default true. */
  respectRobots?: boolean;
  /** Retries for 429/503. Default 2. */
  maxRetries?: number;
  /** Upper bound for honouring Retry-After, in ms. Default 30000. */
  maxRetryAfterMs?: number;
  clock?: Clock;
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Creates a fetcher that enforces the toolkit's crawling etiquette. */
export function createPoliteFetcher(options: PoliteFetcherOptions = {}): Fetcher {
  const baseFetch: Fetcher = options.baseFetch ?? ((url, init) => fetch(url, init));
  const userAgent = options.userAgent ?? buildUserAgent();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const hosts = options.allowedHosts === undefined ? configuredHosts() : options.allowedHosts;
  const respectRobots = options.respectRobots ?? true;
  const maxRetries = options.maxRetries ?? 2;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 30_000;
  const clock = options.clock ?? realClock;
  const limiter = new HostRateLimiter(options.minIntervalMs ?? 1000, clock);
  const robotsCache = new Map<string, Promise<RobotsTxt>>();

  /** One rate-limited, timed-out request with our headers. */
  async function rawRequest(url: URL, init: RequestInit = {}): Promise<Response> {
    await limiter.acquire(url.host);
    const headers = new Headers(init.headers);
    headers.set('User-Agent', userAgent);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return baseFetch(url.toString(), { ...init, headers, signal });
  }

  /** Loads (and caches) robots.txt for an origin. Network errors are not cached. */
  function robotsFor(url: URL): Promise<RobotsTxt> {
    const cached = robotsCache.get(url.origin);
    if (cached) return cached;
    const pending = (async () => {
      const response = await rawRequest(new URL('/robots.txt', url.origin));
      if (response.ok) return parseRobotsTxt(await response.text());
      if (response.status >= 500) return DISALLOW_ALL;
      return ALLOW_ALL;
    })();
    robotsCache.set(url.origin, pending);
    pending.catch(() => robotsCache.delete(url.origin));
    return pending;
  }

  return async function politeFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input);
    if (hosts && !hosts.has(url.hostname)) {
      throw new HostNotAllowedError(input);
    }
    if (respectRobots && url.pathname !== '/robots.txt') {
      const robots = await robotsFor(url);
      if (!isPathAllowed(robots, ROBOTS_TOKEN, url.pathname + url.search)) {
        throw new RobotsDisallowedError(input);
      }
    }

    for (let attempt = 0; ; attempt++) {
      const response = await rawRequest(url, init);
      const retryable = response.status === 429 || response.status === 503;
      if (!retryable || attempt >= maxRetries) return response;
      const wait =
        parseRetryAfter(response.headers.get('retry-after'), clock.now()) ?? 2000 * (attempt + 1);
      if (wait > maxRetryAfterMs) return response;
      // Drain the body so the connection can be reused before waiting.
      await response.arrayBuffer().catch(() => undefined);
      await clock.sleep(wait);
    }
  };
}

/** Error thrown when a JSON endpoint answers with a non-2xx status. */
export class HttpStatusError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`GET ${url} failed with HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

/** GETs a URL and parses JSON, throwing HttpStatusError on non-2xx responses. */
export async function getJson<T>(fetcher: Fetcher, url: string): Promise<T> {
  const response = await fetcher(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new HttpStatusError(url, response.status);
  }
  return (await response.json()) as T;
}

/** GETs a URL and returns its body as text, throwing HttpStatusError on non-2xx. */
export async function getText(fetcher: Fetcher, url: string): Promise<string> {
  const response = await fetcher(url, { headers: { Accept: 'text/html,*/*;q=0.8' } });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new HttpStatusError(url, response.status);
  }
  return response.text();
}
