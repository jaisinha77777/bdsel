/**
 * Homepage checks shared by every platform: meta description, banned strings,
 * unrendered placeholders, free-shipping consistency and navigation link health.
 */
import type { BrandConfig } from '@valam/config';
import {
  RobotsDisallowedError,
  extractNavLinks,
  getMetaContent,
  getTitle,
  visibleText,
  type Fetcher,
} from '@valam/core';
import { validateDescription, validateTitle } from '@valam/seo';
import type { Finding, HomepageSummary, LinkCheck } from './types';

/** Never HEAD more than this many nav links per page. */
export const MAX_NAV_LINKS = 60;

/** Banned strings found anywhere in the HTML (markup, scripts, meta) — case-insensitive. */
export function findBannedStrings(html: string, banned: string[]): string[] {
  const haystack = `${html}\n${visibleText(html)}`.toLowerCase();
  return banned.filter((s) => haystack.includes(s.toLowerCase()));
}

/**
 * Unrendered template placeholders in visible text: `{PRODUCT}`-style tokens,
 * Yoast `%%title%%` variables and raw `{{ liquid }}` / `[[shortcode]]` output.
 */
export function findPlaceholders(html: string): string[] {
  const text = visibleText(html);
  const patterns = [
    /\{[A-Z][A-Z0-9_]{1,40}\}/g,
    /%%[a-z_]{2,40}%%/g,
    /\{\{[^{}]{1,80}\}\}/g,
    /\[\[[^[\]]{1,80}\]\]/g,
  ];
  const found = new Set<string>();
  for (const pattern of patterns) for (const m of text.matchAll(pattern)) found.add(m[0]);
  return [...found];
}

/** Rupee amounts mentioned next to "free shipping/delivery" in visible text, de-duplicated. */
export function findFreeShippingAmounts(html: string): number[] {
  const text = visibleText(html);
  const pattern = /free\s+(?:shipping|delivery)[^.!|₹]{0,40}?(?:₹|rs\.?|inr)\s*([\d,]+)/gi;
  const amounts = new Set<number>();
  for (const m of text.matchAll(pattern)) {
    const value = Number((m[1] ?? '').replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) amounts.add(value);
  }
  return [...amounts].sort((a, b) => a - b);
}

/**
 * HEADs each link (falling back to GET when HEAD is not supported). Redirects are not
 * followed so we never leave the brand's own hosts; a 3xx counts as healthy.
 */
export async function checkLinks(urls: string[], fetcher: Fetcher): Promise<LinkCheck[]> {
  const results: LinkCheck[] = [];
  for (const url of urls.slice(0, MAX_NAV_LINKS)) {
    try {
      let response = await fetcher(url, { method: 'HEAD', redirect: 'manual' });
      if (response.status === 405 || response.status === 501) {
        response = await fetcher(url, { method: 'GET', redirect: 'manual' });
        await response.arrayBuffer().catch(() => undefined);
      }
      const location = response.headers.get('location');
      results.push({
        url,
        status: response.status,
        ok: response.status < 400,
        ...(response.status >= 300 && response.status < 400 && location
          ? { note: `redirects to ${location}` }
          : {}),
      });
    } catch (error) {
      if (error instanceof RobotsDisallowedError) {
        results.push({ url, status: null, ok: true, note: 'skipped: disallowed by robots.txt' });
      } else {
        results.push({ url, status: null, ok: false, note: (error as Error).message });
      }
    }
  }
  return results;
}

/** Analyses homepage HTML (no network), returning the summary minus nav link results. */
export function analyzeHomepageHtml(
  html: string,
  brand: BrandConfig,
): Omit<HomepageSummary, 'navLinks'> {
  return {
    fetched: true,
    title: getTitle(html),
    metaDescription: getMetaContent(html, 'description'),
    bannedStringsFound: findBannedStrings(html, brand.bannedStrings),
    placeholders: findPlaceholders(html),
    freeShippingAmountsINR: findFreeShippingAmounts(html),
  };
}

/** Turns a homepage summary into findings. */
export function homepageFindings(summary: HomepageSummary, brand: BrandConfig): Finding[] {
  if (!summary.fetched) return [];
  const findings: Finding[] = [];

  if (!summary.metaDescription) {
    findings.push({
      severity: 'error',
      check: 'meta-description',
      message: 'Homepage has no meta description',
    });
  } else {
    for (const issue of validateDescription(summary.metaDescription)) {
      findings.push({ severity: 'warning', check: 'meta-description', message: issue.message });
    }
  }
  for (const issue of validateTitle(summary.title)) {
    findings.push({ severity: 'warning', check: 'title', message: issue.message });
  }
  if (summary.bannedStringsFound.length > 0) {
    findings.push({
      severity: 'error',
      check: 'banned-string',
      message: 'Another brand’s name appears on this site',
      items: summary.bannedStringsFound,
    });
  }
  if (summary.placeholders.length > 0) {
    findings.push({
      severity: 'error',
      check: 'placeholder',
      message: 'Unrendered template placeholders are visible to shoppers',
      items: summary.placeholders,
    });
  }
  const amounts = summary.freeShippingAmountsINR;
  if (amounts.length > 1) {
    findings.push({
      severity: 'error',
      check: 'free-shipping-conflict',
      message: `Conflicting free-shipping thresholds on the homepage (config says ₹${brand.shippingThresholdINR})`,
      items: amounts.map((a) => `₹${a}`),
    });
  } else if (amounts.length === 1 && amounts[0] !== brand.shippingThresholdINR) {
    findings.push({
      severity: 'warning',
      check: 'free-shipping-mismatch',
      message: `Homepage advertises free shipping above ₹${amounts[0]} but config says ₹${brand.shippingThresholdINR}`,
    });
  }
  const broken = summary.navLinks.filter((l) => !l.ok);
  if (broken.length > 0) {
    findings.push({
      severity: 'error',
      check: 'broken-link',
      message: `${broken.length} navigation links are broken`,
      items: broken.map((l) => `${l.url} (${l.status ?? l.note ?? 'error'})`),
    });
  }
  return findings;
}

/** Fetches a homepage and runs every homepage check including nav link HEADs. */
export async function checkHomepage(
  origin: string,
  brand: BrandConfig,
  fetcher: Fetcher,
): Promise<{ summary: HomepageSummary; findings: Finding[] }> {
  const pageUrl = `${origin}/`;
  let html: string;
  try {
    const response = await fetcher(pageUrl, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  } catch (error) {
    const summary: HomepageSummary = {
      fetched: false,
      title: null,
      metaDescription: null,
      bannedStringsFound: [],
      placeholders: [],
      freeShippingAmountsINR: [],
      navLinks: [],
    };
    return {
      summary,
      findings: [
        {
          severity: 'error',
          check: 'homepage-unreachable',
          message: `Homepage fetch failed: ${(error as Error).message}`,
        },
      ],
    };
  }
  const summary: HomepageSummary = {
    ...analyzeHomepageHtml(html, brand),
    navLinks: await checkLinks(extractNavLinks(html, pageUrl), fetcher),
  };
  return { summary, findings: homepageFindings(summary, brand) };
}
