/**
 * Availability check for one storefront domain: DNS, HTTP status and Shopify's
 * "store unavailable" / password pages.
 */
import { lookup } from 'node:dns/promises';
import type { BrandConfig } from '@valam/config';
import { RobotsDisallowedError, type Fetcher } from '@valam/core';

export type UptimeStatus =
  | 'up'
  | 'http_error'
  | 'dns_failure'
  | 'store_unavailable'
  | 'password_protected'
  | 'timeout'
  | 'network_error'
  | 'robots_blocked';

export interface UptimeResult {
  brand: string;
  brandName: string;
  domain: string;
  status: UptimeStatus;
  httpStatus: number | null;
  responseMs: number;
  detail: string;
  checkedAt: string;
}

export interface UptimeDeps {
  fetcher: Fetcher;
  /** Resolves a hostname; rejects with an ENOTFOUND-style error when DNS fails. */
  resolveDns?: (hostname: string) => Promise<unknown>;
  now?: () => number;
}

/** Error codes Node uses for DNS resolution failures. */
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL', 'EAI_NONAME']);

/** Text Shopify serves when a store is closed, frozen or unpaid. */
const UNAVAILABLE_PATTERN =
  /this (?:shop|store) is (?:currently )?unavailable|<title>\s*store unavailable|store unavailable\s*<\/h1>/i;

/** True for Shopify's "Sorry, this store is currently unavailable" page. */
export function isShopifyUnavailablePage(html: string): boolean {
  return UNAVAILABLE_PATTERN.test(html);
}

/** True when the response is Shopify's storefront password page. */
export function isPasswordPage(html: string, finalUrl: string): boolean {
  if (/\/password\/?(?:\?|$)/.test(finalUrl)) return true;
  return (
    /<body[^>]*\btemplate-password\b/i.test(html) || /<form[^>]+action="\/password"/i.test(html)
  );
}

/** Extracts a Node error code from an error or its `cause` (fetch wraps socket errors). */
function errorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e?.code === 'string') return e.code;
  if (typeof e?.cause?.code === 'string') return e.cause.code;
  return undefined;
}

/** Checks one domain and classifies the outcome. Never throws. */
export async function checkDomain(
  brand: BrandConfig,
  domain: string,
  deps: UptimeDeps,
): Promise<UptimeResult> {
  const now = deps.now ?? Date.now;
  const resolveDns = deps.resolveDns ?? ((host: string) => lookup(host));
  const started = now();
  const base = {
    brand: brand.id,
    brandName: brand.brandName,
    domain,
    checkedAt: new Date(started).toISOString(),
  };
  const result = (
    status: UptimeStatus,
    httpStatus: number | null,
    detail: string,
  ): UptimeResult => ({
    ...base,
    status,
    httpStatus,
    detail,
    responseMs: Math.max(0, now() - started),
  });

  try {
    await resolveDns(domain);
  } catch (error) {
    return result(
      'dns_failure',
      null,
      `DNS lookup failed (${errorCode(error) ?? (error as Error).message})`,
    );
  }

  try {
    const response = await deps.fetcher(`https://${domain}/`, { headers: { Accept: 'text/html' } });
    const html = await response.text();
    const finalUrl = response.url || `https://${domain}/`;

    if (isShopifyUnavailablePage(html)) {
      return result(
        'store_unavailable',
        response.status,
        'Shopify "store unavailable" page is showing',
      );
    }
    if (isPasswordPage(html, finalUrl)) {
      return result(
        'password_protected',
        response.status,
        'Storefront is behind the Shopify password page',
      );
    }
    if (response.status >= 400) {
      return result(
        'http_error',
        response.status,
        `HTTP ${response.status} ${response.statusText}`.trim(),
      );
    }
    return result('up', response.status, `HTTP ${response.status}`);
  } catch (error) {
    if (error instanceof RobotsDisallowedError) {
      return result('robots_blocked', null, 'robots.txt disallows the homepage (or returned 5xx)');
    }
    if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
      return result('timeout', null, 'Request timed out');
    }
    const code = errorCode(error);
    if (code && DNS_CODES.has(code))
      return result('dns_failure', null, `DNS lookup failed (${code})`);
    return result('network_error', null, code ?? (error as Error).message);
  }
}

/** Checks every domain of every brand (in parallel across hosts). */
export async function checkAll(
  brands: readonly BrandConfig[],
  deps: UptimeDeps,
): Promise<UptimeResult[]> {
  const jobs = brands.flatMap((brand) =>
    brand.domains.map((domain) => checkDomain(brand, domain, deps)),
  );
  return Promise.all(jobs);
}
