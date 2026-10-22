/**
 * Locates the monorepo root (the directory holding pnpm-workspace.yaml) so CLIs write
 * to out/ and reports/ consistently no matter which directory they are run from.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

export function repoRoot(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      cached = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Could not locate repo root (pnpm-workspace.yaml not found)');
    }
    dir = parent;
  }
}
