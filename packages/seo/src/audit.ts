/**
 * Live SEO audit of a brand's primary domain: homepage on-page checks, robots.txt and
 * sitemap. All requests go through the polite fetcher passed in.
 */
import type { BrandConfig } from '@valam/config';
import { getText, HttpStatusError, type Fetcher } from '@valam/core';
import { brandOrigin } from './meta';
import { checkRobotsTxt, type RobotsCheck } from './robots-check';
import { auditSitemap, type SitemapAudit } from './sitemap';
import { validatePageHtml, type PageAudit } from './validate';

export interface SeoAuditResult {
  brand: string;
  origin: string;
  homepage: PageAudit | null;
  robots: RobotsCheck;
  sitemap: SitemapAudit;
  errorCount: number;
  warningCount: number;
}

/** Fetches robots.txt, returning null on 404 and rethrowing other failures. */
async function fetchRobots(fetcher: Fetcher, origin: string): Promise<string | null> {
  try {
    return await getText(fetcher, `${origin}/robots.txt`);
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 404) return null;
    throw error;
  }
}

export async function auditBrandSeo(brand: BrandConfig, fetcher: Fetcher): Promise<SeoAuditResult> {
  const origin = brandOrigin(brand);
  const robots = checkRobotsTxt(await fetchRobots(fetcher, origin), origin);

  let homepage: PageAudit | null = null;
  try {
    homepage = validatePageHtml(await getText(fetcher, `${origin}/`));
  } catch (error) {
    robots.issues.push({
      severity: 'error',
      code: 'homepage-unreachable',
      message: `Homepage could not be fetched: ${(error as Error).message}`,
    });
  }

  const sitemap = await auditSitemap(fetcher, origin, robots.sitemaps);
  const all = [...(homepage?.issues ?? []), ...robots.issues, ...sitemap.issues];
  return {
    brand: brand.id,
    origin,
    homepage,
    robots,
    sitemap,
    errorCount: all.filter((i) => i.severity === 'error').length,
    warningCount: all.filter((i) => i.severity === 'warning').length,
  };
}
