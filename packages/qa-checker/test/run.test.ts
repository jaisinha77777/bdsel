import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRANDS } from '@valam/config';
import { createPoliteFetcher } from '@valam/core';
import {
  createFixtureFetcher,
  readFixture,
  shopifyFixtureRoutes,
  type FixtureRoute,
} from '@valam/core/testing';
import { renderMarkdown, writeReport } from '../src/report';
import { runQa } from '../src/run';

const NOW = new Date('2026-10-22T04:00:00Z');

/** Fixture store plus 200s for the given internal paths (nav targets). */
function store(domain: string, dir: string, okPaths: string[]) {
  const routes: Record<string, FixtureRoute> = shopifyFixtureRoutes(domain, dir);
  for (const path of okPaths) routes[`https://${domain}${path}`] = { status: 200 };
  const base = createFixtureFetcher(routes);
  return { base, fetcher: createPoliteFetcher({ baseFetch: base, minIntervalMs: 0 }) };
}

describe('runQa', () => {
  it('produces the Shibori report', async () => {
    const { fetcher } = store('shibori.in', 'shibori', [
      '/collections/navratri-lehengas',
      '/collections/chaniya-choli',
      '/collections/new-arrivals',
    ]);
    const report = await runQa(BRANDS.shibori, fetcher, { now: NOW });
    expect(report.date).toBe('2026-10-22');
    const domain = report.domains[0]!;
    expect(domain.catalog?.productCount).toBe(5);
    // "/" itself is a nav link (logo): the fixture homepage route answers 200.
    const broken = domain.homepage.navLinks.filter((l) => !l.ok).map((l) => l.url);
    expect(broken).toEqual(['https://shibori.in/pages/about-us']);
    expect(domain.findings.map((f) => f.check).sort()).toEqual(
      ['broken-link', 'empty-collection', 'missing-alt', 'no-images', 'sold-out'].sort(),
    );
    expect(report.summary).toEqual({ errors: 2, warnings: 3 });
  });

  it('produces the Manpasand report with the banned-string leak', async () => {
    const { fetcher } = store('manpasandfashion.in', 'manpasand', [
      '/collections/sarees',
      '/collections/anarkali-gowns',
      '/collections/clearance',
    ]);
    const report = await runQa(BRANDS.manpasand, fetcher, { now: NOW });
    const findings = report.domains[0]!.findings;
    expect(findings.find((f) => f.check === 'banned-string')?.items).toEqual(['Shibori Indian']);
    expect(findings.find((f) => f.check === 'meta-description')?.severity).toBe('error');
  });

  it('produces the Western Vastr report (permanent discount, shipping conflict)', async () => {
    const { fetcher } = store('westernvastr.com', 'westernvastr', [
      '/collections/co-ord-sets',
      '/collections/sale',
    ]);
    const report = await runQa(BRANDS.westernvastr, fetcher, { now: NOW });
    const checks = report.domains[0]!.findings.map((f) => f.check);
    expect(checks).toEqual(
      expect.arrayContaining(['permanent-discount', 'free-shipping-conflict']),
    );
    // www.westernvastr.com has no fixture routes -> its robots.txt 404s (allowed) and the link 404s.
    expect(report.domains[0]!.homepage.navLinks.find((l) => l.url.includes('www.'))?.ok).toBe(
      false,
    );
  });

  it('runs WooCommerce checks for Cafora without touching products.json', async () => {
    const base = createFixtureFetcher({
      'https://cafora.in/robots.txt': { body: readFixture('cafora', 'robots.txt') },
      'https://cafora.in/': { body: readFixture('cafora', 'homepage.html') },
      'https://cafora.in/shop/': { status: 200 },
      'https://cafora.in/product-category/hampers/': { status: 200 },
      'https://cafora.in/contact/': { status: 200 },
    });
    const report = await runQa(
      BRANDS.cafora,
      createPoliteFetcher({ baseFetch: base, minIntervalMs: 0 }),
      { now: NOW },
    );
    expect(report.domains[0]!.catalog).toBeNull();
    expect(report.domains[0]!.findings.map((f) => f.check)).toEqual([
      'placeholder',
      'free-shipping-conflict',
    ]);
    expect(base.requests.some((r) => r.url.includes('products.json'))).toBe(false);
  });

  it('reports an unreachable store instead of throwing', async () => {
    const report = await runQa(
      BRANDS.joyfeel,
      createPoliteFetcher({ baseFetch: createFixtureFetcher({}), minIntervalMs: 0 }),
      { now: NOW },
    );
    expect(report.domains[0]!.findings.map((f) => f.check)).toEqual([
      'catalog-unreachable',
      'homepage-unreachable',
    ]);
  });

  it('writes reports/<brand>-<date>.md and .json', async () => {
    const { fetcher } = store('shibori.in', 'shibori', []);
    const report = await runQa(BRANDS.shibori, fetcher, { now: NOW });
    const dir = await mkdtemp(join(tmpdir(), 'qa-'));
    const files = await writeReport(report, dir);
    expect(files.markdown).toBe(join(dir, 'shibori-2026-10-22.md'));
    const md = await readFile(files.markdown, 'utf8');
    expect(md).toContain('# QA report — Shibori Indian');
    expect(md).toContain('| 🔴 | no-images |');
    expect(JSON.parse(await readFile(files.json, 'utf8'))).toMatchObject({
      brand: 'shibori',
      date: '2026-10-22',
    });
    expect(renderMarkdown(report)).toContain('Nav link');
  });
});
