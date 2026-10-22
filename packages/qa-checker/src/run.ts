/**
 * Orchestrates a QA run for one brand across all of its storefront domains.
 */
import type { BrandConfig } from '@valam/config';
import { ShopifyStorefront, istDate, type Fetcher, type ShopifyProduct } from '@valam/core';
import { analyzeCatalog, catalogFindings, feedExposesAlt } from './catalog';
import { checkHomepage } from './homepage';
import type { DomainReport, Finding, QaReport } from './types';

export interface QaOptions {
  /** Fetch /products/<handle>.js per product when the feed lacks alt text. */
  deepAlt?: boolean;
  /** Clock override for deterministic reports in tests. */
  now?: Date;
}

/** Shopify catalogue checks for one domain. */
async function shopifyCatalog(
  domain: string,
  fetcher: Fetcher,
  options: QaOptions,
): Promise<{ catalog: DomainReport['catalog']; findings: Finding[] }> {
  const store = new ShopifyStorefront(domain, fetcher);
  try {
    const [products, collections] = [await store.products(), await store.collections()];
    let altProducts: ShopifyProduct[] | undefined;
    if (options.deepAlt && !feedExposesAlt(products)) {
      altProducts = [];
      for (const product of products) altProducts.push(await store.product(product.handle));
    }
    const catalog = analyzeCatalog(products, collections, altProducts);
    return { catalog, findings: catalogFindings(catalog) };
  } catch (error) {
    return {
      catalog: null,
      findings: [
        {
          severity: 'error',
          check: 'catalog-unreachable',
          message: `Product feed failed: ${(error as Error).message}`,
        },
      ],
    };
  }
}

/** Runs every applicable check for a brand and returns the report (nothing is written). */
export async function runQa(
  brand: BrandConfig,
  fetcher: Fetcher,
  options: QaOptions = {},
): Promise<QaReport> {
  const now = options.now ?? new Date();
  const domains: DomainReport[] = [];

  for (const domain of brand.domains) {
    const findings: Finding[] = [];
    let catalog: DomainReport['catalog'] = null;

    if (brand.platform === 'shopify') {
      const result = await shopifyCatalog(domain, fetcher, options);
      catalog = result.catalog;
      findings.push(...result.findings);
    } else if (brand.platform === 'amazon') {
      findings.push({
        severity: 'info',
        check: 'marketplace',
        message: 'Catalogue lives on Amazon.in and is not crawled; only the brand site is checked',
      });
    }

    const homepage = await checkHomepage(`https://${domain}`, brand, fetcher);
    findings.push(...homepage.findings);
    domains.push({ domain, catalog, homepage: homepage.summary, findings });
  }

  const all = domains.flatMap((d) => d.findings);
  return {
    brand: brand.id,
    brandName: brand.brandName,
    platform: brand.platform,
    generatedAt: now.toISOString(),
    date: istDate(now),
    domains,
    summary: {
      errors: all.filter((f) => f.severity === 'error').length,
      warnings: all.filter((f) => f.severity === 'warning').length,
    },
  };
}
