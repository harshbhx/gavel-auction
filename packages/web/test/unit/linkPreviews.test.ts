// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_PREVIEWS, SITE_ORIGIN, renderRoutePreview } from '../../vite.config';

const workerFile = path.resolve(__dirname, '../../../../infra/web/worker.mjs');
const { KNOWN_ROUTES } = (await import(pathToFileURL(workerFile).href)) as {
  KNOWN_ROUTES: string[];
};
const INDEX = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const OG_DIR = path.resolve(__dirname, '../../public/og');

function meta(html: string, key: string): string | undefined {
  const m = new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`).exec(html);
  return m?.[1];
}

const REQUIRED = [
  'description',
  'og:title',
  'og:description',
  'og:url',
  'og:type',
  'og:site_name',
  'og:image',
  'og:image:width',
  'og:image:height',
  'og:image:alt',
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image',
  'twitter:image:alt',
  'theme-color',
] as const;

const PAGES: ReadonlyArray<readonly [string, string]> = [
  ['/', INDEX],
  ...ROUTE_PREVIEWS.map((p) => [p.path, renderRoutePreview(INDEX, p)] as const),
];

describe('link previews (crawlers do not run JavaScript)', () => {
  it('every previewed route is a real app route', () => {
    for (const p of ROUTE_PREVIEWS) expect(KNOWN_ROUTES).toContain(p.path);
  });

  describe.each(PAGES)('%s', (route, html) => {
    it('has every Open Graph and Twitter tag, with a non-empty value', () => {
      for (const key of REQUIRED) expect(meta(html, key), `${route}: ${key}`).toBeTruthy();
      expect(meta(html, 'twitter:card')).toBe('summary_large_image');
      expect(html).toMatch(/<link rel="canonical" href="https:\/\/gavel\.dualmindlab\.tech[^"]*"/);
      expect(html).toMatch(/<title>[^<]+<\/title>/);
    });

    it('names absolute https URLs on the live domain', () => {
      const expectedUrl = `${SITE_ORIGIN}${route}`;
      expect(meta(html, 'og:url')).toBe(expectedUrl);
      for (const key of ['og:image', 'twitter:image']) {
        expect(meta(html, key)).toMatch(/^https:\/\/gavel\.dualmindlab\.tech\/og\/[a-z-]+\.png$/);
      }
      expect(meta(html, 'og:image')).toBe(meta(html, 'twitter:image'));
    });

    it('points at a 1200x630 PNG under 300 KB that exists in public/og', () => {
      const file = path.join(OG_DIR, path.basename(meta(html, 'og:image') ?? ''));
      expect(existsSync(file), file).toBe(true);
      const buf = readFileSync(file);
      expect(buf.subarray(1, 4).toString()).toBe('PNG');
      expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1200, 630]);
      expect(statSync(file).size).toBeLessThan(300_000);
    });
  });

  it('the landing page adds no render-blocking resource for the preview', () => {
    expect(INDEX).not.toMatch(/<link[^>]+rel="preload"[^>]+og/);
  });

  it('keeps the shipped fallback and GitHub cards', () => {
    expect(existsSync(path.join(OG_DIR, 'og-square.png'))).toBe(true);
  });
});
