import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPoliteFetcher } from '@valam/core';
import {
  createFixtureFetcher,
  shopifyFixtureRoutes,
  type FixtureFetcher,
} from '@valam/core/testing';
import { createApp } from '../src/app';

let server: Server;
let baseUrl: string;
let upstream: FixtureFetcher;

beforeAll(async () => {
  upstream = createFixtureFetcher({
    ...shopifyFixtureRoutes('shibori.in', 'shibori'),
    ...shopifyFixtureRoutes('manpasandfashion.in', 'manpasand'),
    ...shopifyFixtureRoutes('westernvastr.com', 'westernvastr'),
    'https://joyfeel.in/robots.txt': { body: 'User-agent: *\nDisallow:' },
    'https://joyfeel.in/collections.json?limit=250&page=1': { status: 500, body: 'oops' },
  });
  const app = createApp({
    fetcher: createPoliteFetcher({ baseFetch: upstream, minIntervalMs: 0, maxRetries: 0 }),
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(
  path: string,
): Promise<{ status: number; cache: string | null; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    cache: response.headers.get('x-cache'),
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe('product-endpoints API', () => {
  it('lists Shopify brands', async () => {
    const { body } = await get('/brands');
    expect((body.brands as Array<{ id: string }>).map((b) => b.id)).toEqual([
      'shibori',
      'manpasand',
      'westernvastr',
      'joyfeel',
      'padmabyd',
      'crzycozy',
    ]);
  });

  it('serves products and caches the upstream feed', async () => {
    const first = await get('/shibori/products');
    expect(first.status).toBe(200);
    expect(first.cache).toBe('MISS');
    expect(first.body.count).toBe(5);
    const before = upstream.requests.length;
    const second = await get('/shibori/products?inStock=true');
    expect(second.cache).toBe('HIT');
    expect(upstream.requests.length).toBe(before);
    expect((second.body.products as Array<{ handle: string }>).map((p) => p.handle)).not.toContain(
      'bandhani-chaniya-choli-yellow',
    );
    const soldOut = await get('/shibori/products?inStock=false');
    expect((soldOut.body.products as Array<{ handle: string }>).map((p) => p.handle)).toEqual([
      'bandhani-chaniya-choli-yellow',
    ]);
  });

  it('filters by collection', async () => {
    const { body } = await get('/manpasand/products?collection=sarees');
    expect(body.collection).toBe('sarees');
    expect((body.products as Array<{ handle: string }>).map((p) => p.handle)).toEqual([
      'banarasi-silk-saree-maroon',
      'georgette-saree-peach',
    ]);
  });

  it('returns product detail with variants, prices and stock', async () => {
    const { status, body } = await get('/westernvastr/products/linen-co-ord-set-sage');
    expect(status).toBe(200);
    const product = body.product as {
      priceMinINR: number;
      compareAtMaxINR: number;
      variants: Array<{
        title: string;
        priceINR: number;
        compareAtPriceINR: number;
        inStock: boolean;
        options: string[];
      }>;
      images: Array<{ alt: string }>;
    };
    expect(product.priceMinINR).toBe(2299);
    expect(product.compareAtMaxINR).toBe(3999);
    expect(product.variants[0]).toMatchObject({
      title: 'S',
      priceINR: 2299,
      compareAtPriceINR: 3999,
      inStock: true,
      options: ['S'],
    });
    expect(product.images[0]?.alt).toBe('Sage green linen co-ord set');
  });

  it('lists collections with product counts', async () => {
    const { body } = await get('/shibori/collections');
    expect(body.count).toBe(4);
    expect(body.collections).toContainEqual(
      expect.objectContaining({ handle: 'new-arrivals', productsCount: 0 }),
    );
  });

  it('maps errors to sensible status codes', async () => {
    expect((await get('/nope/products')).status).toBe(404);
    expect((await get('/cafora/products')).status).toBe(501);
    expect((await get('/shibori/products?inStock=maybe')).status).toBe(400);
    expect((await get('/shibori/products?collection=../admin')).status).toBe(400);
    expect((await get('/shibori/products/does-not-exist')).status).toBe(404);
    expect((await get('/joyfeel/collections')).status).toBe(502);
  });
});
