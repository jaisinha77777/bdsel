/**
 * robots.txt checks from an SEO point of view: is the store crawlable and does it
 * advertise a sitemap?
 */
import { isPathAllowed, parseRobotsTxt } from '@valam/core';
import type { SeoIssue } from './validate';

/** Paths search engines must be able to reach on a storefront. */
const MUST_BE_CRAWLABLE = ['/', '/products/example', '/collections/example'];

export interface RobotsCheck {
  sitemaps: string[];
  issues: SeoIssue[];
}

/**
 * Checks robots.txt text (or `null` when the file is missing) for an origin like
 * "https://shibori.in".
 */
export function checkRobotsTxt(text: string | null, origin: string): RobotsCheck {
  if (text === null) {
    return {
      sitemaps: [],
      issues: [{ severity: 'warning', code: 'robots-missing', message: 'robots.txt not found' }],
    };
  }
  const robots = parseRobotsTxt(text);
  const issues: SeoIssue[] = [];

  for (const bot of ['Googlebot', 'Bingbot']) {
    for (const path of MUST_BE_CRAWLABLE) {
      if (!isPathAllowed(robots, bot, path)) {
        issues.push({
          severity: 'error',
          code: 'robots-blocks-crawl',
          message: `robots.txt blocks ${bot} from ${path}`,
        });
      }
    }
  }

  if (robots.sitemaps.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'robots-no-sitemap',
      message: 'robots.txt has no Sitemap: directive',
    });
  }
  const host = new URL(origin).hostname.replace(/^www\./, '');
  for (const sitemap of robots.sitemaps) {
    let sitemapHost: string;
    try {
      sitemapHost = new URL(sitemap).hostname.replace(/^www\./, '');
    } catch {
      issues.push({
        severity: 'error',
        code: 'robots-bad-sitemap',
        message: `Invalid sitemap URL: ${sitemap}`,
      });
      continue;
    }
    if (sitemapHost !== host) {
      issues.push({
        severity: 'error',
        code: 'robots-foreign-sitemap',
        message: `Sitemap points at another host: ${sitemap}`,
      });
    }
  }
  return { sitemaps: robots.sitemaps, issues };
}
