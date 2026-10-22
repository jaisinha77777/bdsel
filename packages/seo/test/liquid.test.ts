import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRANDS } from '@valam/config';
import { writeSeoBundle } from '../src/generate-bundle';
import { readSnippet } from '../src/liquid';

/** Liquid tags must be balanced: every opening block tag needs its end tag. */
function assertBalanced(source: string): void {
  const stack: string[] = [];
  const pairs: Record<string, string> = {
    if: 'endif',
    unless: 'endunless',
    for: 'endfor',
    comment: 'endcomment',
    case: 'endcase',
  };
  for (const match of source.matchAll(/{%-?\s*(\w+)/g)) {
    const tag = match[1]!;
    if (tag in pairs) stack.push(pairs[tag]!);
    else if (Object.values(pairs).includes(tag)) expect(stack.pop()).toBe(tag);
  }
  expect(stack).toEqual([]);
}

describe('Liquid snippets', () => {
  it('seo-meta uses real Shopify objects and is balanced', async () => {
    const source = await readSnippet('seo-meta.liquid');
    for (const object of [
      'shop.name',
      'page_title',
      'canonical_url',
      'page_description',
      'request.page_type',
      'product.price',
    ]) {
      expect(source).toContain(object);
    }
    expect(source).toContain('"@type": "Organization"');
    expect(source).toContain('"@type": "WebSite"');
    assertBalanced(source);
  });

  it('product-schema renders INR offers and breadcrumbs from product/collection', async () => {
    const source = await readSnippet('product-schema.liquid');
    for (const fragment of [
      'product.variants',
      'variant.available',
      'variant.sku',
      'collection.title',
      'shop.currency',
      "default: 'INR'",
      '"@type": "BreadcrumbList"',
    ]) {
      expect(source).toContain(fragment);
    }
    assertBalanced(source);
  });

  it('writes the bundle (with snippets for Shopify, without for WooCommerce)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seo-'));
    await writeSeoBundle(BRANDS.shibori, dir);
    expect((await readdir(join(dir, 'shibori', 'seo', 'snippets'))).sort()).toEqual([
      'product-schema.liquid',
      'seo-meta.liquid',
    ]);
    const woo = await writeSeoBundle(BRANDS.cafora, dir);
    expect(woo.some((f) => f.endsWith('.liquid'))).toBe(false);
  });
});
