import { describe, expect, it } from 'vitest';
import { BRANDS } from '@valam/config';
import type { ShopifyProduct } from '@valam/core';
import { readFixtureJson } from '@valam/core/testing';
import {
  DESCRIPTION_LIMITS,
  TITLE_LIMITS,
  buildHomeMeta,
  buildOpenGraphTags,
  buildProductMeta,
  buildTwitterTags,
  homeSocialCard,
  productSocialCard,
  renderMetaTags,
} from '../src/meta';
import { renderHomeHead } from '../src/generate-bundle';
import { fitToLength, stripHtml } from '../src/text';

const products = (dir: string) =>
  readFixtureJson<{ products: ShopifyProduct[] }>(dir, 'products.json').products;

describe('homepage meta', () => {
  it.each(['shibori', 'manpasand', 'westernvastr'] as const)('fits limits for %s', (id) => {
    const meta = buildHomeMeta(BRANDS[id]);
    expect(meta.title.length).toBeGreaterThanOrEqual(TITLE_LIMITS.min);
    expect(meta.title.length).toBeLessThanOrEqual(TITLE_LIMITS.max);
    expect(meta.description.length).toBeGreaterThanOrEqual(DESCRIPTION_LIMITS.min);
    expect(meta.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMITS.max);
    expect(meta.canonical).toBe(`https://${BRANDS[id].domains[0]}/`);
  });

  it('renders a complete, escaped head for Western Vastr', () => {
    const head = renderHomeHead(BRANDS.westernvastr);
    expect(head).toContain('<title>Western Vastr | Women&#39;s Co-ord Sets Online</title>');
    expect(head).toContain('<meta property="og:type" content="website">');
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(head).toContain('"@type": "Organization"');
    expect(head).not.toContain('Shibori');
  });
});

describe('product meta and social tags', () => {
  const lehenga = products('shibori')[0]!;

  it('builds a product title and description within limits', () => {
    const meta = buildProductMeta(lehenga, BRANDS.shibori);
    expect(meta.title).toBe('Mirror Work Navratri Lehenga - Red | Shibori Indian');
    expect(meta.description).toMatch(
      /^Buy Mirror Work Navratri Lehenga - Red from Shibori Indian at ₹4,999\./,
    );
    expect(meta.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMITS.max);
    expect(meta.canonical).toBe('https://shibori.in/products/mirror-work-navratri-lehenga-red');
  });

  it('emits product OG price tags in INR', () => {
    const tags = buildOpenGraphTags(productSocialCard(lehenga, BRANDS.shibori));
    expect(tags).toContainEqual({ property: 'product:price:amount', content: '4999.00' });
    expect(tags).toContainEqual({ property: 'product:price:currency', content: 'INR' });
    expect(tags).toContainEqual({
      property: 'og:image:alt',
      content: 'Red mirror work Navratri lehenga, front view',
    });
  });

  it('falls back to the brand OG image for products without images', () => {
    const dupatta = products('shibori').find((p) => p.images.length === 0)!;
    expect(productSocialCard(dupatta, BRANDS.shibori).image).toBe(BRANDS.shibori.seo.ogImage);
  });

  it('renders Twitter tags with escaping', () => {
    const card = { ...homeSocialCard(BRANDS.manpasand), title: 'A "quoted" <title>' };
    const html = renderMetaTags(buildTwitterTags(card));
    expect(html).toContain(
      '<meta name="twitter:title" content="A &quot;quoted&quot; &lt;title&gt;">',
    );
  });
});

describe('text helpers', () => {
  it('strips HTML and fits text at word boundaries', () => {
    expect(stripHtml('<p>Silk &amp; zari</p><script>x()</script>')).toBe('Silk & zari');
    expect(fitToLength('one two three four five', 12)).toBe('one two…');
    expect(fitToLength('short', 60)).toBe('short');
  });
});
