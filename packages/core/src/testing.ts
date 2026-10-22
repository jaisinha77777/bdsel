/**
 * Test helpers: an in-memory Fetcher that serves fixture files, so no test ever
 * touches the network. Imported by tests via "@valam/core/testing".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Fetcher } from './http';
import { repoRoot } from './paths';
import { PAGE_LIMIT, type ShopifyProduct } from './shopify';

/** A canned response: body plus optional status/headers. */
export interface FixtureResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

export type FixtureRoute = FixtureResponse | ((url: URL, init?: RequestInit) => FixtureResponse);

/** In-memory fetcher; records every request for assertions. */
export interface FixtureFetcher extends Fetcher {
  requests: Array<{ url: string; method: string }>;
}

/** Absolute path of a file in fixtures/. */
export function fixturePath(...parts: string[]): string {
  return join(repoRoot(), 'fixtures', ...parts);
}

/** Reads a fixture as UTF-8 text. */
export function readFixture(...parts: string[]): string {
  return readFileSync(fixturePath(...parts), 'utf8');
}

/** Reads and parses a JSON fixture. */
export function readFixtureJson<T>(...parts: string[]): T {
  return JSON.parse(readFixture(...parts)) as T;
}

/**
 * Builds a fetcher from a route table keyed by full URL (including query string).
 * Unknown URLs answer 404.
 */
export function createFixtureFetcher(routes: Record<string, FixtureRoute>): FixtureFetcher {
  const requests: FixtureFetcher['requests'] = [];
  const fetcher = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    requests.push({ url: url.toString(), method: init?.method ?? 'GET' });
    const route = routes[url.toString()];
    const spec: FixtureResponse = route
      ? typeof route === 'function'
        ? route(url, init)
        : route
      : { status: 404, body: 'Not Found' };
    const status = spec.status ?? 200;
    // HEAD responses and 204/304 must not carry a body.
    const body =
      init?.method === 'HEAD' || status === 204 || status === 304 ? null : (spec.body ?? '');
    return new Response(body, { status, headers: spec.headers });
  }) as FixtureFetcher;
  fetcher.requests = requests;
  return fetcher;
}

const json = (value: unknown): FixtureResponse => ({
  body: JSON.stringify(value),
  headers: { 'content-type': 'application/json' },
});

/**
 * Route table for a Shopify fixture store in fixtures/<dir>/:
 *   products.json, collections.json, collection-products.json, homepage.html, robots.txt
 * Page 1 serves the fixture, page 2 an empty list (pagination terminates).
 */
export function shopifyFixtureRoutes(domain: string, dir: string): Record<string, FixtureRoute> {
  const origin = `https://${domain}`;
  const products = readFixtureJson<{ products: ShopifyProduct[] }>(dir, 'products.json').products;
  const collections = readFixtureJson<{ collections: unknown[] }>(dir, 'collections.json');
  const membership = readFixtureJson<Record<string, string[]>>(dir, 'collection-products.json');
  const page = (n: number) => `?limit=${PAGE_LIMIT}&page=${n}`;

  const routes: Record<string, FixtureRoute> = {
    [`${origin}/robots.txt`]: { body: readFixture(dir, 'robots.txt') },
    [`${origin}/`]: {
      body: readFixture(dir, 'homepage.html'),
      headers: { 'content-type': 'text/html' },
    },
    [`${origin}/products.json${page(1)}`]: json({ products }),
    [`${origin}/products.json${page(2)}`]: json({ products: [] }),
    [`${origin}/collections.json${page(1)}`]: json(collections),
    [`${origin}/collections.json${page(2)}`]: json({ collections: [] }),
  };
  for (const [handle, handles] of Object.entries(membership)) {
    const members = products.filter((p) => handles.includes(p.handle));
    routes[`${origin}/collections/${handle}/products.json${page(1)}`] = json({ products: members });
  }
  // Single-product AJAX endpoint (/products/<handle>.js), prices in paise.
  for (const p of products) {
    routes[`${origin}/products/${p.handle}.js`] = json({
      id: p.id,
      title: p.title,
      handle: p.handle,
      description: p.body_html,
      vendor: p.vendor,
      type: p.product_type,
      tags: p.tags,
      variants: p.variants.map((v) => ({
        ...v,
        price: Math.round(Number(v.price) * 100),
        compare_at_price:
          v.compare_at_price === null ? null : Math.round(Number(v.compare_at_price) * 100),
      })),
      options: p.options,
      media: p.images.map((img) => ({ ...img, alt: img.alt ?? null })),
    });
  }
  return routes;
}
