/**
 * Text utilities for SEO copy: HTML stripping and length fitting at word boundaries.
 */

/** Removes tags and decodes the handful of entities Shopify descriptions commonly contain. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shortens `text` to at most `max` characters, cutting at the last word boundary and
 * appending an ellipsis. Text already within the limit is returned unchanged.
 */
export function fitToLength(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  // Prefer a word boundary; only cut mid-word when the first word alone is too long.
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s,.;:|–-]+$/, '')}…`;
}
