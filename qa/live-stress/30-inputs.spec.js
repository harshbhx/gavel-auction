// Hostile input in every field: name, room code, ceiling and bid amounts.
// Expected: nothing executes, nothing crashes, layout holds, bad values are refused in plain words.
import {
  test,
  WEB,
  auditLayout,
  bodyText,
  clip,
  finding,
  gotoOk,
  loadState,
  sleep,
  watch,
} from './lib.js';

const TEXT_PAYLOADS = [
  ['300 letters', 'W'.repeat(300)],
  ['5000 letters', 'Q'.repeat(5000)],
  [
    'unbroken 80 chars no spaces in a narrow box',
    'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii',
  ],
  ['arabic RTL', 'مرحبا بالعالم'],
  ['hebrew with bidi override', '‮evil‬ שלום'],
  ['emoji family and flags', '😀👨‍👩‍👧🇮🇳🏳️‍🌈'],
  ['zalgo', 'Z̴̧̛͓͚a̷̢l̵̡g̶o̴'],
  ['img onerror', '<img src=x onerror="window.__xss=1">'],
  ['script close-quote', '"><script>window.__xss=1</script>'],
  ['svg onload', '<svg onload=window.__xss=1>'],
  ['javascript url', 'javascript:window.__xss=1'],
  ['sql', "Robert'); DROP TABLE bidders;--"],
  ['template braces', '{{constructor.constructor("window.__xss=1")()}} ${7*7}'],
  ['null and control chars', 'a\u0000b\u0007c​d'],
  ['whitespace only', '     '],
  ['leading and trailing spaces', '   Ada   '],
  ['newline', 'line1\nline2'],
];
const AMOUNTS = [
  '-5',
  '0',
  '-0',
  '0.001',
  '1.005',
  '1,5',
  '1e9',
  '1e400',
  '99999999999999999999',
  '٣٠٠',
  'abc',
  '--5',
  '+5',
  ' 12 ',
  '12abc',
  'NaN',
  'Infinity',
];
const BADTEXT = /NaN|Infinity|undefined|\[object|null\b/;

async function xssCheck(page, what) {
  const hit = await page.evaluate(() => window.__xss === 1).catch(() => false);
  if (hit)
    await finding(page, {
      sev: 'high',
      title: 'Injected script executed',
      page: page.url(),
      steps: what,
      expected: 'input is shown as text, never run',
      actual: 'window.__xss was set',
    });
  return hit;
}

async function layoutHolds(page, what) {
  const a = await auditLayout(page);
  if (a.overflowX)
    await finding(page, {
      sev: 'medium',
      title: 'Long input breaks the layout (horizontal scroll)',
      page: page.url(),
      steps: what,
      expected: 'long text wraps or is cut inside its box',
      actual: `${a.scrollW} > ${a.vw}; ${a.offenders.join(' ; ')}`,
    });
}

test('landing code field: hostile text, paste forms, normalization', async ({ page }) => {
  const w = watch(page, { allowConsole: true });
  await gotoOk(page, WEB + '/');
  const field = page.locator('input').first();
  if (!(await field.isVisible().catch(() => false)))
    return finding(page, {
      sev: 'high',
      title: 'No code field on the landing page',
      expected: 'a field to type a room code',
      actual: 'none visible',
    });
  const go = page.getByRole('button', { name: /join with a code/i }).first();
  let submits = 0;
  for (const [name, val] of TEXT_PAYLOADS) {
    await field.fill('');
    await field.fill(val);
    await page.waitForTimeout(150);
    const shown = await field.inputValue();
    if (shown.length > 64)
      await finding(page, {
        sev: 'low',
        title: 'Code field accepts thousands of characters',
        page: '/',
        steps: `paste ${name} into the code field`,
        expected: 'a maxlength near the code length',
        actual: `value length ${shown.length}`,
      });
    await xssCheck(page, `type ${name} in the code field`);
    await layoutHolds(page, `type ${name} in the code field`);
    // submit at most three hostile values to the server
    if (
      submits < 3 &&
      /script|5000|bidi|emoji/.test(name) &&
      (await go.isEnabled().catch(() => false))
    ) {
      submits += 1;
      await go.click();
      await page.waitForTimeout(1800);
      const t = await bodyText(page);
      if (page.url().replace(WEB, '') === '/' && !/no room|not found|letters|code/i.test(t))
        await finding(page, {
          sev: 'medium',
          title: 'Hostile code gives no feedback',
          page: '/',
          steps: `submit ${name}`,
          expected: 'an error message',
          actual: clip(t, 160),
        });
      await xssCheck(page, `submit ${name}`);
      if (!page.url().startsWith(WEB + '/')) await gotoOk(page, WEB + '/');
      else if (page.url().replace(WEB, '') !== '/') await gotoOk(page, WEB + '/');
      await sleep(600);
    }
  }
  await w.flush();
});

test('landing code field: valid code in other spellings', async ({ page }) => {
  const A = loadState().rooms?.A;
  test.skip(!A || !A.code, 'no room code');
  const w = watch(page, { allowConsole: true });
  const c = A.code;
  const spell = [
    ['lowercase', c.toLowerCase()],
    ['GVL- prefix lowercase', `gvl-${c.toLowerCase()}`],
    ['GVL- prefix upper', `GVL-${c}`],
    ['spaces inside', `${c.slice(0, 3)} ${c.slice(3)}`],
    ['leading and trailing spaces', `  ${c}  `],
    ['dash in the middle', `${c.slice(0, 3)}-${c.slice(3)}`],
    ['trailing newline (paste)', `${c}\n`],
  ];
  for (const [name, val] of spell) {
    await gotoOk(page, WEB + '/', { noSettle: true });
    const field = page.locator('input').first();
    await field.waitFor({ timeout: 15000 });
    await field.fill(val);
    const go = page.getByRole('button', { name: /join with a code/i }).first();
    const enabled = await go.isEnabled().catch(() => false);
    if (!enabled) {
      await finding(page, {
        sev: 'medium',
        title: 'A valid code in another spelling is refused',
        page: '/',
        steps: `paste "${val.replace(/\n/g, '\\n')}" (${name}) for room code ${c}`,
        expected: 'normalized and accepted (case, spaces, GVL- prefix)',
        actual: 'join button stays disabled',
      });
      continue;
    }
    await go.click();
    const ok = await page
      .waitForURL(new RegExp(`/join/|/r/${A.roomId}`), { timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    if (!ok)
      await finding(page, {
        sev: 'medium',
        title: 'A valid code in another spelling does not open the room',
        page: '/',
        steps: `paste "${val.replace(/\n/g, '\\n')}" (${name}) and press join`,
        expected: 'the join page for the room',
        actual: clip(await bodyText(page), 200),
      });
    await sleep(700);
  }
  await w.flush();
});

test('demo page "I have a room code" dialog: hostile text and keyboard', async ({ page }) => {
  const w = watch(page, { allowConsole: true });
  await gotoOk(page, WEB + '/demo');
  const open = page.getByRole('button', { name: /i have a room code/i }).first();
  if (!(await open.isVisible().catch(() => false)))
    return finding(page, {
      sev: 'low',
      title: 'No "I have a room code" control on /demo',
      page: '/demo',
      expected: 'the control from the page copy',
      actual: 'not visible',
    });
  await open.click();
  await page.waitForTimeout(400);
  const field = page.locator('input[type=text], input:not([type])').last();
  for (const [name, val] of [
    ['empty', ''],
    ['bad chars', 'AB CD!@#'],
    ['script', '<script>window.__xss=1</script>'],
    ['5000', 'Z'.repeat(5000)],
  ]) {
    await field.fill(val).catch(() => {});
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await xssCheck(page, `code dialog: ${name}`);
    await layoutHolds(page, `code dialog: ${name}`);
    const t = await bodyText(page);
    if (name === 'empty' && !/enter the room code/i.test(t))
      await finding(page, {
        sev: 'low',
        title: 'Empty code gives no message',
        page: '/demo',
        steps: 'open the code box, press Enter with nothing typed',
        expected: '"Enter the room code."',
        actual: clip(t, 160),
      });
    if (name === 'bad chars' && !/letters, numbers and dashes/i.test(t))
      await finding(page, {
        sev: 'low',
        title: 'Bad characters in a code give no message',
        page: '/demo',
        steps: 'type AB CD!@#, press Enter',
        expected: '"A room code has letters, numbers and dashes only."',
        actual: clip(t, 160),
      });
  }
  await w.flush();
});

async function reachRegister(page, A) {
  await gotoOk(page, A.joinUrl);
  const join = page
    .getByRole('link', { name: /join as a bidder|join as bidder/i })
    .or(page.getByRole('button', { name: /join as a bidder|join as bidder/i }))
    .first();
  if (!(await join.isVisible().catch(() => false))) return false;
  await join.click();
  await page.waitForTimeout(2500);
  return Boolean(
    await page
      .getByLabel(/display name/i)
      .first()
      .isVisible()
      .catch(() => false),
  );
}

test('register: display name payloads and ceiling amounts', async ({ page }) => {
  const A = loadState().rooms?.A;
  test.skip(!A, 'no room');
  const w = watch(page, { allowConsole: true });
  const there = await reachRegister(page, A);
  if (!there) {
    await finding(page, {
      sev: 'high',
      title: 'Join as a bidder does not reach the registration form',
      page: A.joinUrl,
      steps: 'open /join/<room>?c=<code>, press Join as a bidder',
      expected: 'registration form with Display name',
      actual: clip(await bodyText(page), 260),
      cause: 'packages/web/src/screens/join/JoinScreen.tsx and App.tsx openJoin',
    });
    return w.flush();
  }
  const name = page.getByLabel(/display name/i).first();
  const cont = page.getByRole('button', { name: /continue/i }).first();
  for (const [label, val] of TEXT_PAYLOADS) {
    await name.fill('').catch(() => {});
    await name.fill(val);
    await page.waitForTimeout(100);
    const shown = await name.inputValue();
    await xssCheck(page, `display name: ${label}`);
    await layoutHolds(page, `display name: ${label}`);
    const enabled = await cont.isEnabled().catch(() => false);
    if (/whitespace only|null and control|newline/.test(label) && enabled && shown.trim() === '')
      await finding(page, {
        sev: 'medium',
        title: 'Blank display name can continue',
        page: '/r/<room>/register',
        steps: `enter ${label}`,
        expected: 'Continue stays disabled',
        actual: 'Continue enabled with a blank name',
      });
    if (shown.length > 80)
      await finding(page, {
        sev: 'low',
        title: 'Display name field takes more than 80 characters',
        page: '/r/<room>/register',
        steps: `paste ${label}`,
        expected: 'a length limit',
        actual: `length ${shown.length}`,
      });
  }
  // rapid continue on a valid name, then look for the ceiling step
  await name.fill('Stress Tester');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /continue/i.test(x.innerText));
    if (b) for (let i = 0; i < 8; i += 1) b.click();
  });
  await page.waitForTimeout(1200);
  const amountField = page
    .locator(
      'input[type=number], input[inputmode=decimal], input[inputmode=numeric], input[name*=ceiling i], input[name*=amount i]',
    )
    .first();
  const hasAmount = await amountField.isVisible().catch(() => false);
  if (!hasAmount) {
    const radios = await page.getByRole('radio').count();
    await finding(page, {
      sev: 'info',
      title: 'Ceiling is a fixed choice, no free amount field',
      page: '/r/<room>/register',
      steps: 'continue past the name step',
      expected: 'n/a',
      actual: `${radios} radio options; free-amount tests skipped`,
    });
  } else {
    for (const v of AMOUNTS) {
      await amountField.fill(v).catch(() => {});
      await page.waitForTimeout(120);
      const t = await bodyText(page);
      if (BADTEXT.test(t))
        await finding(page, {
          sev: 'medium',
          title: 'Odd amount shows NaN, Infinity or undefined',
          page: '/r/<room>/register',
          steps: `type ${v} as the ceiling`,
          expected: 'a plain refusal',
          actual: clip(t.match(BADTEXT)?.[0] + ' in ' + t, 200),
        });
      await layoutHolds(page, `ceiling ${v}`);
    }
  }
  await w.flush();
});

