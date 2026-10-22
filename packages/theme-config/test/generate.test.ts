import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRANDS, shopifyBrands } from '@valam/config';
import {
  assertNoBannedStrings,
  couponMessage,
  generateThemeSettings,
  iconForBadge,
} from '../src/generate';
import { writeThemeSettings } from '../src/write';

describe('generateThemeSettings', () => {
  it('builds Shibori settings from config', () => {
    const data = generateThemeSettings(BRANDS.shibori);
    expect(data.current.valam_brand_name).toBe('Shibori Indian');
    expect(data.current.valam_free_shipping_threshold_cents).toBe(99_900);
    const bar = data.current.sections['valam-announcement-bar'];
    expect(bar?.blocks['announcement-1']?.settings.text).toBe('Free shipping on orders above ₹999');
    expect(bar?.block_order).toHaveLength(1 + BRANDS.shibori.couponLadder.length);
    const ladder = data.current.sections['valam-coupon-ladder'];
    expect(ladder?.blocks['tier-2']?.settings).toMatchObject({
      code: 'SHIBORI10',
      min_cart_cents: 349_900,
    });
  });

  it('uses each brand’s own copy for Manpasand and Western Vastr', () => {
    const manpasand = JSON.stringify(generateThemeSettings(BRANDS.manpasand));
    const vastr = JSON.stringify(generateThemeSettings(BRANDS.westernvastr));
    expect(manpasand).toContain('₹1,499');
    expect(manpasand).not.toContain('Western Vastr');
    expect(vastr).toContain('VASTR12');
    expect(vastr).not.toContain('Manpasand');
  });

  it('never leaks another brand into any Shopify store', () => {
    for (const brand of shopifyBrands()) {
      expect(() => generateThemeSettings(brand)).not.toThrow();
    }
  });

  it('detects a leaked banned string', () => {
    const data = generateThemeSettings(BRANDS.joyfeel);
    data.current.valam_brand_name = 'Shibori Indian';
    expect(() => assertNoBannedStrings(data, BRANDS.joyfeel)).toThrow(
      /banned strings: Shibori Indian/,
    );
  });

  it('rejects non-Shopify brands', () => {
    expect(() => generateThemeSettings(BRANDS.cafora)).toThrow(/Shopify-only/);
  });

  it('maps badge icons and coupon copy', () => {
    expect(iconForBadge('Free shipping above ₹999')).toBe('truck');
    expect(iconForBadge('7-day easy returns')).toBe('return');
    expect(couponMessage({ minCartINR: 2499, discountPercent: 5, code: 'X5' })).toBe(
      'Spend ₹2,499, get 5% off with code X5',
    );
  });

  it('writes out/<brand>/settings_data.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'theme-'));
    const file = await writeThemeSettings(BRANDS.westernvastr, dir);
    expect(file).toBe(join(dir, 'westernvastr', 'settings_data.json'));
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      current: { valam_brand_name: string };
    };
    expect(parsed.current.valam_brand_name).toBe('Western Vastr');
  });
});
