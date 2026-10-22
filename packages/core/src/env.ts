/**
 * Environment helpers: load the repo-level .env (if present) and read typed values.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './paths';

let loaded = false;

/** Loads `<repo>/.env` once using Node's built-in loader (Node >= 20.12). */
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = join(repoRoot(), '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

/** Reads a non-negative number from the environment, falling back when unset/invalid. */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Reads a trimmed string from the environment, or undefined when unset/empty. */
export function envString(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}
