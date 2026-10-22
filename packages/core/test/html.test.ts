import { describe, expect, it } from 'vitest';
import {
  auditImageAlts,
  extractNavLinks,
  getMetaContent,
  getTitle,
  visibleText,
} from '../src/html';
import { formatINR, istDate } from '../src/format';
import { readFixture } from '../src/testing';

describe('HTML helpers', () => {
  const shibori = readFixture('shibori', 'homepage.html');

  it('reads title and meta description', () => {
    expect(getTitle(shibori)).toBe('Shibori Indian | Navratri Lehengas & Ethnic Wear');
    expect(getMetaContent(shibori, 'description')).toMatch(/^Shop handcrafted/);
    expect(getMetaContent(readFixture('manpasand', 'homepage.html'), 'description')).toBeNull();
  });

  it('extracts internal nav links only, without fragments or duplicates', () => {
    expect(extractNavLinks(shibori, 'https://shibori.in/')).toEqual([
      'https://shibori.in/',
      'https://shibori.in/collections/navratri-lehengas',
      'https://shibori.in/collections/chaniya-choli',
      'https://shibori.in/collections/new-arrivals',
      'https://shibori.in/pages/about-us',
      'https://shibori.in/cart',
    ]);
  });

  it('treats www. and bare hosts as the same site', () => {
    const links = extractNavLinks(
      readFixture('westernvastr', 'homepage.html'),
      'https://westernvastr.com/',
    );
    expect(links).toContain('https://www.westernvastr.com/collections/linen-edit');
  });

  it('audits image alt attributes', () => {
    const audit = auditImageAlts(readFixture('westernvastr', 'homepage.html'));
    expect(audit).toEqual({ missing: [], empty: ['/cdn/shop/files/divider.svg'], total: 2 });
    expect(auditImageAlts(readFixture('manpasand', 'homepage.html')).missing).toEqual([
      '/cdn/shop/files/hero-saree.jpg',
    ]);
  });

  it('returns visible text without HTML comments or scripts', () => {
    const text = visibleText(
      '<p>Hi <b>there</b></p><script>var x = "hidden"</script><!-- secret -->',
    );
    expect(text).toBe('Hi there');
  });

  it('formats rupees and IST dates', () => {
    expect(formatINR(1499)).toBe('₹1,499');
    expect(formatINR(150000)).toBe('₹1,50,000');
    expect(istDate(new Date('2026-10-21T20:00:00Z'))).toBe('2026-10-22');
  });
});
