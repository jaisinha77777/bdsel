/**
 * Writes a brand's static SEO bundle to out/<brand>/seo/:
 *   head.html                 <title>, description, canonical, OG, Twitter, JSON-LD
 *   organization.jsonld.json  Organization schema
 *   website.jsonld.json       WebSite schema
 *   snippets/*.liquid         Shopify snippets (Shopify brands only)
 * Useful for WooCommerce/Amazon landing pages too, which cannot use the Liquid snippets.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrandConfig } from '@valam/config';
import { organizationJsonLd, renderJsonLd, websiteJsonLd } from './jsonld';
import { copySnippets } from './liquid';
import {
  buildHomeMeta,
  buildOpenGraphTags,
  buildTwitterTags,
  homeSocialCard,
  renderBasicHead,
  renderMetaTags,
} from './meta';
import { validateDescription, validateTitle, type SeoIssue } from './validate';

/** Complete <head> markup for the brand homepage. */
export function renderHomeHead(brand: BrandConfig): string {
  const card = homeSocialCard(brand);
  return [
    renderBasicHead(buildHomeMeta(brand), brand.seo.keywords),
    renderMetaTags(buildOpenGraphTags(card)),
    renderMetaTags(buildTwitterTags(card)),
    renderJsonLd([organizationJsonLd(brand), websiteJsonLd(brand)]),
  ].join('\n');
}

/** Validates the configured homepage copy so bad config never reaches a store. */
export function validateBrandSeo(brand: BrandConfig): SeoIssue[] {
  const meta = buildHomeMeta(brand);
  return [...validateTitle(meta.title), ...validateDescription(meta.description)];
}

/** Writes the bundle and returns the files written. Throws if the config fails validation. */
export async function writeSeoBundle(brand: BrandConfig, outDir: string): Promise<string[]> {
  const errors = validateBrandSeo(brand).filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `${brand.id} SEO config is invalid: ${errors.map((e) => e.message).join('; ')}`,
    );
  }
  const dir = join(outDir, brand.id, 'seo');
  await mkdir(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ['head.html', `${renderHomeHead(brand)}\n`],
    ['organization.jsonld.json', `${JSON.stringify(organizationJsonLd(brand), null, 2)}\n`],
    ['website.jsonld.json', `${JSON.stringify(websiteJsonLd(brand), null, 2)}\n`],
  ];
  const written: string[] = [];
  for (const [name, content] of files) {
    const file = join(dir, name);
    await writeFile(file, content, 'utf8');
    written.push(file);
  }
  if (brand.platform === 'shopify') {
    written.push(...(await copySnippets(dir)));
  }
  return written;
}
