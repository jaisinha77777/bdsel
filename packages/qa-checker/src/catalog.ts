/**
 * Catalogue checks on Shopify products.json / collections.json data. Pure functions.
 */
import type { ShopifyCollection, ShopifyProduct } from '@valam/core';
import { productImagesMissingAlt } from '@valam/seo';
import type { CatalogSummary, Finding, ProductRef } from './types';

/** compare_at_price on more than this share of variants counts as a "permanent" discount. */
export const PERMANENT_DISCOUNT_THRESHOLD = 0.9;

const ref = (p: { handle: string; title: string }): ProductRef => ({
  handle: p.handle,
  title: p.title,
});

/** A variant is discounted when compare_at_price is set and higher than price. */
export function isDiscounted(variant: { price: string; compare_at_price: string | null }): boolean {
  if (variant.compare_at_price === null || variant.compare_at_price === '') return false;
  return Number(variant.compare_at_price) > Number(variant.price);
}

/** True when no image anywhere in the feed carries an `alt` key (feed does not expose alt). */
export function feedExposesAlt(products: ShopifyProduct[]): boolean {
  return products.some((p) => p.images.some((img) => 'alt' in img));
}

/**
 * Summarises the catalogue. `altProducts` lets the caller supply products re-fetched
 * from /products/<handle>.js when the list feed has no alt text.
 */
export function analyzeCatalog(
  products: ShopifyProduct[],
  collections: ShopifyCollection[],
  altProducts?: ShopifyProduct[],
): CatalogSummary {
  const variants = products.flatMap((p) => p.variants);
  const discounted = variants.filter(isDiscounted).length;
  const ratio = variants.length > 0 ? discounted / variants.length : 0;

  const altSourceProducts = altProducts ?? products;
  const altSource: CatalogSummary['altSource'] = altProducts
    ? 'product-endpoint'
    : feedExposesAlt(products)
      ? 'feed'
      : 'not-exposed';

  return {
    productCount: products.length,
    variantCount: variants.length,
    soldOut: products
      .filter((p) => p.variants.length > 0 && p.variants.every((v) => !v.available))
      .map(ref),
    noImages: products.filter((p) => p.images.length === 0).map(ref),
    missingAlt:
      altSource === 'not-exposed'
        ? []
        : altSourceProducts
            .filter((p) => p.images.length > 0 && productImagesMissingAlt(p).length > 0)
            .map(ref),
    altSource,
    discountedVariantRatio: Math.round(ratio * 1000) / 1000,
    permanentDiscount: ratio > PERMANENT_DISCOUNT_THRESHOLD,
    collectionCount: collections.length,
    emptyCollections: collections.filter((c) => c.products_count === 0).map(ref),
  };
}

/** Turns a catalogue summary into findings. */
export function catalogFindings(summary: CatalogSummary): Finding[] {
  const findings: Finding[] = [];
  const handles = (list: ProductRef[]) => list.map((p) => p.handle);

  if (summary.productCount === 0) {
    findings.push({
      severity: 'error',
      check: 'no-products',
      message: 'products.json returned no products',
    });
  }
  if (summary.soldOut.length > 0) {
    findings.push({
      severity: 'warning',
      check: 'sold-out',
      message: `${summary.soldOut.length} of ${summary.productCount} products are sold out`,
      items: handles(summary.soldOut),
    });
  }
  if (summary.emptyCollections.length > 0) {
    findings.push({
      severity: 'warning',
      check: 'empty-collection',
      message: `${summary.emptyCollections.length} collections have no products`,
      items: handles(summary.emptyCollections),
    });
  }
  if (summary.noImages.length > 0) {
    findings.push({
      severity: 'error',
      check: 'no-images',
      message: `${summary.noImages.length} products have no images`,
      items: handles(summary.noImages),
    });
  }
  if (summary.missingAlt.length > 0) {
    findings.push({
      severity: 'warning',
      check: 'missing-alt',
      message: `${summary.missingAlt.length} products have images without alt text`,
      items: handles(summary.missingAlt),
    });
  }
  if (summary.altSource === 'not-exposed') {
    findings.push({
      severity: 'info',
      check: 'alt-not-checked',
      message:
        'products.json does not expose image alt text; re-run with --deep-alt to check each product',
    });
  }
  if (summary.permanentDiscount) {
    findings.push({
      severity: 'warning',
      check: 'permanent-discount',
      message: `compare_at_price is set on ${(summary.discountedVariantRatio * 100).toFixed(0)}% of variants — looks like a permanent "sale" (consumer-law and trust risk)`,
    });
  }
  return findings;
}
