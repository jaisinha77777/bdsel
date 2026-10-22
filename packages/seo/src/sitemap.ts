/**
 * sitemap.xml parsing and auditing (sitemap index -> child sitemaps -> URLs).
 */
import { getText, HttpStatusError, type Fetcher } from '@valam/core';
import type { SeoIssue } from './validate';

export interface ParsedSitemap {
  kind: 'index' | 'urlset' | 'unknown';
  locs: string[];
}

/** Decodes the XML entities that may appear inside <loc>. */
function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Extracts <loc> entries and tells a sitemap index from a URL set. */
export function parseSitemap(xml: string): ParsedSitemap {
  const kind = /<sitemapindex[\s>]/i.test(xml)
    ? 'index'
    : /<urlset[\s>]/i.test(xml)
      ? 'urlset'
      : 'unknown';
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decodeXml(m[1] ?? ''));
  return { kind, locs };
}

export interface SitemapAudit {
  /** Sitemap files fetched (index first). */
  sitemaps: string[];
  urlCount: number;
  issues: SeoIssue[];
}

/** Maximum child sitemaps fetched from an index (Shopify stores rarely exceed ~10). */
export const MAX_CHILD_SITEMAPS = 50;

/**
 * Fetches the sitemap (first robots.txt Sitemap: entry, else /sitemap.xml), follows an
 * index one level down and reports unreachable/empty files and URLs on foreign hosts.
 */
export async function auditSitemap(
  fetcher: Fetcher,
  origin: string,
  advertised: string[] = [],
): Promise<SitemapAudit> {
  const rootUrl = advertised[0] ?? `${origin}/sitemap.xml`;
  const host = new URL(origin).hostname.replace(/^www\./, '');
  const audit: SitemapAudit = { sitemaps: [], urlCount: 0, issues: [] };

  async function load(url: string): Promise<ParsedSitemap | null> {
    try {
      audit.sitemaps.push(url);
      return parseSitemap(await getText(fetcher, url));
    } catch (error) {
      const detail =
        error instanceof HttpStatusError ? `HTTP ${error.status}` : (error as Error).message;
      audit.issues.push({
        severity: 'error',
        code: 'sitemap-unreachable',
        message: `${url}: ${detail}`,
      });
      return null;
    }
  }

  function countUrls(sitemapUrl: string, parsed: ParsedSitemap): void {
    if (parsed.locs.length === 0) {
      audit.issues.push({
        severity: 'warning',
        code: 'sitemap-empty',
        message: `${sitemapUrl} lists no URLs`,
      });
    }
    audit.urlCount += parsed.locs.length;
    for (const loc of parsed.locs) {
      let locHost: string;
      try {
        locHost = new URL(loc).hostname.replace(/^www\./, '');
      } catch {
        audit.issues.push({
          severity: 'error',
          code: 'sitemap-bad-url',
          message: `${sitemapUrl}: invalid URL ${loc}`,
        });
        continue;
      }
      if (locHost !== host) {
        audit.issues.push({
          severity: 'error',
          code: 'sitemap-foreign-url',
          message: `${sitemapUrl} lists a URL on another host: ${loc}`,
        });
      }
    }
  }

  const root = await load(rootUrl);
  if (!root) return audit;
  if (root.kind === 'unknown') {
    audit.issues.push({
      severity: 'error',
      code: 'sitemap-invalid',
      message: `${rootUrl} is not a sitemap or sitemap index`,
    });
    return audit;
  }
  if (root.kind === 'urlset') {
    countUrls(rootUrl, root);
    return audit;
  }
  if (root.locs.length > MAX_CHILD_SITEMAPS) {
    audit.issues.push({
      severity: 'warning',
      code: 'sitemap-truncated',
      message: `Index lists ${root.locs.length} sitemaps; only the first ${MAX_CHILD_SITEMAPS} were checked`,
    });
  }
  for (const child of root.locs.slice(0, MAX_CHILD_SITEMAPS)) {
    const parsed = await load(child);
    if (parsed) countUrls(child, parsed);
  }
  return audit;
}
