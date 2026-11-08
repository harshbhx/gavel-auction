// axe on every page, keyboard-only walk, dialog focus handling, reduced motion, forced colors.
import AxeBuilder from '@axe-core/playwright';
import {
  test,
  STATIC_PAGES,
  WEB,
  auditLayout,
  bodyText,
  clip,
  finding,
  gotoOk,
  loadState,
  reportAudit,
  roomPages,
  watch,
} from './lib.js';

const SEV = { critical: 'high', serious: 'high', moderate: 'medium', minor: 'low' };

async function axe(page, label) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  for (const v of res.violations) {
    await finding(page, {
      sev: SEV[v.impact] || 'low',
      title: `axe ${v.id}: ${v.help}`.slice(0, 110),
      page: label,
      steps: 'run axe-core (wcag2a/aa, 21, 22, best-practice) on the page',
      expected: 'no violation',
      actual: `${v.nodes.length} node(s): ${v.nodes
        .slice(0, 2)
        .map((n) => n.target.join(' '))
        .join(' ; ')}`,
      screenshot: v.impact === 'critical' || v.impact === 'serious',
    });
  }
}

test('axe on every static page', async ({ page }) => {
  for (const p of STATIC_PAGES) {
    await gotoOk(page, WEB + p);
    await axe(page, p);
  }
});

test('axe on the room pages', async ({ page }) => {
  const pages = roomPages(loadState());
  test.skip(pages.length === 0, 'no room');
  for (const [label, url] of pages) {
    await gotoOk(page, url);
    await page.waitForTimeout(2500);
    await axe(page, label);
  }
});

test('keyboard only: tab order, visible focus, no trap', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a physical keyboard is a desktop and tablet case');
  const A = loadState().rooms?.A;
  const pages = [
    ['/', WEB + '/'],
    ['/try', WEB + '/try'],
    ['/demo', WEB + '/demo'],
    ['/demo/scripted', WEB + '/demo/scripted'],
  ];
  if (A) pages.push(['hub', A.hubUrl], ['join', A.joinUrl]);
  const w = watch(page, { allowConsole: true });
  for (const [label, url] of pages) {
    await gotoOk(page, url);
    await page.waitForTimeout(1500);
    const seen = [];
    let noRing = 0;
    let stuck = 0;
    for (let i = 0; i < 45; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      const info = await page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body) return { id: 'body' };
        const s = getComputedStyle(e);
        const ring =
          (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
          (s.boxShadow && s.boxShadow !== 'none');
        const r = e.getBoundingClientRect();
        const inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        return {
          id: `${e.tagName}${e.id ? '#' + e.id : ''}:${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 24)}`,
          ring: Boolean(ring),
          inView,
        };
      });
      if (seen.length && seen[seen.length - 1] === info.id && info.id !== 'body') stuck += 1;
      else stuck = 0;
      if (stuck >= 3) {
        await finding(page, {
          sev: 'high',
          title: 'Keyboard focus trap',
          page: label,
          steps: 'press Tab repeatedly',
          expected: 'focus moves on',
          actual: `focus stays on ${info.id}`,
        });
        break;
      }
      if (info.id !== 'body' && info.ring === false) noRing += 1;
      if (info.id !== 'body' && info.inView === false) {
        await finding(page, {
          sev: 'medium',
          title: 'Focused element is off screen',
          page: label,
          steps: 'Tab through the page',
          expected: 'focused control scrolls into view',
          actual: info.id,
          screenshot: false,
        });
      }
      seen.push(info.id);
      if (seen.length > 3 && seen[0] === info.id) break; // looped back to the first stop
    }
    if (noRing > 0)
      await finding(page, {
        sev: 'medium',
        title: 'Focused control has no visible focus indicator',
        page: label,
        steps: 'Tab through the page',
        expected: 'outline or ring on every focus stop',
        actual: `${noRing} of ${seen.length} stops without outline or box-shadow`,
        screenshot: false,
      });
    if (seen.length < 2)
      await finding(page, {
        sev: 'medium',
        title: 'Almost nothing is reachable with Tab',
        page: label,
        expected: 'links and buttons reachable',
        actual: `${seen.length} stop(s): ${seen.join(', ')}`,
      });
  }
  await w.flush();
});

