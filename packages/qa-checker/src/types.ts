/**
 * Report data model shared by the checks, the Markdown renderer and the JSON output.
 */
import type { Platform } from '@valam/config';

export type Severity = 'error' | 'warning' | 'info';

/** One problem (or note) surfaced by a check. */
export interface Finding {
  severity: Severity;
  /** Stable check id, e.g. "sold-out", "banned-string". */
  check: string;
  message: string;
  /** Optional affected items (handles, URLs, strings). */
  items?: string[];
}

export interface ProductRef {
  handle: string;
  title: string;
}

export interface CatalogSummary {
  productCount: number;
  variantCount: number;
  soldOut: ProductRef[];
  noImages: ProductRef[];
  missingAlt: ProductRef[];
  /** Where alt text came from: the list feed, per-product lookups, or unavailable. */
  altSource: 'feed' | 'product-endpoint' | 'not-exposed';
  /** Share of variants whose compare_at_price is set above price (0..1). */
  discountedVariantRatio: number;
  permanentDiscount: boolean;
  collectionCount: number;
  emptyCollections: ProductRef[];
}

export interface LinkCheck {
  url: string;
  /** HTTP status, or null when the request was skipped or failed. */
  status: number | null;
  ok: boolean;
  note?: string;
}

export interface HomepageSummary {
  fetched: boolean;
  title: string | null;
  metaDescription: string | null;
  bannedStringsFound: string[];
  placeholders: string[];
  freeShippingAmountsINR: number[];
  navLinks: LinkCheck[];
}

export interface DomainReport {
  domain: string;
  catalog: CatalogSummary | null;
  homepage: HomepageSummary;
  findings: Finding[];
}

export interface QaReport {
  brand: string;
  brandName: string;
  platform: Platform;
  /** ISO timestamp of the run. */
  generatedAt: string;
  /** Run date in IST (YYYY-MM-DD), used in the report file name. */
  date: string;
  domains: DomainReport[];
  summary: { errors: number; warnings: number };
}
