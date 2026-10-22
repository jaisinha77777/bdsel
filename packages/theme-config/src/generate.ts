/**
 * Builds a Shopify `settings_data.json` fragment for one brand.
 *
 * The fragment contains theme-level settings (brand name, support e-mail, free-shipping
 * threshold) and three sections — announcement bar, trust badges and coupon ladder — so
 * every piece of customer-facing copy comes from config/brands.ts and nothing is ever
 * copied between stores. Setting and section ids are prefixed with `valam_` / `valam-` so
 * they never collide with a theme's own settings when merged.
 */
import type { BrandConfig, CouponTier } from '@valam/config';
import { formatINR } from '@valam/core';

/** A theme block as stored in settings_data.json. */
export interface ThemeBlock {
  type: string;
  settings: Record<string, string | number | boolean>;
}

/** A theme section as stored in settings_data.json. */
export interface ThemeSection {
  type: string;
  settings: Record<string, string | number | boolean>;
  blocks: Record<string, ThemeBlock>;
  block_order: string[];
}

/** The generated fragment: `{ "current": { ...settings, "sections": {...} } }`. */
export interface ThemeSettingsData {
  current: {
    /** Flat theme settings (strings, numbers, booleans) plus the `sections` map. */
    [setting: string]: string | number | boolean | Record<string, ThemeSection>;
    sections: Record<string, ThemeSection>;
  };
}

/** Picks a theme icon name for a trust badge from its wording. */
export function iconForBadge(text: string): string {
  const t = text.toLowerCase();
  if (/(shipping|delivery)/.test(t)) return 'truck';
  if (/(return|exchange)/.test(t)) return 'return';
  if (/(secure|payment)/.test(t)) return 'lock';
  if (/(cod|cash)/.test(t)) return 'cash';
  if (/(hand|made|design|craft|batch)/.test(t)) return 'heart';
  if (/amazon/.test(t)) return 'bag';
  return 'check';
}

/** Customer-facing copy for one coupon tier. */
export function couponMessage(tier: CouponTier): string {
  return `Spend ${formatINR(tier.minCartINR)}, get ${tier.discountPercent}% off with code ${tier.code}`;
}

/** Builds a section from an ordered list of blocks with ids `<prefix>-1..n`. */
function section(
  type: string,
  settings: ThemeSection['settings'],
  prefix: string,
  blocks: ThemeBlock[],
): ThemeSection {
  const entries = blocks.map((block, index) => [`${prefix}-${index + 1}`, block] as const);
  return {
    type,
    settings,
    blocks: Object.fromEntries(entries),
    block_order: entries.map(([id]) => id),
  };
}

/** Throws if any of the brand's banned strings appears anywhere in the generated JSON. */
export function assertNoBannedStrings(data: ThemeSettingsData, brand: BrandConfig): void {
  const haystack = JSON.stringify(data).toLowerCase();
  const leaked = brand.bannedStrings.filter((s) => haystack.includes(s.toLowerCase()));
  if (leaked.length > 0) {
    throw new Error(
      `Generated settings for ${brand.id} contain banned strings: ${leaked.join(', ')}`,
    );
  }
}

/** Generates the settings_data.json fragment for a Shopify brand. */
export function generateThemeSettings(brand: BrandConfig): ThemeSettingsData {
  if (brand.platform !== 'shopify') {
    throw new Error(
      `${brand.brandName} runs on ${brand.platform}; theme settings are Shopify-only`,
    );
  }
  const threshold = formatINR(brand.shippingThresholdINR);
  const ladder = [...brand.couponLadder].sort((a, b) => a.minCartINR - b.minCartINR);

  const announcementBlocks: ThemeBlock[] = [
    {
      type: 'announcement',
      settings: { text: `Free shipping on orders above ${threshold}`, link: '' },
    },
    ...ladder.map((tier) => ({
      type: 'announcement',
      settings: { text: couponMessage(tier), link: '' },
    })),
  ];

  const data: ThemeSettingsData = {
    current: {
      valam_brand_name: brand.brandName,
      valam_support_email: brand.supportEmail,
      valam_currency: 'INR',
      valam_free_shipping_threshold: brand.shippingThresholdINR,
      // Shopify money values are stored in the smallest unit (paise).
      valam_free_shipping_threshold_cents: brand.shippingThresholdINR * 100,
      valam_free_shipping_progress_text: `You're [amount] away from free shipping`,
      valam_free_shipping_success_text: `You've unlocked free shipping!`,
      sections: {
        'valam-announcement-bar': section(
          'announcement-bar',
          {
            auto_rotate: announcementBlocks.length > 1,
            change_slides_speed: 5,
            color_scheme: 'scheme-1',
          },
          'announcement',
          announcementBlocks,
        ),
        'valam-trust-badges': section(
          'valam-trust-badges',
          {
            heading: `Why shop with ${brand.brandName}`,
            columns_desktop: Math.min(4, brand.trustBadges.length),
          },
          'badge',
          brand.trustBadges.map((title) => ({
            type: 'badge',
            settings: { title, icon: iconForBadge(title) },
          })),
        ),
        'valam-coupon-ladder': section(
          'valam-coupon-ladder',
          { heading: 'Unlock more savings', show_in_cart: ladder.length > 0 },
          'tier',
          ladder.map((tier) => ({
            type: 'tier',
            settings: {
              min_cart_inr: tier.minCartINR,
              min_cart_cents: tier.minCartINR * 100,
              discount_percent: tier.discountPercent,
              code: tier.code,
              message: couponMessage(tier),
            },
          })),
        ),
      },
    },
  };

  assertNoBannedStrings(data, brand);
  return data;
}
