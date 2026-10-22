/**
 * Access to the Shopify Liquid snippets shipped with this package, and a helper to
 * copy them into a brand's output folder ready for upload to the theme's snippets/.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Snippet file names (as they must be named in the theme's snippets/ folder). */
export const LIQUID_SNIPPETS = ['seo-meta.liquid', 'product-schema.liquid'] as const;
export type LiquidSnippet = (typeof LIQUID_SNIPPETS)[number];

/** Absolute path of the bundled snippets directory. */
export function snippetsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'liquid', 'snippets');
}

/** Reads one bundled snippet's source. */
export function readSnippet(name: LiquidSnippet): Promise<string> {
  return readFile(join(snippetsDir(), name), 'utf8');
}

/** Copies all snippets into `<targetDir>/snippets/`; returns the written paths. */
export async function copySnippets(targetDir: string): Promise<string[]> {
  const dest = join(targetDir, 'snippets');
  await mkdir(dest, { recursive: true });
  const written: string[] = [];
  for (const name of LIQUID_SNIPPETS) {
    const file = join(dest, name);
    await copyFile(join(snippetsDir(), name), file);
    written.push(file);
  }
  return written;
}
