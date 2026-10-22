/**
 * SEO CLI.
 *   npm run seo:generate -- --brand shibori   write out/<brand>/seo/ (head.html, JSON-LD, snippets)
 *   npm run seo:audit -- --brand shibori      live audit: homepage meta/alt, robots.txt, sitemap
 * Both accept --all instead of --brand.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ALL_BRANDS, resolveBrand, type BrandConfig } from '@valam/config';
import {
  buildUserAgent,
  createPoliteFetcher,
  envNumber,
  envString,
  loadDotEnv,
  repoRoot,
} from '@valam/core';
import { auditBrandSeo } from './audit';
import { writeSeoBundle } from './generate-bundle';
import type { SeoIssue } from './validate';

function printIssues(issues: SeoIssue[]): void {
  for (const i of issues)
    console.log(`  ${i.severity === 'error' ? '✖' : '⚠'} [${i.code}] ${i.message}`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      brand: { type: 'string', short: 'b' },
      all: { type: 'boolean', default: false },
      out: { type: 'string', default: join(repoRoot(), 'out') },
    },
  });
  const command = positionals[0];
  if ((command !== 'generate' && command !== 'audit') || (!values.brand && !values.all)) {
    console.error('Usage: tsx packages/seo/src/cli.ts <generate|audit> --brand <id> | --all');
    process.exit(2);
  }
  const brands: readonly BrandConfig[] = values.all
    ? ALL_BRANDS
    : [resolveBrand(values.brand ?? '')];

  if (command === 'generate') {
    for (const brand of brands) {
      const files = await writeSeoBundle(brand, values.out ?? 'out');
      console.log(
        `✔ ${brand.brandName}: ${files.length} files in ${join(values.out ?? 'out', brand.id, 'seo')}`,
      );
    }
    return;
  }

  const fetcher = createPoliteFetcher({
    userAgent: buildUserAgent(envString('TOOLKIT_CONTACT')),
    minIntervalMs: envNumber('REQUEST_INTERVAL_MS', 1000),
    timeoutMs: envNumber('REQUEST_TIMEOUT_MS', 15_000),
  });
  let failed = false;
  for (const brand of brands) {
    const result = await auditBrandSeo(brand, fetcher);
    console.log(
      `\n${brand.brandName} (${result.origin}) — ${result.errorCount} errors, ${result.warningCount} warnings`,
    );
    if (result.homepage) {
      console.log(`  title: ${result.homepage.title ?? '(none)'}`);
      printIssues(result.homepage.issues);
    }
    printIssues(result.robots.issues);
    console.log(
      `  sitemap: ${result.sitemap.urlCount} URLs across ${result.sitemap.sitemaps.length} file(s)`,
    );
    printIssues(result.sitemap.issues);
    failed ||= result.errorCount > 0;
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
