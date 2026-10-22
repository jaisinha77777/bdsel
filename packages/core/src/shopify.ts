/**
 * Read-only client for a Shopify storefront's public JSON endpoints:
 *   /products.json, /collections.json, /collections/<handle>/products.json, /products/<handle>.js
 * Lists are paginated with limit=250 until a short page is returned.
 */
import { getJson, type Fetcher } from './http';

export interface ShopifyImage {
  id: number;
  src: string;
  /** Alt text. `undefined` when the feed does not expose alt at all. */
  alt?: string | null;
  position: number;
  width?: number;
  height?: number;
  variant_ids?: number[];
}

export interface ShopifyVariant {
  id: number;
  title: string;
  sku: string | null;
  /** Decimal rupee string, e.g. "2499.00". */
  price: string;
  compare_at_price: string | null;
  available: boolean;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  position?: number;
}

export interface ShopifyOption {
  name: string;
  position: number;
  values: string[];
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  tags: string[];
  published_at?: string;
  created_at?: string;
  updated_at?: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  options: ShopifyOption[];
}

export interface ShopifyCollection {
  id: number;
  title: string;
  handle: string;
  description?: string | null;
  published_at?: string;
  updated_at?: string;
  image?: { src: string; alt?: string | null } | null;
  products_count: number;
}

/** Shape of /products/<handle>.js (the storefront AJAX API). Prices are in paise. */
export interface ShopifyProductJs {
  id: number;
  title: string;
  handle: string;
  description: string | null;
  vendor: string;
  type: string;
  tags: string[] | string;
  published_at?: string;
  created_at?: string;
  variants: Array<{
    id: number;
    title: string;
    sku: string | null;
    price: number;
    compare_at_price: number | null;
    available: boolean;
    option1: string | null;
    option2: string | null;
    option3: string | null;
  }>;
  options: Array<{ name: string; position: number; values: string[] }>;
  media?: Array<{
    id: number;
    src: string;
    alt: string | null;
    position: number;
    width?: number;
    height?: number;
  }>;
  images?: string[];
}

export const PAGE_LIMIT = 250;
/** Hard stop so a misbehaving store can never trap us in an endless loop. */
export const MAX_PAGES = 100;

/** Normalises Shopify tags, which arrive as an array or a comma-separated string. */
export function normaliseTags(tags: string[] | string | null | undefined): string[] {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : tags.split(',');
  return list.map((t) => t.trim()).filter(Boolean);
}

/** Converts paise integers from the AJAX API into the "2499.00" strings used by products.json. */
function paiseToString(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** Converts a /products/<handle>.js payload into the products.json product shape. */
export function fromProductJs(js: ShopifyProductJs): ShopifyProduct {
  const images: ShopifyImage[] = js.media
    ? js.media.map((m) => ({
        id: m.id,
        src: m.src.startsWith('//') ? `https:${m.src}` : m.src,
        alt: m.alt,
        position: m.position,
        width: m.width,
        height: m.height,
      }))
    : (js.images ?? []).map((src, index) => ({
        id: index + 1,
        src: src.startsWith('//') ? `https:${src}` : src,
        position: index + 1,
      }));
  return {
    id: js.id,
    title: js.title,
    handle: js.handle,
    body_html: js.description,
    vendor: js.vendor,
    product_type: js.type,
    tags: normaliseTags(js.tags),
    published_at: js.published_at,
    created_at: js.created_at,
    variants: js.variants.map((v, index) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      price: paiseToString(v.price),
      compare_at_price: v.compare_at_price === null ? null : paiseToString(v.compare_at_price),
      available: v.available,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      position: index + 1,
    })),
    images,
    options: js.options,
  };
}

/** Fetches every page of a paginated list endpoint and concatenates the results. */
async function paginate<T>(
  fetcher: Fetcher,
  baseUrl: string,
  pick: (body: unknown) => T[],
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${baseUrl}?limit=${PAGE_LIMIT}&page=${page}`;
    const items = pick(await getJson<unknown>(fetcher, url));
    all.push(...items);
    if (items.length < PAGE_LIMIT) break;
  }
  return all;
}

/** Read-only client bound to one storefront domain. */
export class ShopifyStorefront {
  readonly origin: string;

  constructor(
    readonly domain: string,
    private readonly fetcher: Fetcher,
  ) {
    this.origin = `https://${domain}`;
  }

  /** Every published product (all pages of /products.json). */
  async products(): Promise<ShopifyProduct[]> {
    const products = await paginate(
      this.fetcher,
      `${this.origin}/products.json`,
      (body) => (body as { products?: ShopifyProduct[] }).products ?? [],
    );
    return products.map((p) => ({ ...p, tags: normaliseTags(p.tags) }));
  }

  /** Every published collection (all pages of /collections.json). */
  async collections(): Promise<ShopifyCollection[]> {
    return paginate(
      this.fetcher,
      `${this.origin}/collections.json`,
      (body) => (body as { collections?: ShopifyCollection[] }).collections ?? [],
    );
  }

  /** Products in one collection (all pages of /collections/<handle>/products.json). */
  async collectionProducts(handle: string): Promise<ShopifyProduct[]> {
    const url = `${this.origin}/collections/${encodeURIComponent(handle)}/products.json`;
    const products = await paginate(
      this.fetcher,
      url,
      (body) => (body as { products?: ShopifyProduct[] }).products ?? [],
    );
    return products.map((p) => ({ ...p, tags: normaliseTags(p.tags) }));
  }

  /** One product with per-variant availability and image alt text, via /products/<handle>.js. */
  async product(handle: string): Promise<ShopifyProduct> {
    const url = `${this.origin}/products/${encodeURIComponent(handle)}.js`;
    return fromProductJs(await getJson<ShopifyProductJs>(this.fetcher, url));
  }
}
