/**
 * Schema.org JSON-LD generators: Organization, WebSite, Product and BreadcrumbList.
 */
import type { BrandConfig } from '@valam/config';
import type { ShopifyProduct } from '@valam/core';
import { brandOrigin } from './meta';
import { stripHtml, fitToLength } from './text';

export type JsonLd = Record<string, unknown>;

const SCHEMA = 'https://schema.org';

export function organizationJsonLd(brand: BrandConfig): JsonLd {
  const origin = brandOrigin(brand);
  const sameAs = [
    ...brand.domains.slice(1).map((d) => `https://${d}`),
    ...(brand.marketplaceUrl ? [brand.marketplaceUrl] : []),
  ];
  return {
    '@context': SCHEMA,
    '@type': 'Organization',
    '@id': `${origin}/#organization`,
    name: brand.brandName,
    url: `${origin}/`,
    logo: brand.seo.ogImage,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: brand.supportEmail,
      areaServed: 'IN',
      availableLanguage: ['en', 'hi'],
    },
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

export function websiteJsonLd(brand: BrandConfig): JsonLd {
  const origin = brandOrigin(brand);
  // WooCommerce search lives at /?s=, Shopify (and our default) at /search?q=.
  const searchPath =
    brand.platform === 'woocommerce'
      ? '/?s={search_term_string}'
      : '/search?q={search_term_string}';
  return {
    '@context': SCHEMA,
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    url: `${origin}/`,
    name: brand.brandName,
    inLanguage: 'en-IN',
    publisher: { '@id': `${origin}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${origin}${searchPath}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** Product JSON-LD with one INR Offer per variant. */
export function productJsonLd(product: ShopifyProduct, brand: BrandConfig): JsonLd {
  const origin = brandOrigin(brand);
  const url = `${origin}/products/${product.handle}`;
  const images = [...product.images].sort((a, b) => a.position - b.position).map((i) => i.src);
  const firstSku = product.variants.find((v) => v.sku)?.sku;
  const description = fitToLength(stripHtml(product.body_html), 5000);

  return {
    '@context': SCHEMA,
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.title,
    url,
    ...(description ? { description } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    sku: firstSku ?? String(product.variants[0]?.id ?? product.id),
    brand: { '@type': 'Brand', name: brand.brandName },
    ...(product.product_type ? { category: product.product_type } : {}),
    offers: product.variants.map((variant) => ({
      '@type': 'Offer',
      ...(variant.sku ? { sku: variant.sku } : {}),
      name: variant.title,
      url: `${url}?variant=${variant.id}`,
      price: Number(variant.price).toFixed(2),
      priceCurrency: 'INR',
      availability: variant.available ? `${SCHEMA}/InStock` : `${SCHEMA}/OutOfStock`,
      itemCondition: `${SCHEMA}/NewCondition`,
      seller: { '@id': `${origin}/#organization` },
    })),
  };
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]): JsonLd {
  return {
    '@context': SCHEMA,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** Breadcrumbs Home › Collection › Product for a product page. */
export function productBreadcrumbs(
  product: ShopifyProduct,
  brand: BrandConfig,
  collection?: { title: string; handle: string },
): BreadcrumbItem[] {
  const origin = brandOrigin(brand);
  return [
    { name: 'Home', url: `${origin}/` },
    ...(collection
      ? [{ name: collection.title, url: `${origin}/collections/${collection.handle}` }]
      : []),
    { name: product.title, url: `${origin}/products/${product.handle}` },
  ];
}

/** Serialises JSON-LD into a <script> tag; `<` is escaped so "</script>" cannot break out. */
export function renderJsonLd(data: JsonLd | JsonLd[]): string {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
