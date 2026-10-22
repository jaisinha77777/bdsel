# valam-store-toolkit

Developer and SEO tooling for Valam's client stores. One TypeScript (Node 20) monorepo
that keeps every store's theme copy, SEO tags and health checks generated from a single
typed brand registry, so nothing is copy-pasted between stores and another client's
name never leaks onto the wrong site.

| Package                      | What it does                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/`                    | Typed brand registry (`config/brands.ts`): domains, platform, shipping threshold, SEO copy, coupon ladder, banned strings.                               |
| `packages/core`              | Shared plumbing: polite HTTP client (domain allowlist, robots.txt, per-host rate limit, User-Agent), Shopify feed client, HTML helpers.                  |
| `packages/theme-config`      | Generates Shopify `settings_data.json` fragments (brand name, trust badges, free-shipping threshold, coupon ladder).                                     |
| `packages/seo`               | Title/description, Open Graph, Twitter, Organization/WebSite/Product/BreadcrumbList JSON-LD, Liquid snippets, robots.txt and sitemap checks, validators. |
| `packages/qa-checker`        | Storefront QA reports: catalogue health, permanent discounts, missing meta, banned strings, placeholders, free-shipping conflicts, broken nav links.     |
| `packages/uptime-monitor`    | Daily check of every domain (HTTP errors, DNS failures, Shopify "store unavailable"); Slack/Discord webhook summary.                                     |
| `packages/product-endpoints` | Express API proxying a store's product feed with a 5-minute cache and rate-limited outbound calls.                                                       |

## Brands

| Brand             | Id             | Domain(s)                                     | Platform    | Category                               |
| ----------------- | -------------- | --------------------------------------------- | ----------- | -------------------------------------- |
| Shibori Indian    | `shibori`      | shibori.in                                    | Shopify     | Women's ethnic wear, Navratri lehengas |
| Manpasand Fashion | `manpasand`    | manpasandfashion.in                           | Shopify     | Sarees, Anarkali gowns                 |
| Western Vastr     | `westernvastr` | westernvastr.com                              | Shopify     | Women's co-ord sets                    |
| JoyFeel           | `joyfeel`      | joyfeel.in                                    | Shopify     | Sarees, co-ord sets                    |
| Padma BYD         | `padmabyd`     | padmabyd.com                                  | Shopify     | Fashion                                |
| CrzyCozy Customs  | `crzycozy`     | crzycozy.in, us.crzycozy.com, uk.crzycozy.com | Shopify     | Custom products                        |
| Cafora Chocolate  | `cafora`       | cafora.in                                     | WooCommerce | Handmade chocolates, hampers           |
| CRUXFAB           | `cruxfab`      | cruxfab.in (+ Amazon.in store)                | Amazon      | Home health products                   |

Shipping thresholds, coupon codes and support e-mails in `config/brands.ts` are agency
defaults/placeholders. Confirm them with each client before deploying.

## Setup

```bash
# Node 20.12+ and pnpm 10 (corepack enable && corepack prepare pnpm@10.28.0 --activate)
pnpm install
cp .env.example .env      # then fill in MONITOR_WEBHOOK_URL etc.
pnpm check                # typecheck + lint + prettier + tests
```

## Commands

Every tool takes `--brand <id>` (id, brand name or domain) or `--all`.

| Tool             | Command                                                                 | Output                                                   |
| ---------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Theme settings   | `npm run theme:config -- --brand shibori`                               | `out/shibori/settings_data.json`                         |
| SEO bundle       | `npm run seo:generate -- --brand shibori`                               | `out/shibori/seo/` (head.html, JSON-LD, Liquid snippets) |
| SEO audit (live) | `npm run seo:audit -- --brand shibori`                                  | Console: homepage meta/alt, robots.txt, sitemap          |
| QA report (live) | `npm run qa -- --brand shibori` (`--deep-alt` to check alt per product) | `reports/shibori-<date>.md` + `.json`                    |
| Uptime (live)    | `npm run monitor` (`--strict`, `--dry-run`, `--skip-dns`)               | Console, `reports/uptime-<date>.json`, webhook           |
| Product API      | `npm run api`                                                           | `http://localhost:3000`                                  |
| Tests            | `npm test`                                                              | Vitest, fixtures only, no network                        |

### Theme settings

`settings_data.json` fragments use `valam_*` setting ids and `valam-*` section ids so they
merge into any theme without clobbering its own settings. The generator refuses to write
a file that contains any of the brand's banned strings.

### Liquid snippets

Copy `packages/seo/liquid/snippets/*.liquid` (also written to `out/<brand>/seo/snippets/`)
into the theme's `snippets/` folder, then:

```liquid
{%- # layout/theme.liquid, inside <head>, replacing the theme's own title/meta tags -%}
{%- render 'seo-meta' -%}

{%- # sections/main-product.liquid -%}
{%- render 'product-schema', product: product -%}
```

Both snippets use only Shopify's own objects (`shop`, `product`, `collection`,
`page_title`, `page_description`, `page_image`, `canonical_url`), so the same file works
on every store.

### Product API

```
GET /health
GET /brands
GET /:brand/collections
GET /:brand/products?collection=<handle>&inStock=true|false
GET /:brand/products/:handle
```

Responses carry `X-Cache: HIT|MISS`. Stock is reported as `inStock` (boolean) because
public storefront feeds expose availability, not inventory counts. Non-Shopify brands
return `501`.

### Uptime monitor

`.github/workflows/monitor.yml` runs daily at 03:15 UTC (08:45 IST) and on demand. Add a
repository secret `MONITOR_WEBHOOK_URL` (a Slack incoming webhook or a Discord webhook;
the payload carries both `text` and `content`). Optionally set a repository variable
`TOOLKIT_CONTACT` for the User-Agent.

## Crawling etiquette

- Requests go only to the domains in `config/brands.ts` (and their `www.` variants); any
  other host throws `HostNotAllowedError`. The Amazon storefront is never crawled. The
  webhook POST is the only other outbound call.
- `robots.txt` is fetched once per origin and honoured (RFC 9309: 4xx = allow all,
  5xx = disallow all). Disallowed nav links are reported as skipped, not broken.
- Requests to one host are spaced by `REQUEST_INTERVAL_MS` (default 1 s); 429/503 are
  retried at most twice, honouring `Retry-After`.
- Every request sends `User-Agent: ValamStoreToolkit/1.0 (+https://github.com/jaisinha77777/bdsel; <TOOLKIT_CONTACT>)`.
- Nav-link checks use `HEAD` (GET fallback on 405/501) and don't follow redirects off-site.

## Repository layout

```
.
├── .env.example
├── .github/workflows/{ci.yml,monitor.yml}
├── config/                 brands.ts (+ test)
├── fixtures/               shibori/, manpasand/, westernvastr/, cafora/ (JSON, HTML, robots, sitemaps)
├── packages/
│   ├── core/               http, robots, rate-limiter, shopify, html, format, env, paths, testing
│   ├── theme-config/       generate, write, cli
│   ├── seo/                meta, jsonld, validate, robots-check, sitemap, audit, liquid, cli
│   │   └── liquid/snippets/{seo-meta.liquid,product-schema.liquid}
│   ├── qa-checker/         catalog, homepage, run, report, cli
│   ├── uptime-monitor/     check, summary, cli
│   └── product-endpoints/  cache, transform, app, server
├── out/                    generated theme/SEO files (git-ignored)
└── reports/                QA and uptime reports (git-ignored)
```
