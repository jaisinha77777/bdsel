import { describe, expect, it } from 'vitest';
import { BRANDS } from '@valam/config';
import { createPoliteFetcher } from '@valam/core';
import { createFixtureFetcher, readFixture, type FixtureRoute } from '@valam/core/testing';
import { checkAll, checkDomain, isPasswordPage, isShopifyUnavailablePage } from '../src/check';

const UNAVAILABLE =
  '<html><head><title>Store unavailable</title></head><body><h1>Sorry, this store is currently unavailable.</h1></body></html>';
const PASSWORD =
  '<html><body class="template-password"><form method="post" action="/password"></form></body></html>';

const okDns = async () => undefined;
const failDns = async () => {
  throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
};

function deps(routes: Record<string, FixtureRoute>, resolveDns = okDns) {
  const fetcher = createPoliteFetcher({
    baseFetch: createFixtureFetcher(routes),
    minIntervalMs: 0,
    maxRetries: 0,
  });
  return { fetcher, resolveDns, now: () => 1_000 };
}

describe('page detectors', () => {
  it('recognises Shopify unavailable and password pages', () => {
    expect(isShopifyUnavailablePage(UNAVAILABLE)).toBe(true);
    expect(isShopifyUnavailablePage(readFixture('shibori', 'homepage.html'))).toBe(false);
    expect(isPasswordPage(PASSWORD, 'https://joyfeel.in/')).toBe(true);
    expect(isPasswordPage('<html></html>', 'https://joyfeel.in/password')).toBe(true);
    expect(isPasswordPage('<html></html>', 'https://joyfeel.in/')).toBe(false);
  });
});

describe('checkDomain', () => {
  it('reports a healthy store as up', async () => {
    const r = await checkDomain(
      BRANDS.shibori,
      'shibori.in',
      deps({ 'https://shibori.in/': { body: readFixture('shibori', 'homepage.html') } }),
    );
    expect(r).toMatchObject({
      status: 'up',
      httpStatus: 200,
      domain: 'shibori.in',
      brandName: 'Shibori Indian',
    });
  });

  it('detects DNS failures before fetching', async () => {
    const r = await checkDomain(BRANDS.manpasand, 'manpasandfashion.in', deps({}, failDns));
    expect(r).toMatchObject({ status: 'dns_failure', httpStatus: null });
    expect(r.detail).toContain('ENOTFOUND');
  });

  it('detects HTTP errors', async () => {
    const r = await checkDomain(
      BRANDS.westernvastr,
      'westernvastr.com',
      deps({ 'https://westernvastr.com/': { status: 502, body: 'Bad gateway' } }),
    );
    expect(r).toMatchObject({ status: 'http_error', httpStatus: 502 });
  });

  it('detects the Shopify "store unavailable" page even with a 402', async () => {
    const r = await checkDomain(
      BRANDS.joyfeel,
      'joyfeel.in',
      deps({ 'https://joyfeel.in/': { status: 402, body: UNAVAILABLE } }),
    );
    expect(r).toMatchObject({ status: 'store_unavailable', httpStatus: 402 });
  });

  it('detects the password page', async () => {
    const r = await checkDomain(
      BRANDS.padmabyd,
      'padmabyd.com',
      deps({ 'https://padmabyd.com/': { body: PASSWORD } }),
    );
    expect(r.status).toBe('password_protected');
  });

  it('classifies fetch-level DNS errors and generic network errors', async () => {
    const dnsFetch = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } });
    };
    const reset = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    };
    expect(
      (await checkDomain(BRANDS.cafora, 'cafora.in', { fetcher: dnsFetch, resolveDns: okDns }))
        .status,
    ).toBe('dns_failure');
    expect(
      (await checkDomain(BRANDS.cafora, 'cafora.in', { fetcher: reset, resolveDns: okDns })).detail,
    ).toBe('ECONNRESET');
  });

  it('classifies timeouts and robots blocks', async () => {
    const timeout = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    expect(
      (await checkDomain(BRANDS.cruxfab, 'cruxfab.in', { fetcher: timeout, resolveDns: okDns }))
        .status,
    ).toBe('timeout');
    const blocked = await checkDomain(
      BRANDS.cafora,
      'cafora.in',
      deps({ 'https://cafora.in/robots.txt': { status: 500 } }),
    );
    expect(blocked.status).toBe('robots_blocked');
  });

  it('checks every domain of a multi-storefront brand', async () => {
    const page = { body: '<html><title>ok</title></html>' };
    const results = await checkAll(
      [BRANDS.crzycozy],
      deps({
        'https://crzycozy.in/': page,
        'https://us.crzycozy.com/': page,
        'https://uk.crzycozy.com/': { status: 503 },
      }),
    );
    expect(results.map((r) => [r.domain, r.status])).toEqual([
      ['crzycozy.in', 'up'],
      ['us.crzycozy.com', 'up'],
      ['uk.crzycozy.com', 'http_error'],
    ]);
  });
});
