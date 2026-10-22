/**
 * Express API over each Shopify brand's public product feed.
 *
 *   GET /health
 *   GET /brands
 *   GET /:brand/collections
 *   GET /:brand/products?collection=<handle>&inStock=true|false
 *   GET /:brand/products/:handle
 *
 * Upstream responses are cached in memory (default 5 minutes) and every outbound call
 * goes through the injected fetcher, which in production is the rate-limited,
 * robots-aware polite fetcher.
 */
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { BRAND_IDS, BRANDS, shopifyBrands, type BrandConfig, type BrandId } from '@valam/config';
import {
  HttpStatusError,
  RobotsDisallowedError,
  ShopifyStorefront,
  type Fetcher,
} from '@valam/core';
import { TtlCache } from './cache';
import { toCollectionSummary, toProductDetail, toProductSummary } from './transform';

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Shopify handles are lowercase letters, digits and hyphens. */
const HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/;

export interface AppOptions {
  fetcher: Fetcher;
  cacheTtlMs?: number;
  now?: () => number;
}

/** An error that maps directly to an HTTP response. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps an async handler so rejections reach Express's error middleware. */
const route =
  (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    handler(req, res).catch(next);
  };

/** Resolves :brand to a Shopify brand config or throws a 404/501 ApiError. */
function shopifyBrand(param: string): BrandConfig {
  const id = param.toLowerCase();
  if (!(BRAND_IDS as readonly string[]).includes(id)) {
    throw new ApiError(404, `Unknown brand "${param}"`);
  }
  const brand = BRANDS[id as BrandId];
  if (brand.platform !== 'shopify') {
    throw new ApiError(
      501,
      `${brand.brandName} runs on ${brand.platform}; only Shopify feeds are proxied`,
    );
  }
  return brand;
}

/** Validates a Shopify handle parameter. */
function handleParam(value: unknown, name: string): string {
  if (typeof value !== 'string' || !HANDLE.test(value)) {
    throw new ApiError(400, `Invalid ${name}: expected a Shopify handle (a-z, 0-9, -)`);
  }
  return value;
}

/** Parses ?inStock= into true/false/undefined. */
function inStockParam(value: unknown): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new ApiError(400, 'inStock must be true or false');
}

export function createApp(options: AppOptions): express.Express {
  const cache = new TtlCache<unknown>(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, 500, options.now);
  const app = express();
  app.disable('x-powered-by');

  /** Loads through the cache and sets X-Cache so clients can see hits. */
  async function cached<T>(res: Response, key: string, loader: () => Promise<T>): Promise<T> {
    const result = await cache.getOrLoad(key, loader);
    res.setHeader('X-Cache', result.hit ? 'HIT' : 'MISS');
    return result.value as T;
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, cacheEntries: cache.size });
  });

  app.get('/brands', (_req, res) => {
    res.json({
      brands: shopifyBrands().map((b) => ({
        id: b.id,
        brandName: b.brandName,
        domain: b.domains[0],
        category: b.category,
      })),
    });
  });

  app.get(
    '/:brand/collections',
    route(async (req, res) => {
      const brand = shopifyBrand(req.params.brand ?? '');
      const store = new ShopifyStorefront(brand.domains[0]!, options.fetcher);
      const collections = await cached(res, `${store.domain}:collections`, () =>
        store.collections(),
      );
      res.json({
        brand: brand.id,
        count: collections.length,
        collections: collections.map((c) => toCollectionSummary(c, store.origin)),
      });
    }),
  );

  app.get(
    '/:brand/products',
    route(async (req, res) => {
      const brand = shopifyBrand(req.params.brand ?? '');
      const store = new ShopifyStorefront(brand.domains[0]!, options.fetcher);
      const collection =
        req.query.collection === undefined
          ? undefined
          : handleParam(req.query.collection, 'collection');
      const inStock = inStockParam(req.query.inStock);

      const products = collection
        ? await cached(res, `${store.domain}:collection:${collection}`, () =>
            store.collectionProducts(collection),
          )
        : await cached(res, `${store.domain}:products`, () => store.products());

      const summaries = products
        .map((p) => toProductSummary(p, store.origin))
        .filter((p) => inStock === undefined || p.inStock === inStock);
      res.json({
        brand: brand.id,
        collection: collection ?? null,
        inStock: inStock ?? null,
        count: summaries.length,
        products: summaries,
      });
    }),
  );

  app.get(
    '/:brand/products/:handle',
    route(async (req, res) => {
      const brand = shopifyBrand(req.params.brand ?? '');
      const handle = handleParam(req.params.handle, 'handle');
      const store = new ShopifyStorefront(brand.domains[0]!, options.fetcher);
      const product = await cached(res, `${store.domain}:product:${handle}`, () =>
        store.product(handle),
      );
      res.json({ brand: brand.id, product: toProductDetail(product, store.origin) });
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error middleware: Express identifies it by its four-argument signature.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof HttpStatusError && error.status === 404) {
      res.status(404).json({ error: 'Not found on storefront' });
    } else if (error instanceof RobotsDisallowedError) {
      res.status(403).json({ error: 'Storefront robots.txt disallows this resource' });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ error: `Upstream storefront error: ${message}` });
    }
  });

  return app;
}
