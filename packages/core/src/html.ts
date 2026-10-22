/**
 * HTML inspection helpers built on node-html-parser (no headless browser needed).
 */
import { parse, type HTMLElement } from 'node-html-parser';

/** Parses an HTML document. */
export function parseHtml(html: string): HTMLElement {
  return parse(html, { comment: false });
}

/** Content of the first <title>, trimmed, or null. */
export function getTitle(html: string): string | null {
  const text = parseHtml(html).querySelector('title')?.text.trim();
  return text ? text : null;
}

/**
 * Content of `<meta name="...">` or `<meta property="...">` (case-insensitive key),
 * or null when absent or empty.
 */
export function getMetaContent(html: string, key: string): string | null {
  const wanted = key.toLowerCase();
  for (const meta of parseHtml(html).querySelectorAll('meta')) {
    const name = (meta.getAttribute('name') ?? meta.getAttribute('property') ?? '').toLowerCase();
    if (name === wanted) {
      const content = meta.getAttribute('content')?.trim();
      return content ? content : null;
    }
  }
  return null;
}

/** All JSON-LD blocks on the page, parsed. Invalid JSON blocks are skipped. */
export function getJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const script of parseHtml(html).querySelectorAll('script[type="application/ld+json"]')) {
    try {
      blocks.push(JSON.parse(script.text));
    } catch {
      // Malformed JSON-LD is reported by the SEO validator, not here.
    }
  }
  return blocks;
}

/** Strips a leading "www." so example.com and www.example.com compare equal. */
function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Internal links found in the site navigation (<header> and <nav> elements), resolved
 * to absolute URLs without fragments, de-duplicated, in document order.
 */
export function extractNavLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const seen = new Set<string>();
  for (const anchor of parseHtml(html).querySelectorAll('header a[href], nav a[href]')) {
    const href = anchor.getAttribute('href')?.trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript|sms):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || bareHost(url.hostname) !== bareHost(base.hostname))
      continue;
    url.hash = '';
    seen.add(url.toString());
  }
  return [...seen];
}

export interface ImageAltAudit {
  /** <img> src values with no alt attribute at all. */
  missing: string[];
  /** <img> src values with alt="" (acceptable only for decorative images). */
  empty: string[];
  total: number;
}

/** Audits every <img> on the page for alt attributes. */
export function auditImageAlts(html: string): ImageAltAudit {
  const audit: ImageAltAudit = { missing: [], empty: [], total: 0 };
  for (const img of parseHtml(html).querySelectorAll('img')) {
    audit.total++;
    const src = img.getAttribute('src') ?? img.getAttribute('data-src') ?? '(no src)';
    const alt = img.getAttribute('alt');
    if (alt === undefined) audit.missing.push(src);
    else if (alt.trim() === '') audit.empty.push(src);
  }
  return audit;
}

/** Visible text of the page (scripts/styles removed), whitespace collapsed. */
export function visibleText(html: string): string {
  const root = parseHtml(html);
  for (const node of root.querySelectorAll('script, style, noscript, template')) node.remove();
  return root.text.replace(/\s+/g, ' ').trim();
}
