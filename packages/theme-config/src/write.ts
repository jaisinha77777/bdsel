/**
 * Writes generated theme settings to out/<brand>/settings_data.json.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrandConfig } from '@valam/config';
import { generateThemeSettings } from './generate';

/** Generates and writes one brand's file; returns the path written. */
export async function writeThemeSettings(brand: BrandConfig, outDir: string): Promise<string> {
  const data = generateThemeSettings(brand);
  const dir = join(outDir, brand.id);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'settings_data.json');
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return file;
}
