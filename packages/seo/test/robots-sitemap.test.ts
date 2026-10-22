import { describe, expect, it } from 'vitest';
import { BRANDS } from '@valam/config';
import { createPoliteFetcher } from '@valam/core';
import { createFixtureFetcher, readFixture, shopifyFixtureRoutes } from '@valam/core/testing';
import { auditBrandSeo } from '../src/audit';
import { checkRobotsTxt } from '../src/robots-check';
import { auditSitemap, parseSitemap } from '../src/sitemap';

describe('checkRobotsTxt', () => {
  it('accepts the standard Shopify robots.txt', () => {
    const result = checkRobotsTxt(readFixture('shibori', 'robots.txt'), 'https://shibori.in');
    expect(result.issues).toEqual([]);
    expect(result.sitemaps).toEqual(['https://shibori.in/sitemap.xml']);
  });

  it('flags a site-wide block, a foreign sitemap and a missing file', () => {
    const blocked = checkRobotsTxt(
      'User-agent: *\nDisallow: /\nSitemap: https://shibori.in/sitemap.xml',
      'https://manpasandfashion.in',
    );
    expect(blocked.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['robots-blocks-crawl', 'robots-foreign-sitemap']),
    );
    expect(checkRobotsTxt(null, 'https://joyfeel.in').issues[0]?.code).toBe('robots-missing');
    expect(checkRobotsTxt('User-agent: *\nDisallow:', 'https://joyfeel.in').issues[0]?.code).toBe(
      'robots-no-sitemap',
    );
  });
});

describe('sitemaps', () => {
  it('parses an index and decodes &amp;', () => {
    const parsed = parseSitemap(readFixture('shibori', 'sitemap.xml'));
    expect(parsed.kind).toBe('index');
    expect(parsed.locs[0]).toBe('https://shibori.in/sitemap_products_1.xml?from=1&to=99999');
  });

  it('follows the index, counts URLs and flags foreign hosts', async () => {
    const fetcher = createFixtureFetcher({
      'https://shibori.in/sitemap.xml': { body: readFixture('shibori', 'sitemap.xml') },
      'https://shibori.in/sitemap_products_1.xml?from=1&to=99999': {
        body: readFixture('shibori', 'sitemap_products_1.xml'),
      },
      'https://shibori.in/sitemap_collections_1.xml': {
        body: readFixture('shibori', 'sitemap_collections_1.xml'),
      },
    });
    const audit = await auditSitemap(fetcher, 'https://shibori.in', [
      'https://shibori.in/sitemap.xml',
    ]);
    expect(audit.urlCount).toBe(5);
    expect(audit.sitemaps).toHaveLength(3);
    expect(audit.issues.map((i) => i.code)).toEqual(['sitemap-foreign-url']);
  });

  it('reports an unreachable sitemap', async () => {
    const audit = await auditSitemap(createFixtureFetcher({}), 'https://joyfeel.in');
    expect(audit.issues[0]).toMatchObject({
      code: 'sitemap-unreachable',
      message: 'https://joyfeel.in/sitemap.xml: HTTP 404',
    });
  });
});

describe('auditBrandSeo', () => {
  it('audits Manpasand end-to-end through the polite fetcher', async () => {
    const base = createFixtureFetcher(shopifyFixtureRoutes('manpasandfashion.in', 'manpasand'));
    const fetcher = createPoliteFetcher({ baseFetch: base, minIntervalMs: 0 });
    const result = await auditBrandSeo(BRANDS.manpasand, fetcher);
    expect(result.homepage?.title).toBe('Manpasand Fashion');
    expect(result.errorCount).toBeGreaterThanOrEqual(3);
    // No sitemap fixture is served for Manpasand -> unreachable.
    expect(result.sitemap.issues[0]?.code).toBe('sitemap-unreachable');
  });
});
