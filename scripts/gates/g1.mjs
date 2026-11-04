// G1: authorize 500, capture 350 with final_capture=true, observe the remainder, then void.
// Evidence goes to gate-evidence/g1.json (no credentials or tokens are written).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = 'https://api-m.sandbox.paypal.com';
const {
  PAYPAL_CLIENT_ID: id,
  PAYPAL_CLIENT_SECRET: secret,
  SANDBOX_BUYER_EMAIL: email,
  SANDBOX_BUYER_PASSWORD: pw,
} = process.env;
if (!id || !secret || !email || !pw) {
  console.log('G1 FAIL: missing secrets');
  process.exit(1);
}
mkdirSync('gate-evidence', { recursive: true });
const ev = { steps: [] };
const save = () => writeFileSync('gate-evidence/g1.json', JSON.stringify(ev, null, 2));
const log = (step, data) => {
  ev.steps.push({ step, ...data });
  console.log(step, JSON.stringify(data));
  save();
};

let token;
const api = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  return { status: r.status, body: j };
};

{
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  token = (await r.json()).access_token;
  log('token', { status: r.status });
}

const created = await api(
  'POST',
  '/v2/checkout/orders',
  {
    intent: 'AUTHORIZE',
    purchase_units: [{ amount: { currency_code: 'USD', value: '500.00' } }],
    payment_source: {
      paypal: {
        experience_context: {
          return_url: 'https://example.com/return',
          cancel_url: 'https://example.com/cancel',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
        },
      },
    },
  },
  { 'PayPal-Request-Id': `g1-order-${Date.now()}` },
);
const orderId = created.body?.id;
const approve = (created.body?.links ?? []).find(
  (l) => l.rel === 'payer-action' || l.rel === 'approve',
)?.href;
log('create_order', {
  status: created.status,
  orderStatus: created.body?.status,
  hasApprove: !!approve,
  detail: created.status === 201 ? undefined : JSON.stringify(created.body).slice(0, 300),
});
if (!approve) process.exit(1);

// buyer approval in a browser
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
let shot = 0;
const snap = async (n) =>
  page
    .screenshot({ path: `gate-evidence/g1-${String(++shot).padStart(2, '0')}-${n}.png` })
    .catch(() => {});
try {
  await page.goto(approve, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await snap('landing');
  await page.waitForSelector('#email, input[name=login_email]', { timeout: 45000 });
  await page.fill('#email, input[name=login_email]', email);
  await snap('email');
  const next = page.locator('#btnNext, button:has-text("Next")').first();
  if (await next.isVisible().catch(() => false)) await next.click();
  await page.waitForSelector('#password, input[name=login_password]', { timeout: 30000 });
  await page.fill('#password, input[name=login_password]', pw);
  await page.locator('#btnLogin, button:has-text("Log In")').first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(6000);
  await snap('after-login');
  const pay = page
    .locator(
      '#payment-submit-btn, button[data-testid="submit-button-initial"], button:has-text("Complete Purchase"), button:has-text("Pay Now"), button:has-text("Continue"), button:has-text("Agree")',
    )
    .first();
  await pay.waitFor({ timeout: 30000 });
  await snap('review');
  await Promise.all([
    page.waitForURL(/example\.com/, { timeout: 60000 }).catch(() => {}),
    pay.click(),
  ]);
  await snap('done');
  log('buyer_approval', { finalHost: new URL(page.url()).host });
} catch (e) {
  await snap('error');
  log('buyer_approval', { error: String(e).slice(0, 300), url: page.url().split('?')[0] });
}
await browser.close();

const o1 = await api('GET', `/v2/checkout/orders/${orderId}`);
log('order_after_approval', { status: o1.status, orderStatus: o1.body?.status });
if (o1.body?.status !== 'APPROVED') {
  log('result', { verdict: 'G1 BLOCKED: buyer approval not completed (see screenshots)' });
  process.exit(2);
}
const auth = await api('POST', `/v2/checkout/orders/${orderId}/authorize`, undefined, {
  'PayPal-Request-Id': `g1-auth-${orderId}`,
});
const a0 = auth.body?.purchase_units?.[0]?.payments?.authorizations?.[0];
const authId = a0?.id;
log('authorize', { status: auth.status, authStatus: a0?.status, hasId: !!authId });
const a1 = await api('GET', `/v2/payments/authorizations/${authId}`);
log('auth_before_capture', {
  status: a1.status,
  authStatus: a1.body?.status,
  amount: a1.body?.amount,
  expiration: a1.body?.expiration_time,
});
const cap = await api(
  'POST',
  `/v2/payments/authorizations/${authId}/capture`,
  { amount: { currency_code: 'USD', value: '350.00' }, final_capture: true },
  { 'PayPal-Request-Id': `g1-cap-${orderId}` },
);
log('capture_350_final', {
  status: cap.status,
  capStatus: cap.body?.status,
  final: cap.body?.final_capture,
});
await new Promise((r) => setTimeout(r, 4000));
const a2 = await api('GET', `/v2/payments/authorizations/${authId}`);
log('auth_after_capture', { status: a2.status, authStatus: a2.body?.status, amount: a2.body?.amount });
const o2 = await api('GET', `/v2/checkout/orders/${orderId}`);
log('order_after_capture', { status: o2.status, orderStatus: o2.body?.status });
const v = await api('POST', `/v2/payments/authorizations/${authId}/void`, undefined, {
  'PayPal-Request-Id': `g1-void-${orderId}`,
});
log('void_after_capture', { status: v.status, name: v.body?.name, message: v.body?.message });
const a3 = await api('GET', `/v2/payments/authorizations/${authId}`);
log('auth_after_void_attempt', { status: a3.status, authStatus: a3.body?.status });
log('result', { verdict: 'G1 DONE: see steps for remainder behaviour' });
