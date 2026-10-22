// Sanity checks on the brand registry itself.
import { describe, expect, it } from 'vitest';
import { ALL_BRANDS, BRAND_IDS, allowedHosts, resolveBrand, shopifyBrands } from './brands';

describe('brand registry', () => {
  it('defines all eight brands in order', () => {
    expect(ALL_BRANDS.map((b) => b.id)).toEqual([...BRAND_IDS]);
  });

  it('never bans a brand from its own site but bans every other brand', () => {
    for (const brand of ALL_BRANDS) {
      expect(brand.bannedStrings).not.toContain(brand.brandName);
      expect(brand.bannedStrings).toHaveLength(ALL_BRANDS.length - 1);
    }
  });

  it('keeps coupon ladders ascending and SEO copy within limits', () => {
    for (const brand of ALL_BRANDS) {
      const mins = brand.couponLadder.map((t) => t.minCartINR);
      expect(mins).toEqual([...mins].sort((a, b) => a - b));
      expect(brand.seo.homeTitle.length).toBeGreaterThanOrEqual(30);
      expect(brand.seo.homeTitle.length).toBeLessThanOrEqual(60);
      expect(brand.seo.homeDescription.length).toBeGreaterThanOrEqual(70);
      expect(brand.seo.homeDescription.length).toBeLessThanOrEqual(160);
    }
  });

  it('resolves brands by id, name or domain', () => {
    expect(resolveBrand('shibori').id).toBe('shibori');
    expect(resolveBrand('Western Vastr').id).toBe('westernvastr');
    expect(resolveBrand('uk.crzycozy.com').id).toBe('crzycozy');
    expect(() => resolveBrand('nope')).toThrow(/Unknown brand/);
  });

  it('lists the six Shopify brands and allows www variants', () => {
    expect(shopifyBrands()).toHaveLength(6);
    expect(allowedHosts().has('www.cafora.in')).toBe(true);
    expect(allowedHosts().has('example.com')).toBe(false);
  });
});
