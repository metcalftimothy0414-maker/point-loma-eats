import type { SourcePlatform } from './types.ts';

const PLATFORM_HOST_PATTERNS: [RegExp, SourcePlatform][] = [
  [/(^|\.)toasttab\.com$/, 'toast'],
  [/(^|\.)square\.site$/, 'square'],
  [/(^|\.)clover\.com$/, 'clover'],
  [/(^|\.)chownow\.com$/, 'chownow'],
];

/**
 * Detects platform from the URL's hostname first — cheap and reliable when
 * a restaurant site links straight to a platform-hosted ordering page.
 * Falls back to sniffing the fetched HTML for platform markers when the
 * hostname alone doesn't say (e.g. a custom domain proxying one of these
 * platforms). Anything unrecognized is 'generic' — the Claude vision
 * fallback, not a hard failure.
 */
export function detectPlatform(url: string, html: string): SourcePlatform {
  const hostname = new URL(url).hostname;
  for (const [pattern, platform] of PLATFORM_HOST_PATTERNS) {
    if (pattern.test(hostname)) return platform;
  }

  if (html.includes('toasttab.com')) return 'toast';
  if (html.includes('square.site') || html.includes('squareup.com/online-store')) return 'square';
  if (html.includes('clover.com/online-ordering') || html.includes('cloverstatic.com')) return 'clover';
  if (html.includes('chownow.com') || html.includes('api.chownow.com')) return 'chownow';

  return 'generic';
}