test('scripted bid page: amount field, rapid bids', async ({ page }) => {
  const w = watch(page, { allowConsole: true });
  await gotoOk(page, WEB + '/demo/scripted/bid');
  const field = page
    .locator(
      'input[type=number], input[inputmode=decimal], input[inputmode=numeric], input[type=text]',
    )
    .first();
  if (await field.isVisible().catch(() => false)) {
    for (const v of AMOUNTS) {
      await field.fill(v).catch(() => {});
      await page.waitForTimeout(100);
      const t = await bodyText(page);
      if (BADTEXT.test(t))
        await finding(page, {
          sev: 'medium',
          title: 'Odd bid amount shows NaN, Infinity or undefined',
          page: '/demo/scripted/bid',
          steps: `type ${v}`,
          expected: 'a plain refusal',
          actual: clip(t.match(BADTEXT)?.[0] + ' in ' + t, 200),
        });
    }
  }
  const bids = page.getByRole('button', { name: /bid|raise|\+/i });
  const n = await bids.count();
  if (n > 0) {
    const before = await bodyText(page);
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button'))
        if (/bid|raise/i.test(b.innerText) && !b.disabled)
          for (let i = 0; i < 10; i += 1) b.click();
    });
    await page.waitForTimeout(800);
    const after = await bodyText(page);
    if (BADTEXT.test(after) && !BADTEXT.test(before))
      await finding(page, {
        sev: 'medium',
        title: 'Rapid bids produce NaN or undefined',
        page: '/demo/scripted/bid',
        steps: 'click every bid button 10 times in one tick',
        expected: 'one bid per accepted click, sane numbers',
        actual: clip(after, 200),
      });
  }
  await w.flush();
});
