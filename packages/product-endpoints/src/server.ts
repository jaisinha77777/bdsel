/**
 * Starts the product-endpoints API: npm run api
 * Reads PORT, CACHE_TTL_MS, REQUEST_INTERVAL_MS, REQUEST_TIMEOUT_MS and TOOLKIT_CONTACT from .env.
 */
import { buildUserAgent, createPoliteFetcher, envNumber, envString, loadDotEnv } from '@valam/core';
import { DEFAULT_CACHE_TTL_MS, createApp } from './app';

loadDotEnv();

const fetcher = createPoliteFetcher({
  userAgent: buildUserAgent(envString('TOOLKIT_CONTACT')),
  minIntervalMs: envNumber('REQUEST_INTERVAL_MS', 1000),
  timeoutMs: envNumber('REQUEST_TIMEOUT_MS', 15_000),
});
const app = createApp({ fetcher, cacheTtlMs: envNumber('CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS) });
const port = envNumber('PORT', 3000);

const server = app.listen(port, () => {
  console.log(`product-endpoints listening on http://localhost:${port}`);
});

// Finish in-flight requests on Ctrl+C / container stop.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
