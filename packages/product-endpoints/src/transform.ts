/**
 * Converts raw Shopify product JSON into the API's compact response shapes.
 */
import type { ShopifyCollection, ShopifyProduct } from '@valam/core';

export interface ProductSummary {
  id: number;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  url: string;
  image: string | null;
  priceMinINR: number;
  priceMaxINR: number;
  compareAtMaxINR: number | null;
  /** True when at least one variant can be bought. */
  inStock: boolean;
  variantCount: number;
}

export interface VariantDetail {
  id: number;
  title: string;
  sku: string | null;
  options: string[];
  priceINR: number;
  compareAtPriceINR: number | null;
  /**
   * Public storefront feeds expose availability only, never inventory counts,
   * so stock is reported as a boolean.
   */
  inStock: boolean;
}

export interface ProductDetail extends ProductSummary {
  descriptionHtml: string | null;
  options: Array<{ name: string; values: string[] }>;
  images: Array<{ src: string; alt: string | null }>;
  variants: VariantDetail[];
}

export interface CollectionSummary {
  id: number;
  handle: string;
  title: string;
  productsCount: number;
  url: string;
  image: string | null;
}

const money = (value: string | null): number | null => {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function toProductSummary(product: ShopifyProduct, origin: string): ProductSummary {
  const prices = product.variants.map((v) => money(v.price) ?? 0);
  const compares = product.variants
    .map((v) => money(v.compare_at_price))
    .filter((n): n is number => n !== null);
  const image = [...product.images].sort((a, b) => a.position - b.position)[0];
  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    productType: product.product_type,
    tags: product.tags,
    url: `${origin}/products/${product.handle}`,
    image: image?.src ?? null,
    priceMinINR: prices.length > 0 ? Math.min(...prices) : 0,
    priceMaxINR: prices.length > 0 ? Math.max(...prices) : 0,
    compareAtMaxINR: compares.length > 0 ? Math.max(...compares) : null,
    inStock: product.variants.some((v) => v.available),
    variantCount: product.variants.length,
  };
}

export function toProductDetail(product: ShopifyProduct, origin: string): ProductDetail {
  return {
    ...toProductSummary(product, origin),
    descriptionHtml: product.body_html,
    options: product.options.map((o) => ({ name: o.name, values: o.values })),
    images: [...product.images]
      .sort((a, b) => a.position - b.position)
      .map((img) => ({ src: img.src, alt: img.alt ?? null })),
    variants: product.variants.map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      options: [v.option1, v.option2, v.option3].filter((o): o is string => o !== null),
      priceINR: money(v.price) ?? 0,
      compareAtPriceINR: money(v.compare_at_price),
      inStock: v.available,
    })),
  };
}

export function toCollectionSummary(
  collection: ShopifyCollection,
  origin: string,
): CollectionSummary {
  return {
    id: collection.id,
    handle: collection.handle,
    title: collection.title,
    productsCount: collection.products_count,
    url: `${origin}/collections/${collection.handle}`,
    image: collection.image?.src ?? null,
  };
}
