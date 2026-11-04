// G0: sandbox credentials work, an AUTHORIZE order can be created.
const base = 'https://api-m.sandbox.paypal.com';
const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;
if (!id || !secret) {
  console.log('G0 FAIL: credentials missing');
  process.exit(1);
}
const tok = await fetch(`${base}/v1/oauth2/token`, {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
});
console.log('token status', tok.status);
if (!tok.ok) {
  console.log('G0 FAIL: token request rejected');
  process.exit(1);
}
const { access_token, scope } = await tok.json();
console.log('scopes include payments:', /payments|orders|Braintree|checkout/i.test(scope ?? ''));
const ord = await fetch(`${base}/v2/checkout/orders`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${access_token}`,
    'Content-Type': 'application/json',
    'PayPal-Request-Id': `g0-${Date.now()}`,
  },
  body: JSON.stringify({
    intent: 'AUTHORIZE',
    purchase_units: [{ amount: { currency_code: 'USD', value: '5.00' } }],
  }),
});
const body = await ord.json();
const scopeOk = /payments|orders|Braintree|checkout/i.test(scope ?? '');
const statusOk = body.status === 'PAYER_ACTION_REQUIRED' || body.status === 'CREATED';
// The create response may be minimal, so the intent is read back with a GET.
const back =
  ord.status === 201 && body.id
    ? await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(body.id)}`, {
        headers: { Authorization: `Bearer ${access_token}` },
      })
    : null;
const readBack = back?.ok ? await back.json() : {};
const intentOk = readBack.intent === 'AUTHORIZE';
const approveOk = (body.links ?? []).some((l) => l.rel === 'payer-action' || l.rel === 'approve');
console.log('create order status', ord.status, 'order status', body.status);
console.log(
  'scopes ok',
  scopeOk,
  'status ok',
  statusOk,
  'intent ok',
  intentOk,
  'approve link',
  approveOk,
);
const failed = [
  ['orders scope missing', scopeOk],
  ['order status not CREATED or PAYER_ACTION_REQUIRED', statusOk],
  ['AUTHORIZE intent not echoed', intentOk],
  ['approve link missing', approveOk],
]
  .filter(([, ok]) => !ok)
  .map(([why]) => why);
if (ord.status !== 201 || failed.length > 0) {
  console.log('G0 FAIL: ' + (failed.join('; ') || JSON.stringify(body).slice(0, 300)));
  process.exit(1);
}
console.log('G0 PASS');
process.exit(0);
