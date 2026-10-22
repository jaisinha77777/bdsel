/**
 * CLI: npm run qa -- --brand shibori [--deep-alt]   (or --all)
 * Writes reports/<brand>-<YYYY-MM-DD>.md and .json. Exit code 1 when any errors were found.
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
import { writeReport } from './report';
import { runQa } from './run';

async function main(): Promise<void> {
  loadDotEnv();
  const { values } = parseArgs({
    options: {
      brand: { type: 'string', short: 'b' },
      all: { type: 'boolean', default: false },
      'deep-alt': { type: 'boolean', default: false },
      out: { type: 'string', default: join(repoRoot(), 'reports') },
    },
  });
  if (!values.brand && !values.all) {
    console.error('Usage: npm run qa -- --brand <id> | --all [--deep-alt] [--out <dir>]');
    process.exit(2);
  }
  const brands: readonly BrandConfig[] = values.all
    ? ALL_BRANDS
    : [resolveBrand(values.brand ?? '')];
  const fetcher = createPoliteFetcher({
    userAgent: buildUserAgent(envString('TOOLKIT_CONTACT')),
    minIntervalMs: envNumber('REQUEST_INTERVAL_MS', 1000),
    timeoutMs: envNumber('REQUEST_TIMEOUT_MS', 15_000),
  });

  let errors = 0;
  for (const brand of brands) {
    console.log(`→ ${brand.brandName} (${brand.domains.join(', ')})`);
    const report = await runQa(brand, fetcher, { deepAlt: values['deep-alt'] });
    const files = await writeReport(report, values.out ?? 'reports');
    console.log(
      `  ${report.summary.errors} errors, ${report.summary.warnings} warnings → ${files.markdown}`,
    );
    errors += report.summary.errors;
  }
  process.exitCode = errors > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
