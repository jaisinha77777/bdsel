/**
 * Minimal RFC 9309 robots.txt parser and matcher.
 *
 * Supports user-agent groups, Allow/Disallow with `*` and `$` wildcards, longest-match
 * precedence (Allow wins ties) and Sitemap directives.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  /** Lower-cased user-agent tokens this group applies to (`*` for everyone). */
  agents: string[];
  rules: RobotsRule[];
}

export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
}

/** A robots policy that allows everything (used when robots.txt is a 4xx). */
export const ALLOW_ALL: RobotsTxt = { groups: [], sitemaps: [] };

/** A robots policy that disallows everything (used when robots.txt is a 5xx). */
export const DISALLOW_ALL: RobotsTxt = {
  groups: [{ agents: ['*'], rules: [{ allow: false, pattern: '/' }] }],
  sitemaps: [],
};

/** Parses robots.txt text into groups and sitemap URLs. */
export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // True while we are still reading consecutive user-agent lines of one group.
  let collectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if (key === 'allow' || key === 'disallow') {
      collectingAgents = false;
      // Rules before any user-agent line are ignored, per the RFC.
      if (!current) continue;
      // An empty Disallow means "allow everything" and contributes no rule.
      if (value === '') continue;
      current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'sitemap') {
      if (value) sitemaps.push(value);
    }
  }
  return { groups, sitemaps };
}

/** Converts a robots path pattern to an anchored regular expression. */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/**
 * Decides whether `path` (path + query) may be fetched by a crawler identifying
 * with `productToken`. Groups naming the token take precedence over `*`.
 */
export function isPathAllowed(robots: RobotsTxt, productToken: string, path: string): boolean {
  const token = productToken.toLowerCase();
  const specific = robots.groups.filter((g) =>
    g.agents.some((agent) => agent !== '*' && token.includes(agent)),
  );
  const applicable =
    specific.length > 0 ? specific : robots.groups.filter((g) => g.agents.includes('*'));
  const rules = applicable.flatMap((g) => g.rules);

  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
