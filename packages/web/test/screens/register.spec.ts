import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { alertOf, expect, mockApi, ready, serveRoom, test, type ApiReply } from './support/harness';
import { REGISTER_ROOM_ID, bidderId, registrationRoom } from './support/frames';

/**
 * Registration (name, ceiling, PayPal approval), the return route after PayPal's own approval
 * page, and every error the payments side can answer with. The fake approval adapter and a mock
 * server stand in for PayPal.
 */

const ROOM = REGISTER_ROOM_ID;
const ME = bidderId(12);
const HOLD_ID = 'hold-0001-ABCDEF';
const ORDER_ID = 'order-0001';

interface Answers {
  join?: ApiReply;
  holds?: ApiReply;
  approve?: ApiReply;
}

async function stub(page: Page, answers: Answers = {}): Promise<void> {
  await mockApi(page, (req) => {
    if (req.path === `/api/auctions/${ROOM}/join`) {
      return (
        answers.join ?? { status: 200, json: { sessionToken: 'bidder-token-0001', bidderId: ME } }
      );
    }
    if (req.path === '/api/holds') {
      return answers.holds ?? { status: 200, json: { holdId: HOLD_ID, orderId: ORDER_ID } };
    }
    if (req.path === `/api/holds/${HOLD_ID}/approve`) {
      return (
        answers.approve ?? {
          status: 200,
          json: { holdId: HOLD_ID, status: 'HELD', ceilingCents: 50_000 },
        }
      );
    }
    return { status: 404 };
  });
}

async function openRegister(
  page: Page,
  answers: Answers = {},
  opts: { closed?: boolean; invite?: boolean; frozenClock?: boolean } = {},
): Promise<void> {
  await stub(page, answers);
  await serveRoom(page, {
    scenario: registrationRoom(opts.closed === true),
    at: 0,
    role: 'bidder',
  });
  if (opts.frozenClock === true) {
    // A controlled clock holds timers still, so a timed step stays on screen.
    await page.clock.install({ time: new Date('2026-01-15T12:00:00.000Z') });
  }
  await page.goto(`/r/${ROOM}/register${opts.invite === false ? '' : '#invite-token-0001'}`);
}

async function toCeiling(page: Page): Promise<void> {
  await page.getByLabel(t('reg.name')).fill('Priya');
  await page.getByRole('button', { name: t('reg.continue') }).click();
  await expect(page.getByRole('heading', { name: t('reg.step2') })).toBeVisible();
}

async function toApproval(page: Page): Promise<void> {
  await toCeiling(page);
  await page.getByRole('radio', { name: /\$500/ }).check();
  await page.getByRole('button', { name: t('ui.hold.alt') }).click();
  await page.getByRole('button', { name: t('ui.hold.altArmed') }).click();
}

test.describe('register: entry', () => {
  test('invite missing', async ({ page, shoot }) => {
    await openRegister(page, {}, { invite: false });
    await expect(page.getByRole('heading', { name: t('reg.noInviteTitle') })).toBeVisible();
    await shoot('register', 'invite-missing');
  });

  test('joining', async ({ page, shoot }) => {
    await openRegister(page, { join: 'hang' });
    await expect(page.getByText(t('reg.confirming')).first()).toBeVisible();
    await shoot('register', 'joining');
  });

  test('invite refused', async ({ page, shoot }) => {
    await openRegister(page, { join: { status: 409, json: { error: 'invite_used' } } });
    await expect(page.getByText(t('reg.inviteFailed')).first()).toBeVisible();
    await shoot('register', 'invite-refused');
  });

  test('registration closed', async ({ page, shoot }) => {
    await openRegister(page, {}, { closed: true });
    await expect(page.getByText(t('reg.closed')).first()).toBeVisible();
    await shoot('register', 'closed');
  });
});

test.describe('register: name and ceiling', () => {
  test('step 1 empty', async ({ page, shoot }) => {
    await openRegister(page);
    await expect(page.getByRole('heading', { name: t('reg.step1') })).toBeVisible();
    await shoot('register', 'step1-empty');
  });

  test('step 1 name typed', async ({ page, shoot }) => {
    await openRegister(page);
    await page.getByLabel(t('reg.name')).fill('Priya');
    await shoot('register', 'step1-name-typed');
  });

  test('step 1 name refused', async ({ page, shoot }) => {
    await openRegister(page);
    await page.getByLabel(t('reg.name')).fill('Priya <b>');
    await page.getByLabel(t('reg.name')).blur();
    await expect(page.getByText(t('reg.nameInvalid')).first()).toBeVisible();
    await shoot('register', 'step1-name-refused');
  });

  test('step 2 no choice yet', async ({ page, shoot }) => {
    await openRegister(page);
    await toCeiling(page);
    await shoot('register', 'step2-no-choice');
  });

  test('step 2 ceiling chosen', async ({ page, shoot }) => {
    await openRegister(page);
    await toCeiling(page);
    await page.getByRole('radio', { name: /\$500/ }).check();
    await expect(page.getByText(t('reg.heldNotCharged')).first()).toBeVisible();
    await shoot('register', 'step2-ceiling-chosen');
  });
});

