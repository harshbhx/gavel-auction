// Room B only, last: console rapid clicks (pause, resume, extend), the hammer dialog by keyboard,
// then the screen and the receipt after the hammer. One room, light control traffic.
import {
  test,
  WEB,
  API,
  auditLayout,
  bodyText,
  clip,
  finding,
  gotoOk,
  loadState,
  reportAudit,
  sleep,
  watch,
} from './lib.js';

const B = () => loadState().rooms?.B;

test('console: rapid pause, extend and hammer; keyboard; receipt and screen after', async ({
  page,
  context,
}) => {
  const room = B();
  test.skip(!room || !room.consoleUrl, 'no console link');
  const w = watch(page, { allowConsole: true });
  const controls = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/control$/.test(r.url()))
      controls.push(r.postData()?.slice(0, 80));
  });
  await gotoOk(page, room.consoleUrl);
  await page.waitForTimeout(3000);
  const t0 = await bodyText(page);
  if (t0.trim().length < 15 || /no token|cannot be opened/i.test(t0)) {
    return finding(page, {
      sev: 'high',
      title: 'Console link from the hub does not open the console',
      page: 'console',
      steps: 'open the Open console link from the hub',
      expected: 'live console',
      actual: clip(t0, 200),
    });
  }
  // a second tab on the screen link, watching while the console is hammered
  const screen = await context.newPage();
  const ws = watch(screen, { allowConsole: true });
  await gotoOk(screen, room.screenUrl || `${WEB}/r/${room.roomId}/screen`);

  const click = async (re, n, label) => {
    const b = page.getByRole('button', { name: re }).first();
    if (!(await b.isVisible().catch(() => false))) {
      await finding(page, {
        sev: 'medium',
        title: `Console has no "${label}" control`,
        page: 'console',
        expected: 'control present',
        actual: clip(await bodyText(page), 160),
      });
      return 0;
    }
    const before = controls.length;
    await b.evaluate((el, k) => {
      for (let i = 0; i < k; i += 1) el.click();
    }, n);
    await page.waitForTimeout(2500);
    return controls.length - before;
  };
  const ext = await click(/extend/i, 6, 'Extend');
  if (ext > 2)
    await finding(page, {
      sev: 'medium',
      title: 'Extend sends one control request per fast click',
      page: 'console',
      steps: 'click Extend six times in one tick',
      expected: 'at most one in flight, or a clear limit message',
      actual: `${ext} control POSTs; text: ${clip(await bodyText(page), 100)}`,
      cause: 'packages/web/src/screens/console/LiveConsole.tsx control handler',
    });
  const pz = await click(/^pause/i, 6, 'Pause');
  if (pz > 2)
    await finding(page, {
      sev: 'medium',
      title: 'Pause toggled by every fast click',
      page: 'console',
      steps: 'click Pause six times in one tick',
      expected: 'one request while pending',
      actual: `${pz} control POSTs`,
    });
  const rs = page.getByRole('button', { name: /resume/i }).first();
  if (await rs.isVisible().catch(() => false)) await rs.click().catch(() => {});
  await page.waitForTimeout(1500);

  // hammer by keyboard
  const ham = page.getByRole('button', { name: /hammer/i }).first();
  if (!(await ham.isVisible().catch(() => false)))
    await finding(page, {
      sev: 'high',
      title: 'Console has no Hammer control',
      page: 'console',
      expected: 'Hammer',
      actual: clip(await bodyText(page), 160),
    });
  else {
    await ham.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const dlg = page.getByRole('dialog').or(page.getByRole('alertdialog')).first();
    const open = await dlg.isVisible().catch(() => false);
    if (open) {
      const inside = () =>
        page.evaluate(() => {
          const d = document.querySelector('[role=dialog],[role=alertdialog],dialog[open]');
          return d ? d.contains(document.activeElement) : null;
        });
      let esc = 0;
      for (let i = 0; i < 10; i += 1) {
        await page.keyboard.press('Tab');
        if (!(await inside())) esc += 1;
      }
      if (esc)
        await finding(page, {
          sev: 'medium',
          title: 'Hammer dialog does not trap focus',
          page: 'console',
          steps: 'press Enter on Hammer, Tab 10 times',
          expected: 'focus stays in the dialog',
          actual: `${esc} of 10 tabs left it`,
        });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      if (await dlg.isVisible().catch(() => false))
        await finding(page, {
          sev: 'medium',
          title: 'Escape does not close the hammer dialog',
          page: 'console',
          expected: 'closes without hammering',
          actual: 'still open',
        });
      if (controls.some((c) => /hammer/.test(c || '')))
        await finding(page, {
          sev: 'high',
          title: 'Hammer fired when the dialog was dismissed',
          page: 'console',
          expected: 'no hammer on Escape',
          actual: 'hammer control request seen',
        });
      await ham.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      const confirm = page
        .getByRole('dialog')
        .getByRole('button', { name: /hammer|confirm|close|yes/i })
        .last();
      const before = controls.filter((c) => /hammer/.test(c || '')).length;
      if (await confirm.isVisible().catch(() => false))
        await confirm.evaluate((b) => {
          for (let i = 0; i < 5; i += 1) b.click();
        });
      await page.waitForTimeout(4000);
      const n = controls.filter((c) => /hammer/.test(c || '')).length - before;
      if (n > 1)
        await finding(page, {
          sev: 'medium',
          title: 'Confirming the hammer five times sends several hammer requests',
          page: 'console',
          expected: 'one hammer (idempotent controlId is not enough if the UI sends many)',
          actual: `${n} hammer control POSTs`,
        });
      if (n === 0)
        await finding(page, {
          sev: 'medium',
          title: 'Hammer dialog confirm did nothing',
          page: 'console',
          steps: 'open the dialog, confirm',
          expected: 'lot closes',
          actual: clip(await bodyText(page), 160),
        });
    } else {
      await finding(page, {
        sev: 'info',
        title: 'Hammer is hold-only (no dialog on Enter)',
        page: 'console',
        expected: 'n/a',
        actual: clip(await bodyText(page), 120),
      });
      // hold 3.2 s by pointer
      const box = await ham.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(3400);
        await page.mouse.up();
        await page.waitForTimeout(3000);
      }
    }
  }
  await reportAudit(page, await auditLayout(page), { key: true });
  // the screen and the receipt after the hammer
  await screen.waitForTimeout(2000);
  const st = await bodyText(screen);
  if (st.trim().length < 15)
    await finding(screen, {
      sev: 'high',
      title: 'Projection screen is blank after the hammer',
      page: 'screen',
      expected: 'result view',
      actual: 'blank',
    });
  await reportAudit(screen, await auditLayout(screen), { key: true });
  await gotoOk(page, `${WEB}/r/${room.roomId}/receipt`);
  await page.waitForTimeout(2000);
  const rt = await bodyText(page);
  if (/undefined|NaN|\[object/.test(rt))
    await finding(page, {
      sev: 'medium',
      title: 'Receipt shows undefined or NaN',
      page: 'receipt',
      expected: 'clean values',
      actual: clip(rt, 200),
    });
  await reportAudit(page, await auditLayout(page), { key: true });
  await w.flush();
  await ws.flush();
});
