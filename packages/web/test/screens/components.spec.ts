import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { expect, mockApi, test } from './support/harness';

/**
 * States no route reaches: the real components are drawn on a component page
 * (support/pages/harness.tsx) with the props the routes never pass, and the real fake approval
 * adapter. Same naming and the same four variants as the other specs. No file under src changed.
 */

const PAGE = '/test/screens/support/pages/harness.html';

async function open(page: Page, view: string): Promise<void> {
  await page.goto(`${PAGE}?view=${view}`);
  await page.locator('#root > *').first().waitFor({ state: 'attached' });
}

test.describe('landing variants', () => {
  test('busy: a room is being created', async ({ page, shoot }) => {
    await open(page, 'landing-busy');
    await expect(page.getByText(t('demo.creating')).first()).toBeVisible();
    await shoot('landing', 'busy');
  });

  test('server down', async ({ page, shoot }) => {
    await open(page, 'landing-down');
    await expect(page.getByText(t('demo.failed')).first()).toBeVisible();
    await shoot('landing', 'server-down');
  });
});

test.describe('demo launcher', () => {
  test('links list', async ({ page, shoot }) => {
    await open(page, 'demo-links');
    await expect(page.getByRole('heading', { name: t('demo.linksTitle') })).toBeVisible();
    await shoot('demo', 'links');
  });
});

test.describe('console: shortcut help', () => {
  test('dialog open', async ({ page, shoot }) => {
    await open(page, 'shortcuts');
    await expect(page.getByRole('heading', { name: t('console.shortcuts') }).first()).toBeVisible();
    await shoot('console', 'shortcut-help');
  });
});

test.describe('console: voice feed microphone states', () => {
  const cases: ReadonlyArray<
    [
      string,
      string,
      'console.mic.requesting' | 'console.mic.live' | 'console.mic.denied' | 'console.mic.error',
    ]
  > = [
    ['voice-requesting', 'voice-requesting', 'console.mic.requesting'],
    ['voice-listening', 'voice-listening', 'console.mic.live'],
    ['voice-denied', 'voice-denied', 'console.mic.denied'],
    ['voice-error', 'voice-error', 'console.mic.error'],
  ];
  for (const [view, state, key] of cases) {
    test(state, async ({ page, shoot }) => {
      await open(page, view);
      await expect(page.getByText(t(key)).first()).toBeVisible();
      await shoot('console', state);
    });
  }
});

test.describe('register: approval ends without a hold', () => {
  async function stubHolds(page: Page): Promise<void> {
    await mockApi(page, (req) =>
      req.path === '/api/holds'
        ? { status: 200, json: { holdId: 'hold-0001-ABCDEF', orderId: 'order-0001' } }
        : { status: 404 },
    );
  }

  test('cancelled in the PayPal window', async ({ page, shoot }) => {
    await stubHolds(page);
    await open(page, 'approve-cancelled');
    await expect(page.getByText(t('reg.cancelled')).first()).toBeVisible({ timeout: 10_000 });
    await shoot('register', 'approve-cancelled');
  });

  test('declined by PayPal', async ({ page, shoot }) => {
    await stubHolds(page);
    await open(page, 'approve-declined');
    await expect(page.getByText(t('reg.declined')).first()).toBeVisible({ timeout: 10_000 });
    await shoot('register', 'approve-declined');
  });
});

test.describe('error boundary', () => {
  test('render failure', async ({ page, shoot }) => {
    await open(page, 'error-boundary');
    await expect(page.getByRole('heading', { name: t('err.boundary') })).toBeVisible();
    await shoot('error', 'boundary');
  });
});

test.describe('boot configuration error', () => {
  test('bad build configuration', async ({ page, shoot }) => {
    // A second dev server (port 4175) starts with an invalid environment, so the real boot path
    // in src/main.tsx runs and shows its own message.
    await page.goto('http://127.0.0.1:4175/');
    await expect(page.getByRole('alert')).toContainText('Configuration problem');
    await shoot('boot', 'config-error');
  });
});
