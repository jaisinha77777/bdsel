/**
 * CLI: npm run monitor [-- --brand shibori] [--strict] [--dry-run] [--skip-dns]
 * Checks every configured domain, prints the summary, writes reports/uptime-<date>.json
 * and posts to MONITOR_WEBHOOK_URL when set. --strict exits 1 if anything is down.
 * --skip-dns skips the local DNS pre-check (for networks where only an HTTP proxy resolves names).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ALL_BRANDS, resolveBrand, type BrandConfig } from '@valam/config';
import {
  buildUserAgent,
  createPoliteFetcher,
  envNumber,
  envString,
  istDate,
  loadDotEnv,
  repoRoot,
} from '@valam/core';
import { checkAll } from './check';
import { buildSummary, buildWebhookPayload, isHealthy, postWebhook } from './summary';

async function main(): Promise<void> {
  loadDotEnv();
  const { values } = parseArgs({
    options: {
      brand: { type: 'string', short: 'b' },
      strict: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'skip-dns': { type: 'boolean', default: false },
      out: { type: 'string', default: join(repoRoot(), 'reports') },
    },
  });
  const brands: readonly BrandConfig[] = values.brand ? [resolveBrand(values.brand)] : ALL_BRANDS;
  const fetcher = createPoliteFetcher({
    userAgent: buildUserAgent(envString('TOOLKIT_CONTACT')),
    minIntervalMs: envNumber('REQUEST_INTERVAL_MS', 1000),
    timeoutMs: envNumber('REQUEST_TIMEOUT_MS', 15_000),
    // Uptime is a single homepage GET per host; retries would hide flapping.
    maxRetries: 0,
  });

  const results = await checkAll(brands, {
    fetcher,
    ...(values['skip-dns'] ? { resolveDns: async () => undefined } : {}),
  });
  const date = istDate();
  const summary = buildSummary(results, date);
  console.log(summary);

  const outDir = values.out ?? 'reports';
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `uptime-${date}.json`);
  await writeFile(file, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`\nSaved ${file}`);

  const webhook = envString('MONITOR_WEBHOOK_URL');
  if (webhook && !values['dry-run']) {
    await postWebhook(webhook, buildWebhookPayload(summary));
    console.log('Posted summary to webhook');
  } else if (!webhook) {
    console.log('MONITOR_WEBHOOK_URL not set — skipping webhook');
  }

  if (values.strict && results.some((r) => !isHealthy(r))) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
