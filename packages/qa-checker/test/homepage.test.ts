import { describe, expect, it } from 'vitest';
import { BRANDS } from '@valam/config';
import { createPoliteFetcher } from '@valam/core';
import { createFixtureFetcher, readFixture } from '@valam/core/testing';
import {
  analyzeHomepageHtml,
  checkLinks,
  findBannedStrings,
  findFreeShippingAmounts,
  findPlaceholders,
  homepageFindings,
} from '../src/homepage';

const checks = (findings: Array<{ check: string }>) => findings.map((f) => f.check);

describe('homepage analysers', () => {
  it('finds another brand’s name on Manpasand', () => {
    expect(
      findBannedStrings(readFixture('manpasand', 'homepage.html'), BRANDS.manpasand.bannedStrings),
    ).toEqual(['Shibori Indian']);
    expect(
      findBannedStrings(readFixture('shibori', 'homepage.html'), BRANDS.shibori.bannedStrings),
    ).toEqual([]);
  });

  it('finds unrendered placeholders on Cafora', () => {
    expect(findPlaceholders(readFixture('cafora', 'homepage.html'))).toEqual([
      '{PRODUCT}',
      '{PRICE}',
    ]);
    expect(findPlaceholders('<p>Hello %%sitename%% and {{ product.title }}</p>')).toEqual([
      '%%sitename%%',
      '{{ product.title }}',
    ]);
  });

  it('collects free-shipping amounts', () => {
    expect(findFreeShippingAmounts(readFixture('cafora', 'homepage.html'))).toEqual([999, 1500]);
    expect(findFreeShippingAmounts(readFixture('westernvastr', 'homepage.html'))).toEqual([
      799, 999,
    ]);
    expect(findFreeShippingAmounts(readFixture('manpasand', 'homepage.html'))).toEqual([1499]);
  });

  it('turns Manpasand’s homepage into findings', () => {
    const summary = {
      ...analyzeHomepageHtml(readFixture('manpasand', 'homepage.html'), BRANDS.manpasand),
      navLinks: [],
    };
    expect(checks(homepageFindings(summary, BRANDS.manpasand))).toEqual([
      'meta-description',
      'title',
      'banned-string',
    ]);
  });

  it('flags conflicting and mismatched free-shipping thresholds', () => {
    const vastr = {
      ...analyzeHomepageHtml(readFixture('westernvastr', 'homepage.html'), BRANDS.westernvastr),
      navLinks: [],
    };
    expect(checks(homepageFindings(vastr, BRANDS.westernvastr))).toContain(
      'free-shipping-conflict',
    );
    // Shibori's page advertises ₹999; checked against Padma BYD's ₹1,199 config it must mismatch.
    const shibori = {
      ...analyzeHomepageHtml(readFixture('shibori', 'homepage.html'), BRANDS.shibori),
      navLinks: [],
    };
    expect(checks(homepageFindings(shibori, BRANDS.shibori))).toEqual([]);
    const mismatch = homepageFindings(shibori, BRANDS.padmabyd);
    expect(checks(mismatch)).toContain('free-shipping-mismatch');
  });
});

describe('checkLinks', () => {
  it('HEADs links, falls back to GET on 405, skips robots-disallowed paths', async () => {
    const base = createFixtureFetcher({
      'https://shibori.in/robots.txt': { body: readFixture('shibori', 'robots.txt') },
      'https://shibori.in/collections/a': { status: 200 },
      'https://shibori.in/collections/b': (_url, init) => ({
        status: init?.method === 'HEAD' ? 405 : 200,
      }),
      'https://shibori.in/old': { status: 301, headers: { location: 'https://shibori.in/new' } },
    });
    const fetcher = createPoliteFetcher({ baseFetch: base, minIntervalMs: 0 });
    const results = await checkLinks(
      [
        'https://shibori.in/collections/a',
        'https://shibori.in/collections/b',
        'https://shibori.in/old',
        'https://shibori.in/missing',
        'https://shibori.in/cart',
      ],
      fetcher,
    );
    expect(results.map((r) => [r.status, r.ok])).toEqual([
      [200, true],
      [200, true],
      [301, true],
      [404, false],
      [null, true],
    ]);
    expect(results[2]?.note).toBe('redirects to https://shibori.in/new');
    expect(results[4]?.note).toMatch(/robots/);
    expect(
      base.requests.filter((r) => r.url.endsWith('/collections/b')).map((r) => r.method),
    ).toEqual(['HEAD', 'GET']);
  });
});
