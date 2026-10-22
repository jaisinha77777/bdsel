import { describe, expect, it } from 'vitest';
import { ALL_BRANDS } from '@valam/config';
import type { ShopifyProduct } from '@valam/core';
import { readFixture, readFixtureJson } from '@valam/core/testing';
import { validateBrandSeo } from '../src/generate-bundle';
import {
  productImagesMissingAlt,
  validateDescription,
  validatePageHtml,
  validateTitle,
} from '../src/validate';

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe('length validators', () => {
  it('enforces 30–60 char titles', () => {
    expect(codes(validateTitle(null))).toEqual(['title-missing']);
    expect(codes(validateTitle('Too short'))).toEqual(['title-too-short']);
    expect(codes(validateTitle('x'.repeat(61)))).toEqual(['title-too-long']);
    expect(validateTitle('x'.repeat(45))).toEqual([]);
  });

  it('enforces 70–160 char descriptions', () => {
    expect(codes(validateDescription(''))).toEqual(['description-missing']);
    expect(codes(validateDescription('x'.repeat(69)))).toEqual(['description-too-short']);
    expect(codes(validateDescription('x'.repeat(161)))).toEqual(['description-too-long']);
    expect(validateDescription('x'.repeat(120))).toEqual([]);
  });

  it('accepts every configured brand homepage copy', () => {
    for (const brand of ALL_BRANDS) expect(validateBrandSeo(brand)).toEqual([]);
  });
});

describe('validatePageHtml', () => {
  it('passes the Shibori homepage on errors', () => {
    const audit = validatePageHtml(readFixture('shibori', 'homepage.html'));
    expect(audit.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(audit.canonical).toBe('https://shibori.in/');
  });

  it('flags Manpasand: short title, no description, image without alt', () => {
    const audit = validatePageHtml(readFixture('manpasand', 'homepage.html'));
    expect(codes(audit.issues)).toEqual(
      expect.arrayContaining([
        'title-too-short',
        'description-missing',
        'img-alt-missing',
        'og-image-missing',
        'jsonld-missing',
      ]),
    );
  });

  it('warns on empty alt for Western Vastr', () => {
    const audit = validatePageHtml(readFixture('westernvastr', 'homepage.html'));
    expect(audit.issues.find((i) => i.code === 'img-alt-empty')?.severity).toBe('warning');
    expect(codes(audit.issues)).not.toContain('title-too-short');
  });

  it('detects invalid JSON-LD', () => {
    const html =
      '<title>' + 'x'.repeat(40) + '</title><script type="application/ld+json">{oops</script>';
    expect(codes(validatePageHtml(html).issues)).toContain('jsonld-invalid');
  });
});

describe('productImagesMissingAlt', () => {
  it('finds null and empty product image alts', () => {
    const shibori = readFixtureJson<{ products: ShopifyProduct[] }>(
      'shibori',
      'products.json',
    ).products;
    const green = shibori.find((p) => p.handle === 'kutch-embroidered-lehenga-green')!;
    expect(productImagesMissingAlt(green)).toHaveLength(1);
    const manpasand = readFixtureJson<{ products: ShopifyProduct[] }>(
      'manpasand',
      'products.json',
    ).products;
    expect(
      productImagesMissingAlt(manpasand.find((p) => p.handle === 'printed-anarkali-gown-ivory')!),
    ).toHaveLength(1);
  });
});
