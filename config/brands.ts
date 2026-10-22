/**
 * Brand registry for every client store the toolkit manages.
 *
 * This is the single source of truth: theme settings, SEO tags, QA checks, uptime
 * monitoring and the product API all read from here, so no copy is ever pasted
 * from one store into another. Shipping thresholds, coupon ladders and support
 * e-mails are agency defaults — confirm them with each client before deploying.
 */

/** Commerce platform a brand runs on. Drives which checks/tools apply. */
export type Platform = 'shopify' | 'woocommerce' | 'amazon';

/** Stable, URL-safe identifiers used on the CLI (`--brand shibori`) and in API paths. */
export const BRAND_IDS = [
  'shibori',
  'manpasand',
  'westernvastr',
  'joyfeel',
  'padmabyd',
  'crzycozy',
  'cafora',
  'cruxfab',
] as const;

export type BrandId = (typeof BRAND_IDS)[number];

/** Homepage-level SEO defaults. Titles must be 30–60 chars, descriptions 70–160. */
export interface BrandSeo {
  homeTitle: string;
  homeDescription: string;
  /** Absolute URL of the default 1200×630 social share image. */
  ogImage: string;
  keywords: string[];
}

/** One rung of the cart coupon ladder ("spend ₹X, get Y% off with CODE"). */
export interface CouponTier {
  minCartINR: number;
  discountPercent: number;
  code: string;
}

/** Everything the toolkit knows about a single brand. */
export interface BrandConfig {
  id: BrandId;
  brandName: string;
  /** Storefront hostnames, primary first. Only these hosts are ever fetched. */
  domains: string[];
  platform: Platform;
  category: string;
  /** Cart value (INR) above which shipping is free. */
  shippingThresholdINR: number;
  /** Placeholder support address — replace with the client's real inbox when onboarding. */
  supportEmail: string;
  seo: BrandSeo;
  /** Strings that must never appear on this brand's site (other clients' names). */
  bannedStrings: string[];
  /** Short trust statements rendered as badges by the theme. */
  trustBadges: string[];
  /** Ascending coupon ladder rendered in the cart / announcement bar. */
  couponLadder: CouponTier[];
  /** Marketplace storefront for reference only — never crawled by the toolkit. */
  marketplaceUrl?: string;
}

/** Brand data without the derived `bannedStrings` field. */
type BrandSeed = Omit<BrandConfig, 'bannedStrings'>;

