/**
 * Generators for <title>, meta description, canonical, Open Graph and Twitter tags.
 */
import type { BrandConfig } from '@valam/config';
import { escapeHtml, formatINR, type ShopifyProduct } from '@valam/core';
import { fitToLength, stripHtml } from './text';

export const TITLE_LIMITS = { min: 30, max: 60 } as const;
export const DESCRIPTION_LIMITS = { min: 70, max: 160 } as const;

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
}

/** Primary origin of a brand, e.g. "https://shibori.in". */
export function brandOrigin(brand: BrandConfig): string {
  const domain = brand.domains[0];
  if (!domain) throw new Error(`${brand.id} has no domains configured`);
  return `https://${domain}`;
}

/** Homepage title/description/canonical straight from the brand config. */
export function buildHomeMeta(brand: BrandConfig): PageMeta {
  return {
    title: fitToLength(brand.seo.homeTitle, TITLE_LIMITS.max),
    description: fitToLength(brand.seo.homeDescription, DESCRIPTION_LIMITS.max),
    canonical: `${brandOrigin(brand)}/`,
  };
}

/** Lowest variant price of a product in rupees. */
export function minPrice(product: ShopifyProduct): number {
  const prices = product.variants.map((v) => Number(v.price)).filter(Number.isFinite);
  return prices.length > 0 ? Math.min(...prices) : 0;
}

/**
 * Product page title/description. The description is the product copy, prefixed with a
 * price/brand lead-in so short descriptions still clear the 70-character minimum.
 */
export function buildProductMeta(product: ShopifyProduct, brand: BrandConfig): PageMeta {
  const suffix = ` | ${brand.brandName}`;
  const title =
    product.title.length + suffix.length <= TITLE_LIMITS.max
      ? `${product.title}${suffix}`
      : fitToLength(product.title, TITLE_LIMITS.max);
  const lead = `Buy ${product.title} from ${brand.brandName} at ${formatINR(minPrice(product))}.`;
  const body = stripHtml(product.body_html);
  return {
    title,
    description: fitToLength(body ? `${lead} ${body}` : lead, DESCRIPTION_LIMITS.max),
    canonical: `${brandOrigin(brand)}/products/${product.handle}`,
  };
}

/** Input shared by the Open Graph and Twitter generators. */
export interface SocialCard {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt?: string;
  siteName: string;
  type: 'website' | 'product';
  /** Product price in INR (only for type "product"). */
  priceINR?: number;
}

/** A single <meta> tag; exactly one of `name` / `property` is set. */
export interface MetaTag {
  name?: string;
  property?: string;
  content: string;
}

export function buildOpenGraphTags(card: SocialCard): MetaTag[] {
  const tags: MetaTag[] = [
    { property: 'og:site_name', content: card.siteName },
    { property: 'og:type', content: card.type },
    { property: 'og:title', content: card.title },
    { property: 'og:description', content: card.description },
    { property: 'og:url', content: card.url },
    { property: 'og:image', content: card.image },
    { property: 'og:image:secure_url', content: card.image },
    { property: 'og:image:alt', content: card.imageAlt ?? card.title },
    { property: 'og:locale', content: 'en_IN' },
  ];
  if (card.type === 'product' && card.priceINR !== undefined) {
    tags.push(
      { property: 'product:price:amount', content: card.priceINR.toFixed(2) },
      { property: 'product:price:currency', content: 'INR' },
    );
  }
  return tags;
}

export function buildTwitterTags(card: SocialCard): MetaTag[] {
  return [
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: card.title },
    { name: 'twitter:description', content: card.description },
    { name: 'twitter:image', content: card.image },
    { name: 'twitter:image:alt', content: card.imageAlt ?? card.title },
  ];
}

/** Social card for the brand homepage. */
export function homeSocialCard(brand: BrandConfig): SocialCard {
  const meta = buildHomeMeta(brand);
  return {
    title: meta.title,
    description: meta.description,
    url: meta.canonical,
    image: brand.seo.ogImage,
    imageAlt: brand.brandName,
    siteName: brand.brandName,
    type: 'website',
  };
}

/** Social card for a product page (falls back to the brand OG image when there is none). */
export function productSocialCard(product: ShopifyProduct, brand: BrandConfig): SocialCard {
  const meta = buildProductMeta(product, brand);
  const image = [...product.images].sort((a, b) => a.position - b.position)[0];
  return {
    title: meta.title,
    description: meta.description,
    url: meta.canonical,
    image: image?.src ?? brand.seo.ogImage,
    imageAlt: image?.alt ?? product.title,
    siteName: brand.brandName,
    type: 'product',
    priceINR: minPrice(product),
  };
}

/** Renders meta tags as HTML, escaping every attribute value. */
export function renderMetaTags(tags: MetaTag[]): string {
  return tags
    .map((tag) => {
      const key =
        tag.property !== undefined
          ? `property="${escapeHtml(tag.property)}"`
          : `name="${escapeHtml(tag.name ?? '')}"`;
      return `<meta ${key} content="${escapeHtml(tag.content)}">`;
    })
    .join('\n');
}

/** Renders <title>, description, canonical and keywords for a page. */
export function renderBasicHead(meta: PageMeta, keywords: string[] = []): string {
  const lines = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}">`,
  ];
  if (keywords.length > 0) {
    lines.push(`<meta name="keywords" content="${escapeHtml(keywords.join(', '))}">`);
  }
  return lines.join('\n');
}
