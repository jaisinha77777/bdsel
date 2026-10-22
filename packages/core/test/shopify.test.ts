import { describe, expect, it } from 'vitest';
import { PAGE_LIMIT, ShopifyStorefront, normaliseTags } from '../src/shopify';
import { createFixtureFetcher, shopifyFixtureRoutes } from '../src/testing';

describe('ShopifyStorefront', () => {
  it('reads products and collections from the public JSON feeds', async () => {
    const fetcher = createFixtureFetcher(shopifyFixtureRoutes('shibori.in', 'shibori'));
    const store = new ShopifyStorefront('shibori.in', fetcher);
    expect(await store.products()).toHaveLength(5);
    expect((await store.collections()).map((c) => c.handle)).toContain('new-arrivals');
    expect(fetcher.requests[0]?.url).toBe(
      `https://shibori.in/products.json?limit=${PAGE_LIMIT}&page=1`,
    );
  });

  it('paginates until a short page is returned', async () => {
    const full = Array.from({ length: PAGE_LIMIT }, (_, i) => ({
      id: i,
      handle: `p${i}`,
      tags: [],
    }));
    const fetcher = createFixtureFetcher({
      [`https://joyfeel.in/products.json?limit=${PAGE_LIMIT}&page=1`]: {
        body: JSON.stringify({ products: full }),
      },
      [`https://joyfeel.in/products.json?limit=${PAGE_LIMIT}&page=2`]: {
        body: JSON.stringify({ products: [{ id: 999, handle: 'last', tags: 'a, b' }] }),
      },
    });
    const products = await new ShopifyStorefront('joyfeel.in', fetcher).products();
    expect(products).toHaveLength(PAGE_LIMIT + 1);
    expect(products.at(-1)?.tags).toEqual(['a', 'b']);
    expect(fetcher.requests).toHaveLength(2);
  });

  it('normalises the AJAX product endpoint (paise -> rupees, media alt)', async () => {
    const fetcher = createFixtureFetcher(shopifyFixtureRoutes('westernvastr.com', 'westernvastr'));
    const product = await new ShopifyStorefront('westernvastr.com', fetcher).product(
      'linen-co-ord-set-sage',
    );
    expect(product.variants[0]?.price).toBe('2299.00');
    expect(product.variants[0]?.compare_at_price).toBe('3999.00');
    expect(product.images[0]?.alt).toBe('Sage green linen co-ord set');
  });

  it('normalises tag strings and arrays', () => {
    expect(normaliseTags(' a, b ,,c')).toEqual(['a', 'b', 'c']);
    expect(normaliseTags(['x'])).toEqual(['x']);
    expect(normaliseTags(null)).toEqual([]);
  });
});