const SEEDS: readonly BrandSeed[] = [
  {
    id: 'shibori',
    brandName: 'Shibori Indian',
    domains: ['shibori.in'],
    platform: 'shopify',
    category: "Women's ethnic wear, Navratri lehengas",
    shippingThresholdINR: 999,
    supportEmail: 'support-shibori@example.com',
    seo: {
      homeTitle: 'Shibori Indian | Navratri Lehengas & Ethnic Wear',
      homeDescription:
        'Shop handcrafted Navratri lehengas, chaniya cholis and ethnic wear for women at Shibori Indian. Free shipping above ₹999 and easy returns.',
      ogImage: 'https://shibori.in/cdn/shop/files/og-default.jpg',
      keywords: ['navratri lehenga', 'chaniya choli', 'ethnic wear for women', 'garba outfit'],
    },
    trustBadges: [
      'Handcrafted in India',
      'Free shipping above ₹999',
      '7-day easy returns',
      'Secure payments',
    ],
    couponLadder: [
      { minCartINR: 1999, discountPercent: 5, code: 'SHIBORI5' },
      { minCartINR: 3499, discountPercent: 10, code: 'SHIBORI10' },
      { minCartINR: 5999, discountPercent: 15, code: 'SHIBORI15' },
    ],
  },
  {
    id: 'manpasand',
    brandName: 'Manpasand Fashion',
    domains: ['manpasandfashion.in'],
    platform: 'shopify',
    category: 'Sarees, Anarkali gowns',
    shippingThresholdINR: 1499,
    supportEmail: 'support-manpasand@example.com',
    seo: {
      homeTitle: 'Manpasand Fashion | Sarees & Anarkali Gowns Online',
      homeDescription:
        'Discover silk sarees, georgette sarees and flowing Anarkali gowns at Manpasand Fashion. Festive and wedding styles with free shipping above ₹1,499.',
      ogImage: 'https://manpasandfashion.in/cdn/shop/files/og-default.jpg',
      keywords: ['sarees online', 'anarkali gown', 'silk saree', 'wedding saree'],
    },
    trustBadges: [
      'Quality-checked sarees',
      'Free shipping above ₹1,499',
      'COD available',
      'Secure payments',
    ],
    couponLadder: [
      { minCartINR: 2499, discountPercent: 5, code: 'MANPASAND5' },
      { minCartINR: 4999, discountPercent: 10, code: 'MANPASAND10' },
    ],
  },
  {
    id: 'westernvastr',
    brandName: 'Western Vastr',
    domains: ['westernvastr.com'],
    platform: 'shopify',
    category: "Women's co-ord sets",
    shippingThresholdINR: 799,
    supportEmail: 'support-westernvastr@example.com',
    seo: {
      homeTitle: "Western Vastr | Women's Co-ord Sets Online",
      homeDescription:
        'Shop matching co-ord sets for women at Western Vastr: linen, cotton and printed two-piece sets for work, travel and weekends. Free shipping above ₹799.',
      ogImage: 'https://westernvastr.com/cdn/shop/files/og-default.jpg',
      keywords: ['co-ord sets for women', 'two piece set', 'linen co-ord', 'matching set'],
    },
    trustBadges: [
      'Size-inclusive fits',
      'Free shipping above ₹799',
      'Easy exchanges',
      'Secure payments',
    ],
    couponLadder: [
      { minCartINR: 1499, discountPercent: 5, code: 'VASTR5' },
      { minCartINR: 2999, discountPercent: 12, code: 'VASTR12' },
    ],
  },
  {
    id: 'joyfeel',
    brandName: 'JoyFeel',
    domains: ['joyfeel.in'],
    platform: 'shopify',
    category: 'Sarees, co-ord sets',
    shippingThresholdINR: 999,
    supportEmail: 'support-joyfeel@example.com',
    seo: {
      homeTitle: 'JoyFeel | Sarees & Co-ord Sets for Women',
      homeDescription:
        'JoyFeel brings easy-drape sarees and comfortable co-ord sets for everyday and festive wear. Shop new arrivals with free shipping above ₹999.',
      ogImage: 'https://joyfeel.in/cdn/shop/files/og-default.jpg',
      keywords: ['sarees for women', 'co-ord sets', 'ready to wear saree', 'festive wear'],
    },
    trustBadges: [
      'Comfort-first fabrics',
      'Free shipping above ₹999',
      'Easy returns',
      'Secure payments',
    ],
    couponLadder: [
      { minCartINR: 1999, discountPercent: 5, code: 'JOYFEEL5' },
      { minCartINR: 3999, discountPercent: 10, code: 'JOYFEEL10' },
    ],
  },
  {
    id: 'padmabyd',
    brandName: 'Padma BYD',
    domains: ['padmabyd.com'],
    platform: 'shopify',
    category: 'Fashion',
    shippingThresholdINR: 1199,
    supportEmail: 'support-padmabyd@example.com',
    seo: {
      homeTitle: 'Padma BYD | Shop Contemporary Fashion Online',
      homeDescription:
        'Padma BYD designs contemporary fashion with Indian craft at heart. Explore the latest collection online with free shipping on orders above ₹1,199.',
      ogImage: 'https://padmabyd.com/cdn/shop/files/og-default.jpg',
      keywords: ['contemporary fashion', 'designer wear', 'indian fashion label'],
    },
    trustBadges: [
      'Designed in India',
      'Free shipping above ₹1,199',
      'Easy returns',
      'Secure payments',
    ],
    couponLadder: [
      { minCartINR: 2999, discountPercent: 5, code: 'PADMA5' },
      { minCartINR: 5999, discountPercent: 10, code: 'PADMA10' },
    ],
  },
  {
    id: 'crzycozy',
    brandName: 'CrzyCozy Customs',
    // India store first; US and UK storefronts are separate Shopify markets/stores.
    domains: ['crzycozy.in', 'us.crzycozy.com', 'uk.crzycozy.com'],
    platform: 'shopify',
    category: 'Custom products',
    shippingThresholdINR: 1299,
    supportEmail: 'support-crzycozy@example.com',
    seo: {
      homeTitle: 'CrzyCozy Customs | Personalised Custom Products',
      homeDescription:
        'Design personalised hoodies, mugs, cushions and gifts at CrzyCozy Customs. Upload your photo or text and we print it for you with fast shipping.',
      ogImage: 'https://crzycozy.in/cdn/shop/files/og-default.jpg',
      keywords: ['custom hoodie', 'personalised gifts', 'photo mug', 'custom cushion'],
    },
    trustBadges: [
      'Made to order',
      'Free shipping above ₹1,299',
      'Print-quality guarantee',
      'Secure payments',
    ],
    couponLadder: [
      { minCartINR: 1999, discountPercent: 5, code: 'COZY5' },
      { minCartINR: 3499, discountPercent: 10, code: 'COZY10' },
    ],
  },
  {
    id: 'cafora',
    brandName: 'Cafora Chocolate',
    domains: ['cafora.in'],
    platform: 'woocommerce',
    category: 'Handmade chocolates, hampers',
    shippingThresholdINR: 1500,
    supportEmail: 'support-cafora@example.com',
    seo: {
      homeTitle: 'Cafora Chocolate | Handmade Chocolates & Hampers',
      homeDescription:
        'Handmade chocolates, truffles and festive gift hampers from Cafora Chocolate. Freshly made in small batches and shipped across India.',
      ogImage: 'https://cafora.in/wp-content/uploads/og-default.jpg',
      keywords: ['handmade chocolates', 'chocolate hamper', 'diwali gift hamper', 'truffles'],
    },
    trustBadges: [
      'Small-batch handmade',
      'Free shipping above ₹1,500',
      'Heat-safe packaging',
      'Secure payments',
    ],
    couponLadder: [{ minCartINR: 2500, discountPercent: 10, code: 'CAFORA10' }],
  },
  {
    id: 'cruxfab',
    brandName: 'CRUXFAB',
    domains: ['cruxfab.in'],
    platform: 'amazon',
    category: 'Home health products',
    shippingThresholdINR: 499,
    supportEmail: 'support-cruxfab@example.com',
    seo: {
      homeTitle: 'CRUXFAB | Home Health Products for Everyday Care',
      homeDescription:
        'CRUXFAB makes reliable home health products for everyday care. Browse the range and buy on our official Amazon.in store with fast delivery.',
      ogImage: 'https://cruxfab.in/og-default.jpg',
      keywords: ['home health products', 'health care devices', 'cruxfab amazon'],
    },
    trustBadges: ['Sold on Amazon.in', 'Fast delivery', 'Easy returns', 'Secure payments'],
    couponLadder: [],
    marketplaceUrl: 'https://www.amazon.in/s?k=CRUXFAB',
  },
];

