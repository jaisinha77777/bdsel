import { describe, expect, it } from 'vitest';
import type { UptimeResult } from '../src/check';
import { DISCORD_LIMIT, buildSummary, buildWebhookPayload, postWebhook } from '../src/summary';

const result = (
  domain: string,
  status: UptimeResult['status'],
  httpStatus: number | null,
  detail: string,
): UptimeResult => ({
  brand: 'x',
  brandName: domain.split('.')[0]!,
  domain,
  status,
  httpStatus,
  detail,
  responseMs: 120,
  checkedAt: '2026-10-22T03:30:00.000Z',
});

describe('buildSummary', () => {
  it('lists problems first with an alert header', () => {
    const text = buildSummary(
      [
        result('shibori.in', 'up', 200, 'HTTP 200'),
        result('joyfeel.in', 'store_unavailable', 402, 'Shopify page'),
      ],
      '2026-10-22',
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('🚨 Valam store uptime — 2026-10-22');
    expect(lines[1]).toBe('1/2 domains up, 1 need attention');
    expect(lines[3]).toBe('🔴 `joyfeel.in` (joyfeel): store unavailable — Shopify page');
    expect(lines[4]).toBe('🟢 `shibori.in` (shibori): 200 in 120 ms');
  });

  it('uses a green header when all is well', () => {
    expect(buildSummary([result('cafora.in', 'up', 200, 'ok')], '2026-10-22')).toMatch(/^✅/);
  });
});

describe('webhook', () => {
  it('builds a Slack + Discord payload and truncates for Discord', () => {
    const payload = buildWebhookPayload('x'.repeat(DISCORD_LIMIT + 50));
    expect(payload.text).toHaveLength(DISCORD_LIMIT + 50);
    expect(payload.content).toHaveLength(DISCORD_LIMIT);
  });

  it('POSTs JSON and throws on failure', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const ok = async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as string });
      return new Response('ok');
    };
    await postWebhook('https://hooks.example.test/abc', buildWebhookPayload('hi'), ok);
    expect(JSON.parse(calls[0]!.body)).toEqual({ text: 'hi', content: 'hi' });
    const fail = async () => new Response('invalid_token', { status: 403 });
    await expect(
      postWebhook('https://hooks.example.test/abc', buildWebhookPayload('hi'), fail),
    ).rejects.toThrow(/403: invalid_token/);
  });
});
