import { describe, expect, it } from 'vitest';
import { BRANDS } from '@valam/config';
import type { ShopifyProduct } from '@valam/core';
import { readFixtureJson } from '@valam/core/testing';
import {
  breadcrumbJsonLd,
  organizationJsonLd,
  productBreadcrumbs,
  productJsonLd,
  renderJsonLd,
  websiteJsonLd,
} from '../src/jsonld';

const products = (dir: string) =>
  readFixtureJson<{ products: ShopifyProduct[] }>(dir, 'products.json').products;

describe('Organization and WebSite JSON-LD', () => {
  it('describes Manpasand with a support contact and search action', () => {
    const org = organizationJsonLd(BRANDS.manpasand);
    expect(org).toMatchObject({
      '@type': 'Organization',
      name: 'Manpasand Fashion',
      url: 'https://manpasandfashion.in/',
    });
    const site = websiteJsonLd(BRANDS.manpasand);
    expect(site).toMatchObject({
      potentialAction: {
        target: { urlTemplate: 'https://manpasandfashion.in/search?q={search_term_string}' },
      },
    });
  });

  it('lists extra storefronts and marketplaces as sameAs', () => {
    expect(organizationJsonLd(BRANDS.crzycozy).sameAs).toEqual([
      'https://us.crzycozy.com',
      'https://uk.crzycozy.com',
    ]);
    expect(organizationJsonLd(BRANDS.cruxfab).sameAs).toEqual([
      'https://www.amazon.in/s?k=CRUXFAB',
    ]);
    expect(websiteJsonLd(BRANDS.cafora)).toMatchObject({
      potentialAction: { target: { urlTemplate: 'https://cafora.in/?s={search_term_string}' } },
    });
  });
});

describe('Product JSON-LD', () => {
  it('builds INR offers with per-variant availability for Shibori', () => {
    const ld = productJsonLd(products('shibori')[0]!, BRANDS.shibori) as {
      sku: string;
      brand: { name: string };
      image: string[];
      offers: Array<{ price: string; priceCurrency: string; availability: string; sku: string }>;
    };
    expect(ld.sku).toBe('SHB-LHG-RED-S');
    expect(ld.brand.name).toBe('Shibori Indian');
    expect(ld.image).toHaveLength(2);
    expect(ld.offers.map((o) => o.availability)).toEqual([
      'https://schema.org/InStock',
      'https://schema.org/InStock',
      'https://schema.org/OutOfStock',
    ]);
    expect(ld.offers.every((o) => o.priceCurrency === 'INR' && o.price === '4999.00')).toBe(true);
  });

  it('omits image when a product has none and uses Western Vastr pricing', () => {
    const dupatta = products('shibori').find((p) => p.images.length === 0)!;
    expect(productJsonLd(dupatta, BRANDS.shibori)).not.toHaveProperty('image');
    const coord = productJsonLd(products('westernvastr')[0]!, BRANDS.westernvastr) as {
      offers: Array<{ price: string }>;
    };
    expect(coord.offers[0]?.price).toBe('2299.00');
  });
});

describe('BreadcrumbList JSON-LD', () => {
  it('numbers Home › Collection › Product', () => {
    const product = products('manpasand')[0]!;
    const ld = breadcrumbJsonLd(
      productBreadcrumbs(product, BRANDS.manpasand, { title: 'Sarees', handle: 'sarees' }),
    ) as {
      itemListElement: Array<{ position: number; name: string; item: string }>;
    };
    expect(ld.itemListElement.map((i) => [i.position, i.name])).toEqual([
      [1, 'Home'],
      [2, 'Sarees'],
      [3, 'Banarasi Silk Saree - Maroon'],
    ]);
    expect(ld.itemListElement[1]?.item).toBe('https://manpasandfashion.in/collections/sarees');
  });

  it('escapes </script> inside JSON-LD', () => {
    const html = renderJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('\\u003c/script>');
  });
});