test('dialogs: focus moves in, stays in, Escape closes, focus returns', async ({ page }) => {
  const w = watch(page, { allowConsole: true });
  await gotoOk(page, WEB + '/demo');
  const open = page.getByRole('button', { name: /i have a room code/i }).first();
  if (!(await open.isVisible().catch(() => false)))
    return finding(page, {
      sev: 'info',
      title: 'No dialog trigger found on /demo',
      page: '/demo',
      expected: 'n/a',
      actual: 'skipped',
    });
  await open.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const dlg = page.getByRole('dialog').first();
  const isDialog = await dlg.isVisible().catch(() => false);
  const inside = () =>
    page.evaluate(() => {
      const d = document.querySelector('[role=dialog],dialog[open]');
      return d ? d.contains(document.activeElement) : null;
    });
  if (!isDialog)
    await finding(page, {
      sev: 'low',
      title: 'Room code box is not a dialog',
      page: '/demo',
      steps: 'open "I have a room code"',
      expected: 'role=dialog with a label (or an inline form with focus on the field)',
      actual: 'no dialog role; inline form',
    });
  else {
    if (!(await inside()))
      await finding(page, {
        sev: 'medium',
        title: 'Focus does not move into the dialog',
        page: '/demo',
        steps: 'open the dialog by keyboard',
        expected: 'focus inside the dialog',
        actual: 'focus left outside',
      });
    let escaped = 0;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      if (!(await inside())) escaped += 1;
    }
    if (escaped)
      await finding(page, {
        sev: 'medium',
        title: 'Tab leaves an open dialog (no focus trap)',
        page: '/demo',
        steps: 'open dialog, press Tab 12 times',
        expected: 'focus cycles inside',
        actual: `focus outside the dialog ${escaped} of 12 times`,
      });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (await dlg.isVisible().catch(() => false))
      await finding(page, {
        sev: 'medium',
        title: 'Escape does not close the dialog',
        page: '/demo',
        steps: 'open dialog, press Escape',
        expected: 'closed',
        actual: 'still open',
      });
    else {
      const back = await page.evaluate(() => document.activeElement?.innerText || '');
      if (!/room code/i.test(back))
        await finding(page, {
          sev: 'low',
          title: 'Focus is not returned to the trigger after the dialog closes',
          page: '/demo',
          expected: 'focus on "I have a room code"',
          actual: clip(back || 'body', 60),
        });
    }
  }
  // help layer: "?" key
  await gotoOk(page, WEB + '/');
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(500);
  if (
    await page
      .getByRole('dialog')
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (
      await page
        .getByRole('dialog')
        .first()
        .isVisible()
        .catch(() => false)
    )
      await finding(page, {
        sev: 'medium',
        title: 'Escape does not close the help dialog',
        page: '/',
        steps: 'press ?, then Escape',
        expected: 'closed',
        actual: 'still open',
      });
  }
  await w.flush();
});

test('reduced motion: no endless animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const p of ['/', '/try', '/demo', '/demo/scripted']) {
    await gotoOk(page, WEB + p);
    await page.waitForTimeout(2000);
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map(
          (a) =>
            `${a.effect?.target?.tagName || '?'}.${(a.effect?.target?.className || '').toString().split(' ')[0]} ${a.animationName || a.transitionProperty || ''} ${a.effect?.getComputedTiming().iterations === Infinity ? 'infinite' : ''}`,
        )
        .slice(0, 6),
    );
    const infinite = running.filter((r) => /infinite/.test(r));
    if (infinite.length)
      await finding(page, {
        sev: 'medium',
        title: 'Endless animation runs with prefers-reduced-motion',
        page: p,
        steps: 'emulate reduced motion, open the page, wait 2 s',
        expected: 'no looping or auto-playing motion',
        actual: infinite.join(' ; '),
      });
    else if (running.length > 3)
      await finding(page, {
        sev: 'low',
        title: 'Many animations still run with prefers-reduced-motion',
        page: p,
        expected: 'motion removed or minimal',
        actual: running.join(' ; '),
        screenshot: false,
      });
  }
});

test('forced colors and dark scheme: still readable and laid out', async ({ page }) => {
  for (const mode of [{ forcedColors: 'active' }, { colorScheme: 'dark' }]) {
    await page.emulateMedia(mode);
    for (const p of ['/', '/try', '/demo', '/demo/scripted']) {
      await gotoOk(page, WEB + p);
      const a = await auditLayout(page);
      await reportAudit(page, a, { skipEmpty: true, skipLandmarks: true });
      if (mode.forcedColors) {
        // in forced colors a button needs a border or it vanishes
        const flat = await page.evaluate(
          () =>
            [...document.querySelectorAll('button:not([disabled])')].filter((b) => {
              const s = getComputedStyle(b);
              return (
                b.offsetWidth > 0 &&
                parseFloat(s.borderTopWidth) === 0 &&
                parseFloat(s.outlineWidth) === 0
              );
            }).length,
        );
        if (flat)
          await finding(page, {
            sev: 'low',
            title: 'Buttons have no border in forced-colors mode',
            page: p,
            steps: 'emulate forced-colors: active',
            expected: 'a border so buttons stay visible',
            actual: `${flat} button(s) with zero border`,
            screenshot: true,
          });
      }
      test
        .info()
        .annotations.push({ type: 'shot', description: `${JSON.stringify(mode)} ${p} checked` });
    }
  }
});
