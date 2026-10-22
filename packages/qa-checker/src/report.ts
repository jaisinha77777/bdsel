/**
 * Renders QA reports as Markdown and writes reports/<brand>-<date>.{md,json}.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DomainReport, Finding, QaReport } from './types';

const ICON: Record<Finding['severity'], string> = { error: '🔴', warning: '🟠', info: 'ℹ️' };
const PLATFORM: Record<QaReport['platform'], string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  amazon: 'Amazon',
};

/** Escapes characters that would break a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderFindings(findings: Finding[]): string[] {
  if (findings.length === 0) return ['No issues found. ✅', ''];
  const lines = ['| | Check | Details |', '|---|---|---|'];
  for (const f of findings) {
    const items =
      f.items && f.items.length > 0 ? `<br>${f.items.map((i) => `\`${cell(i)}\``).join(', ')}` : '';
    lines.push(`| ${ICON[f.severity]} | ${f.check} | ${cell(f.message)}${items} |`);
  }
  lines.push('');
  return lines;
}

function renderDomain(d: DomainReport): string[] {
  const lines = [`## ${d.domain}`, '', '### Findings', '', ...renderFindings(d.findings)];

  if (d.catalog) {
    const c = d.catalog;
    lines.push(
      '### Catalogue',
      '',
      `- Products: **${c.productCount}** (${c.variantCount} variants)`,
      `- Collections: ${c.collectionCount} (${c.emptyCollections.length} empty)`,
      `- Sold out: ${c.soldOut.length}`,
      `- Without images: ${c.noImages.length}`,
      `- Missing alt text: ${c.altSource === 'not-exposed' ? 'not checked (feed has no alt)' : c.missingAlt.length}`,
      `- Variants with compare-at price: ${(c.discountedVariantRatio * 100).toFixed(1)}%${c.permanentDiscount ? ' ⚠️ permanent discount' : ''}`,
      '',
    );
  }

  const h = d.homepage;
  if (h.fetched) {
    lines.push(
      '### Homepage',
      '',
      `- Title: ${h.title ? `“${h.title}”` : '_missing_'}`,
      `- Meta description: ${h.metaDescription ? `“${h.metaDescription}”` : '_missing_'}`,
      `- Free-shipping amounts mentioned: ${h.freeShippingAmountsINR.length > 0 ? h.freeShippingAmountsINR.map((a) => `₹${a}`).join(', ') : 'none'}`,
      '',
    );
    if (h.navLinks.length > 0) {
      lines.push('| Nav link | Status | Result |', '|---|---|---|');
      for (const link of h.navLinks) {
        lines.push(
          `| ${cell(link.url)} | ${link.status ?? '—'} | ${link.ok ? 'OK' : 'BROKEN'}${link.note ? ` (${cell(link.note)})` : ''} |`,
        );
      }
      lines.push('');
    }
  }
  return lines;
}

/** Full Markdown report. */
export function renderMarkdown(report: QaReport): string {
  return [
    `# QA report — ${report.brandName}`,
    '',
    `Generated ${report.generatedAt} · ${PLATFORM[report.platform]} · **${report.summary.errors} errors**, ${report.summary.warnings} warnings`,
    '',
    ...report.domains.flatMap(renderDomain),
  ].join('\n');
}

/** Writes `<dir>/<brand>-<date>.md` and `.json`; returns both paths. */
export async function writeReport(
  report: QaReport,
  dir: string,
): Promise<{ markdown: string; json: string }> {
  await mkdir(dir, { recursive: true });
  const base = join(dir, `${report.brand}-${report.date}`);
  const markdown = `${base}.md`;
  const json = `${base}.json`;
  await writeFile(markdown, `${renderMarkdown(report)}\n`, 'utf8');
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { markdown, json };
}
