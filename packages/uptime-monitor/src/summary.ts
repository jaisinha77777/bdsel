/**
 * Builds the daily summary and posts it to a Slack- or Discord-compatible webhook.
 * The payload carries both `text` (Slack) and `content` (Discord); each service
 * ignores the other's field.
 */
import type { UptimeResult, UptimeStatus } from './check';

/** Discord rejects messages longer than 2000 characters. */
export const DISCORD_LIMIT = 2000;

const LABEL: Record<UptimeStatus, string> = {
  up: 'up',
  http_error: 'HTTP error',
  dns_failure: 'DNS failure',
  store_unavailable: 'store unavailable',
  password_protected: 'password protected',
  timeout: 'timeout',
  network_error: 'network error',
  robots_blocked: 'blocked by robots.txt',
};

export function isHealthy(result: UptimeResult): boolean {
  return result.status === 'up';
}

/** Plain-text summary using Markdown that renders in both Slack and Discord. */
export function buildSummary(results: UptimeResult[], date: string): string {
  const down = results.filter((r) => !isHealthy(r));
  const header = down.length === 0 ? '✅' : '🚨';
  const lines = [
    `${header} Valam store uptime — ${date}`,
    `${results.length - down.length}/${results.length} domains up${down.length > 0 ? `, ${down.length} need attention` : ''}`,
    '',
  ];
  for (const r of [...down, ...results.filter(isHealthy)]) {
    const icon = isHealthy(r) ? '🟢' : '🔴';
    const status = isHealthy(r)
      ? `${r.httpStatus ?? ''} in ${r.responseMs} ms`
      : `${LABEL[r.status]} — ${r.detail}`;
    lines.push(`${icon} \`${r.domain}\` (${r.brandName}): ${status}`);
  }
  return lines.join('\n');
}

export interface WebhookPayload {
  text: string;
  content: string;
}

export function buildWebhookPayload(text: string): WebhookPayload {
  const content = text.length > DISCORD_LIMIT ? `${text.slice(0, DISCORD_LIMIT - 1)}…` : text;
  return { text, content };
}

/** POSTs the payload; throws on a non-2xx answer so CI surfaces delivery failures. */
export async function postWebhook(
  url: string,
  payload: WebhookPayload,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<void> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Webhook responded ${response.status}: ${body.slice(0, 200)}`);
  }
}
