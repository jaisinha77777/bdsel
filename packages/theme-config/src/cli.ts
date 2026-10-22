/**
 * CLI: npm run theme:config -- --brand shibori   (or --all)
 * Writes out/<brand>/settings_data.json for each selected Shopify brand.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveBrand, shopifyBrands } from '@valam/config';
import { repoRoot } from '@valam/core';
import { writeThemeSettings } from './write';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      brand: { type: 'string', short: 'b' },
      all: { type: 'boolean', default: false },
      out: { type: 'string', default: join(repoRoot(), 'out') },
    },
  });

  if (!values.brand && !values.all) {
    console.error('Usage: npm run theme:config -- --brand <id> | --all [--out <dir>]');
    process.exit(2);
  }
  const brands = values.all ? shopifyBrands() : [resolveBrand(values.brand ?? '')];
  for (const brand of brands) {
    const file = await writeThemeSettings(brand, values.out ?? 'out');
    console.log(`✔ ${brand.brandName}: ${file}`);
  }
}

main().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