test.describe('register: approval with the fake adapter', () => {
  test('preparing the order', async ({ page, shoot }) => {
    await openRegister(page, { holds: 'hang' });
    await toApproval(page);
    await expect(page.getByText(t('reg.confirming')).first()).toBeVisible();
    await shoot('register', 'approve-preparing');
  });

  test('waiting for the buyer in the PayPal window', async ({ page, shoot }) => {
    // The buyer step lasts 400 ms; a controlled clock holds the page inside it.
    await openRegister(page, {}, { frozenClock: true });
    await toApproval(page);
    await expect(page.getByText(t('reg.awaiting')).first()).toBeVisible();
    await shoot('register', 'approve-awaiting-buyer');
  });

  test('confirming the hold', async ({ page, shoot }) => {
    await openRegister(page, { approve: 'hang' });
    await toApproval(page);
    await expect(page.getByText(t('reg.confirming')).first()).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(800);
    await shoot('register', 'approve-confirming');
  });

  test('hold in place', async ({ page, shoot }) => {
    await openRegister(page);
    await toApproval(page);
    await expect(page.getByRole('button', { name: t('reg.continue') })).toBeVisible({
      timeout: 10_000,
    });
    await shoot('register', 'approve-held');
  });

  test('order could not be created', async ({ page, shoot }) => {
    await openRegister(page, { holds: { status: 500 } });
    await toApproval(page);
    await expect(alertOf(page)).toBeVisible({ timeout: 10_000 });
    await shoot('register', 'approve-error-order');
  });

  test('hold could not be confirmed', async ({ page, shoot }) => {
    await openRegister(page, { approve: { status: 500 } });
    await toApproval(page);
    await expect(alertOf(page)).toBeVisible({ timeout: 10_000 });
    await shoot('register', 'approve-error-hold');
  });
});

/* -------------------------------------------- return from PayPal's own approval page */

interface ReturnSetup {
  session?: boolean;
  registration?: boolean;
  name?: string;
  query?: string;
}

async function openReturn(page: Page, approve: ApiReply, setup: ReturnSetup = {}): Promise<void> {
  await stub(page, { approve });
  await serveRoom(page, { scenario: registrationRoom(false), at: 0, role: 'bidder' });
  await page.addInitScript(
    ({ room, who, session, registration, name }) => {
      if (session) {
        sessionStorage.setItem(
          `gavel:session:${room}:bidder`,
          JSON.stringify({ token: 'bidder-token-0001', bidderId: who }),
        );
      }
      if (registration) {
        sessionStorage.setItem(
          `gavel:registration:${encodeURIComponent(room)}:${encodeURIComponent(who)}`,
          JSON.stringify({
            clientRegistrationId: 'registration-0001',
            orderId: 'order-0001',
            holdId: 'hold-0001-ABCDEF',
            ceilingCents: 50_000,
            ...(name === '' ? {} : { name }),
          }),
        );
      }
    },
    {
      room: ROOM,
      who: ME,
      session: setup.session !== false,
      registration: setup.registration !== false,
      name: setup.name ?? '',
    },
  );
  await page.goto(`/r/${ROOM}/return${setup.query ?? '?token=order-0001'}`);
}

const HOLD_ERRORS: ReadonlyArray<[string, number, string]> = [
  ['ceiling-out-of-range', 400, 'ceiling_out_of_range'],
  ['hold-exists', 409, 'hold_exists'],
  ['order-not-found', 404, 'order_not_found'],
  ['order-not-approved', 409, 'order_not_approved'],
  ['paypal-unavailable', 503, 'paypal_unavailable'],
  ['kill-switch-engaged', 503, 'kill_switch_engaged'],
  ['not-sandbox', 503, 'payments_not_sandbox'],
];

test.describe('return from PayPal', () => {
  test('confirming', async ({ page, shoot }) => {
    await openReturn(page, 'hang');
    await expect(page.getByText(t('reg.confirming')).first()).toBeVisible();
    await shoot('return', 'confirming');
  });

  test('hold in place', async ({ page, shoot }) => {
    await openReturn(page, {
      status: 200,
      json: { holdId: HOLD_ID, status: 'HELD', ceilingCents: 50_000 },
    });
    await expect(page.getByRole('button', { name: t('reg.continue') })).toBeVisible();
    await shoot('return', 'held');
  });

  for (const [state, status, code] of HOLD_ERRORS) {
    test(`error ${state}`, async ({ page, shoot }) => {
      await openReturn(page, { status, json: { error: code } });
      await expect(alertOf(page)).toBeVisible();
      await shoot('return', `error-${state}`);
    });
  }

  test('error generic server failure', async ({ page, shoot }) => {
    await openReturn(page, { status: 500 });
    await expect(alertOf(page)).toBeVisible();
    await shoot('return', 'error-server-failure');
  });

  test('error amount differs from the request', async ({ page, shoot }) => {
    await openReturn(page, {
      status: 200,
      json: { holdId: HOLD_ID, status: 'HELD', ceilingCents: 10_000 },
    });
    await expect(alertOf(page)).toBeVisible();
    await shoot('return', 'error-amount-mismatch');
  });

  test('error name refused', async ({ page, shoot }) => {
    await openReturn(page, { status: 400 }, { name: 'Priya' });
    await expect(alertOf(page)).toBeVisible();
    await shoot('return', 'error-name-refused');
  });

  test('error order token does not match', async ({ page, shoot }) => {
    await openReturn(page, { status: 200 }, { query: '?token=some-other-order' });
    await expect(alertOf(page)).toBeVisible();
    await shoot('return', 'error-order-mismatch');
  });

  test('error no order token in the address', async ({ page, shoot }) => {
    await openReturn(page, { status: 200 }, { query: '' });
    await expect(alertOf(page)).toBeVisible();
    await shoot('return', 'error-no-order-token');
  });

  test('no session', async ({ page, shoot }) => {
    await openReturn(page, { status: 200 }, { session: false, registration: false });
    await ready(page);
    await expect(alertOf(page)).toBeVisible();
    await shoot('return', 'no-session');
  });
});
