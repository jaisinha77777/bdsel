/**
 * SEO validators: title/description length, image alt text, and a whole-page check.
 */
import {
  auditImageAlts,
  getJsonLd,
  getMetaContent,
  getTitle,
  parseHtml,
  type ShopifyProduct,
} from '@valam/core';
import { DESCRIPTION_LIMITS, TITLE_LIMITS } from './meta';

export type Severity = 'error' | 'warning';

export interface SeoIssue {
  severity: Severity;
  /** Stable machine-readable code, e.g. "title-too-long". */
  code: string;
  message: string;
}

const issue = (severity: Severity, code: string, message: string): SeoIssue => ({
  severity,
  code,
  message,
});

/** Title must exist and be 30–60 characters. */
export function validateTitle(title: string | null | undefined): SeoIssue[] {
  if (!title || !title.trim()) return [issue('error', 'title-missing', 'Page has no <title>')];
  const length = title.trim().length;
  if (length < TITLE_LIMITS.min) {
    return [
      issue(
        'error',
        'title-too-short',
        `Title is ${length} chars (min ${TITLE_LIMITS.min}): "${title}"`,
      ),
    ];
  }
  if (length > TITLE_LIMITS.max) {
    return [
      issue(
        'error',
        'title-too-long',
        `Title is ${length} chars (max ${TITLE_LIMITS.max}): "${title}"`,
      ),
    ];
  }
  return [];
}

/** Meta description must exist and be 70–160 characters. */
export function validateDescription(description: string | null | undefined): SeoIssue[] {
  if (!description || !description.trim()) {
    return [issue('error', 'description-missing', 'Page has no meta description')];
  }
  const length = description.trim().length;
  if (length < DESCRIPTION_LIMITS.min) {
    return [
      issue(
        'error',
        'description-too-short',
        `Meta description is ${length} chars (min ${DESCRIPTION_LIMITS.min})`,
      ),
    ];
  }
  if (length > DESCRIPTION_LIMITS.max) {
    return [
      issue(
        'error',
        'description-too-long',
        `Meta description is ${length} chars (max ${DESCRIPTION_LIMITS.max})`,
      ),
    ];
  }
  return [];
}

/** Every <img> needs an alt attribute; empty alt is flagged as a warning (decorative only). */
export function validateImageAlts(html: string): SeoIssue[] {
  const audit = auditImageAlts(html);
  return [
    ...audit.missing.map((src) =>
      issue('error', 'img-alt-missing', `<img src="${src}"> has no alt attribute`),
    ),
    ...audit.empty.map((src) =>
      issue('warning', 'img-alt-empty', `<img src="${src}"> has empty alt (OK only if decorative)`),
    ),
  ];
}

/** Product images must all carry non-empty alt text. Returns the offending image srcs. */
export function productImagesMissingAlt(product: ShopifyProduct): string[] {
  return product.images
    .filter((img) => img.alt === undefined || img.alt === null || img.alt.trim() === '')
    .map((img) => img.src);
}

export interface PageAudit {
  title: string | null;
  description: string | null;
  canonical: string | null;
  issues: SeoIssue[];
}

/** Full on-page audit: title, description, canonical, OG basics, JSON-LD validity, alts. */
export function validatePageHtml(html: string): PageAudit {
  const title = getTitle(html);
  const description = getMetaContent(html, 'description');
  const canonical =
    parseHtml(html).querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
  const issues: SeoIssue[] = [...validateTitle(title), ...validateDescription(description)];

  if (!canonical) issues.push(issue('warning', 'canonical-missing', 'No <link rel="canonical">'));
  if (!getMetaContent(html, 'og:title'))
    issues.push(issue('warning', 'og-title-missing', 'No og:title meta tag'));
  if (!getMetaContent(html, 'og:image'))
    issues.push(issue('warning', 'og-image-missing', 'No og:image meta tag'));

  const scripts = parseHtml(html).querySelectorAll('script[type="application/ld+json"]').length;
  const parsed = getJsonLd(html).length;
  if (parsed < scripts) {
    issues.push(
      issue('error', 'jsonld-invalid', `${scripts - parsed} JSON-LD block(s) contain invalid JSON`),
    );
  }
  if (scripts === 0)
    issues.push(issue('warning', 'jsonld-missing', 'No JSON-LD structured data found'));

  issues.push(...validateImageAlts(html));
  return { title, description, canonical, issues };
}
