// Layout audit of every page at every viewport: overflow, clipping, overlap, covered controls,
// small touch targets, empty first screen, landmarks. Phones are also rotated and re-checked.
import {
  test,
  STATIC_PAGES,
  WEB,
  auditLayout,
  finding,
  gotoOk,
  loadState,
  reportAudit,
  roomPages,
  watch,
} from './lib.js';

const KEY = new Set(['/', '/try', '/demo', '/demo/scripted', 'hub', 'join', 'screen', 'console']);

for (const p of STATIC_PAGES) {
  test(`layout ${p}`, async ({ page }) => {
    const w = watch(page);
    const r = await gotoOk(page, WEB + p);
    if (r.status === 0)
      return finding(page, {
        sev: 'high',
        title: 'Page did not load',
        page: p,
        expected: 'status 200',
        actual: r.error,
      });
    if (r.status >= 500)
      await finding(page, {
        sev: 'high',
        title: `Page answered ${r.status}`,
        page: p,
        expected: '200',
        actual: String(r.status),
      });
    const a = await auditLayout(page);
    const isNotFound = p === '/this-does-not-exist';
    await reportAudit(page, a, {
      key: KEY.has(p),
      skipLandmarks: false,
      skipEmpty: isNotFound && false,
    });
    // rotate: swap the viewport and check again
    const vp = page.viewportSize();
    if (vp && vp.width < 1000) {
      await page.setViewportSize({ width: vp.height, height: vp.width });
      await page.waitForTimeout(500);
      await reportAudit(page, await auditLayout(page), {
        key: KEY.has(p),
        skipLandmarks: true,
        skipEmpty: true,
      });
      await page.setViewportSize(vp);
    }
    await w.flush();
  });
}

test('layout of the room pages (hub, screen, join, bid, receipt, register, console)', async ({
  page,
}) => {
  const state = loadState();
  const pages = roomPages(state);
  test.skip(pages.length === 0, 'no room was created for this run');
  const w = watch(page, { ignoreFailed: /logo|favicon/ });
  for (const [label, url] of pages) {
    const r = await gotoOk(page, url);
    if (r.status === 0) {
      await finding(page, {
        sev: 'high',
        title: 'Room page did not load',
        page: label,
        expected: '200',
        actual: r.error,
      });
      continue;
    }
    await page.waitForTimeout(2500); // sockets and the live preview need a moment
    const a = await auditLayout(page);
    await reportAudit(page, { ...a }, { key: KEY.has(label) });
    // scroll to the bottom and check nothing sticky covers the last controls
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const b = await auditLayout(page);
    if (b.obscured.length)
      await finding(page, {
        sev: 'medium',
        title: 'Control covered at the bottom of the page',
        page: label,
        expected: 'reachable controls',
        actual: b.obscured.join(' ; '),
      });
  }
  await w.flush();
});
