import { describe, expect, it } from 'vitest';
import { readFixture } from '../src/testing';
import { isPathAllowed, parseRobotsTxt } from '../src/robots';

describe('robots.txt parser', () => {
  const robots = parseRobotsTxt(readFixture('shibori', 'robots.txt'));

  it('collects sitemap directives', () => {
    expect(robots.sitemaps).toEqual(['https://shibori.in/sitemap.xml']);
  });

  it('applies the * group to our crawler', () => {
    expect(isPathAllowed(robots, 'ValamStoreToolkit', '/products.json?limit=250&page=1')).toBe(
      true,
    );
    expect(isPathAllowed(robots, 'ValamStoreToolkit', '/cart')).toBe(false);
    expect(isPathAllowed(robots, 'ValamStoreToolkit', '/collections/sarees?sort_by=price')).toBe(
      false,
    );
    expect(isPathAllowed(robots, 'ValamStoreToolkit', '/collections/sarees')).toBe(true);
  });

  it('uses a group naming the bot instead of *', () => {
    expect(isPathAllowed(robots, 'AhrefsBot', '/products/anything')).toBe(false);
  });

  it('prefers the longest match and lets Allow win ties', () => {
    const rules = parseRobotsTxt(
      [
        'User-agent: *',
        'Disallow: /wp-admin/',
        'Allow: /wp-admin/admin-ajax.php',
        'Disallow: /a$',
        'Allow: /a$',
      ].join('\n'),
    );
    expect(isPathAllowed(rules, 'x', '/wp-admin/options.php')).toBe(false);
    expect(isPathAllowed(rules, 'x', '/wp-admin/admin-ajax.php')).toBe(true);
    expect(isPathAllowed(rules, 'x', '/a')).toBe(true);
  });

  it('treats an empty Disallow as allow-all and merges multi-agent groups', () => {
    const rules = parseRobotsTxt(
      'User-agent: a\nUser-agent: b\nDisallow: /private\n\nUser-agent: *\nDisallow:\n',
    );
    expect(isPathAllowed(rules, 'b', '/private/x')).toBe(false);
    expect(isPathAllowed(rules, 'other', '/private/x')).toBe(true);
  });
});
