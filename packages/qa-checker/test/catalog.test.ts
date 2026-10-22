import { describe, expect, it } from 'vitest';
import type { ShopifyCollection, ShopifyProduct } from '@valam/core';
import { readFixtureJson } from '@valam/core/testing';
import { analyzeCatalog, catalogFindings, isDiscounted } from '../src/catalog';

function load(dir: string): [ShopifyProduct[], ShopifyCollection[]] {
  return [
    readFixtureJson<{ products: ShopifyProduct[] }>(dir, 'products.json').products,
    readFixtureJson<{ collections: ShopifyCollection[] }>(dir, 'collections.json').collections,
  ];
}

describe('analyzeCatalog', () => {
  it('summarises Shibori: sold out, no images, missing alt, empty collection', () => {
    const summary = analyzeCatalog(...load('shibori'));
    expect(summary.productCount).toBe(5);
    expect(summary.variantCount).toBe(10);
    expect(summary.soldOut.map((p) => p.handle)).toEqual(['bandhani-chaniya-choli-yellow']);
    expect(summary.noImages.map((p) => p.handle)).toEqual(['garba-dupatta-multicolour']);
    expect(summary.missingAlt.map((p) => p.handle)).toEqual(['kutch-embroidered-lehenga-green']);
    expect(summary.emptyCollections.map((c) => c.handle)).toEqual(['new-arrivals']);
    expect(summary.discountedVariantRatio).toBe(0.2);
    expect(summary.permanentDiscount).toBe(false);
  });

  it('summarises Manpasand: sold-out saree, empty alt, clearance collection', () => {
    const summary = analyzeCatalog(...load('manpasand'));
    expect(summary.soldOut.map((p) => p.handle)).toEqual(['georgette-saree-peach']);
    expect(summary.missingAlt.map((p) => p.handle)).toEqual(['printed-anarkali-gown-ivory']);
    expect(summary.emptyCollections.map((c) => c.handle)).toEqual(['clearance']);
  });

  it('flags Western Vastr’s permanent discount', () => {
    const summary = analyzeCatalog(...load('westernvastr'));
    expect(summary.discountedVariantRatio).toBe(1);
    expect(summary.permanentDiscount).toBe(true);
    expect(catalogFindings(summary).map((f) => f.check)).toEqual(['permanent-discount']);
  });

  it('reports alt as not exposed when the feed has no alt keys', () => {
    const [products, collections] = load('shibori');
    const stripped = products.map((p) => ({
      ...p,
      images: p.images.map(({ alt: _alt, ...img }) => img),
    }));
    const summary = analyzeCatalog(stripped, collections);
    expect(summary.altSource).toBe('not-exposed');
    expect(summary.missingAlt).toEqual([]);
    expect(catalogFindings(summary).map((f) => f.check)).toContain('alt-not-checked');
    expect(analyzeCatalog(stripped, collections, products).missingAlt).toHaveLength(1);
  });

  it('only counts compare_at_price above price as a discount', () => {
    expect(isDiscounted({ price: '100.00', compare_at_price: '150.00' })).toBe(true);
    expect(isDiscounted({ price: '100.00', compare_at_price: '100.00' })).toBe(false);
    expect(isDiscounted({ price: '100.00', compare_at_price: null })).toBe(false);
  });
});