/**
 * Every other brand's name is banned on a given store. This catches the classic
 * agency mistake of duplicating a theme and leaving the previous client's name in it.
 */
function bannedFor(seed: BrandSeed): string[] {
  return SEEDS.filter((other) => other.id !== seed.id).map((other) => other.brandName);
}

/** All brands, keyed by id, with derived `bannedStrings`. */
export const BRANDS: Readonly<Record<BrandId, BrandConfig>> = Object.freeze(
  Object.fromEntries(
    SEEDS.map((seed) => [seed.id, { ...seed, bannedStrings: bannedFor(seed) }]),
  ) as Record<BrandId, BrandConfig>,
);

/** Brands as an ordered array (same order as BRAND_IDS). */
export const ALL_BRANDS: readonly BrandConfig[] = BRAND_IDS.map((id) => BRANDS[id]);

/** Normalises user input like "Western-Vastr" or "western vastr" to "westernvastr". */
function normalise(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Looks a brand up by id, brand name or any of its domains (case/punctuation insensitive).
 * Throws with the list of valid ids when nothing matches.
 */
export function resolveBrand(input: string): BrandConfig {
  const key = normalise(input);
  const match = ALL_BRANDS.find(
    (brand) =>
      brand.id === key ||
      normalise(brand.brandName) === key ||
      brand.domains.some((domain) => normalise(domain) === key),
  );
  if (!match) {
    throw new Error(`Unknown brand "${input}". Valid brands: ${BRAND_IDS.join(', ')}`);
  }
  return match;
}

/** Brands whose storefront is a Shopify store (public products.json available). */
export function shopifyBrands(): BrandConfig[] {
  return ALL_BRANDS.filter((brand) => brand.platform === 'shopify');
}

/** Every hostname the toolkit is allowed to contact (bare and www. variants). */
export function allowedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const brand of ALL_BRANDS) {
    for (const domain of brand.domains) {
      hosts.add(domain);
      hosts.add(`www.${domain}`);
    }
  }
  return hosts;
}
