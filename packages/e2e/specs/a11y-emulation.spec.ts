import type { Page } from '@playwright/test';
import {
  forcedColorsPasses,
  forcedColorsResult,
  zoomPasses,
  zoomResult,
  type BoundaryMeasure,
  type ControlMeasure,
} from '../src/a11y/emulation';
import { expect, test } from '../src/fixtures/base';
import { ROUTE_CASES } from '../src/fixtures/routes';

/**
 * Automated proxies for two manual checks (issue 2195, docs/A11Y.md):
 *
 * - 200 percent zoom emulation: a 640 by 512 viewport at device scale factor 1 is 200 percent of
 *   1280 by 1024. Every route and state must have no sideways page scroll and no control outside
 *   the viewport or with clipped text (the audit table scrolls sideways on purpose).
 * - Forced colours emulation (a native file input is left out: its button is drawn by the browser) (`forced-colors: active`, Chromium): every button, field and link must
 *   keep a border, an outline or an underline, and a screenshot is attached for a person to look at.
 *
 * These are emulations. Nobody has zoomed a real browser or used Windows High Contrast, the manual
 * rows stay "not yet performed", and a green run here changes none of them. Each run attaches its
 * measurements as JSON to the Playwright report.
 */

const CONTROLS =
  'a[href], button, input, select, textarea, [role="button"], [role="radio"], [tabindex]:not([tabindex="-1"])';

test.describe('200 percent zoom emulation (640 x 512 at scale factor 1)', () => {
  test.use({ viewport: { width: 640, height: 512 }, deviceScaleFactor: 1 });
  test.skip(({ isMobile }) => isMobile, 'a mobile project has its own viewport and scale factor');

  for (const route of ROUTE_CASES) {
    test(`zoom ${route.name}`, async ({ page, stack }, testInfo) => {
      await route.open(page, stack);
      await page.waitForTimeout(300);
      const measured = await measureForZoom(page);
      const result = zoomResult(measured.viewportWidth, measured.scrollWidth, measured.controls);
      await testInfo.attach(`zoom-${route.name.replace(/\W+/g, '_')}.json`, {
        body: JSON.stringify({ route: route.name, ...result }, null, 2),
        contentType: 'application/json',
      });
      expect(
        { horizontalScroll: result.horizontalScroll, findings: result.findings },
        `${route.name}: ${zoomPasses(result) ? 'fits' : 'does not fit'} at 200 percent emulation`,
      ).toEqual({ horizontalScroll: false, findings: [] });
    });
  }
});

test.describe('forced colours emulation', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'forced colours is emulated in Chromium',
  );
  test.skip(({ isMobile }) => isMobile, 'the desktop project covers it');

  for (const route of ROUTE_CASES) {
    test(`forced colours ${route.name}`, async ({ page, stack }, testInfo) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await route.open(page, stack);
      await page.waitForTimeout(300);
      const measured = await measureForcedColors(page);
      const result = forcedColorsResult(measured.matches, measured.controls);
      const slug = route.name.replace(/\W+/g, '_');
      await testInfo.attach(`forced-colors-${slug}.json`, {
        body: JSON.stringify({ route: route.name, ...result }, null, 2),
        contentType: 'application/json',
      });
      await testInfo.attach(`forced-colors-${slug}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
      expect(
        { matches: result.forcedColorsMatches, borderless: result.borderless },
        `${route.name}: ${forcedColorsPasses(result) ? 'keeps a boundary' : 'has borderless controls'}`,
      ).toEqual({ matches: true, borderless: [] });
    });
  }
});

async function measureForZoom(
  page: Page,
): Promise<{ viewportWidth: number; scrollWidth: number; controls: ControlMeasure[] }> {
  return page.evaluate((selector) => {
    const describe = (el: Element): string => {
      const id = el.id === '' ? '' : `#${el.id}`;
      const cls =
        typeof el.className === 'string' && el.className !== ''
          ? `.${el.className.split(/\s+/)[0] ?? ''}`
          : '';
      const role = el.getAttribute('data-testid');
      return `${el.tagName.toLowerCase()}${id}${cls}${role === null ? '' : `[${role}]`}`;
    };
    const inScroll = (el: Element): boolean => {
      for (let n = el.parentElement; n !== null; n = n.parentElement) {
        const s = getComputedStyle(n);
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth) {
          return true;
        }
      }
      return false;
    };
    const controls = [...document.querySelectorAll(selector)].flatMap((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return [];
      const clip = s.overflowX === 'hidden' || s.overflowX === 'clip';
      return [
        {
          desc: describe(el),
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
          skipLink: el.tagName === 'A' && (el.getAttribute('href') ?? '').startsWith('#'),
          inScrollContainer: inScroll(el),
          clipsOwnText: clip && el.scrollWidth > el.clientWidth + 1,
        },
      ];
    });
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      controls,
    };
  }, CONTROLS);
}

async function measureForcedColors(
  page: Page,
): Promise<{ matches: boolean; controls: BoundaryMeasure[] }> {
  return page.evaluate(() => {
    const describe = (el: Element): string => {
      const id = el.id === '' ? '' : `#${el.id}`;
      const cls =
        typeof el.className === 'string' && el.className !== ''
          ? `.${el.className.split(/\s+/)[0] ?? ''}`
          : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const controls = [
      ...document.querySelectorAll(
        'button, input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="file"]), select, textarea, a[href]',
      ),
    ].flatMap((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return [];
      return [
        {
          desc: describe(el),
          tag: el.tagName.toLowerCase(),
          width: r.width,
          height: r.height,
          borderWidthPx: parseFloat(s.borderTopWidth) || 0,
          borderStyle: s.borderTopStyle,
          outlineStyle: s.outlineStyle,
          outlineWidthPx: parseFloat(s.outlineWidth) || 0,
          textDecoration: s.textDecorationLine,
        },
      ];
    });
    return { matches: window.matchMedia('(forced-colors: active)').matches, controls };
  });
}
