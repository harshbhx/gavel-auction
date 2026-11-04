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
const { access_token, scope, app_id } = await tok.json();
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
console.log('create order status', ord.status, 'order status', body.status, 'intent ok', ord.status === 201);
console.log(
  'approve link present',
  (body.links ?? []).some((l) => l.rel === 'payer-action' || l.rel === 'approve'),
);
console.log(ord.status === 201 ? 'G0 PASS' : 'G0 FAIL: ' + JSON.stringify(body).slice(0, 300));
process.exit(ord.status === 201 ? 0 : 1);
