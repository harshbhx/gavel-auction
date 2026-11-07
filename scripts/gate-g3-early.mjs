// Early G3 evidence from sandbox authorizations that predate the timed probe.
// Usage: node scripts/gate-g3-early.mjs <read|probe> <outfile.json>
//   read  : GET each authorization only (no state change).
//   probe : for every authorization past its checkpoint age, try a 1.00 partial capture and a
//           reauthorization, then read it again. Needs the sandbox client credentials in env.
// Output holds labels, ages and HTTP outcomes only: no ids, tokens or secrets.
import { writeFileSync } from 'node:fs';

const BASE = 'https://api-m.sandbox.paypal.com';
const DAY = 86_400_000;

// Ids come from the committed gate evidence (docs/evidence/G2). Both were authorized for 500.00 USD
// and never captured or voided. The G1 authorizations were captured (350.00, final) so they are
// not usable. Checkpoints: A at 3.0 days, B at 3.5 days.
const AUTHS = [
  {
    label: 'G2-wallet',
    id: '8BA74320N3059102T',
    createdMs: Date.parse('2026-11-05T11:53:35Z'),
    checkpointDays: 3.0,
  },
  {
    label: 'G2-card',
    id: '07P43249E7871404E',
    createdMs: Date.parse('2026-11-05T11:58:33Z'),
    checkpointDays: 3.5,
  },
];

const mode = process.argv[2];
const out = process.argv[3];
if (!['read', 'probe'].includes(mode) || !out) {
  console.error('usage: gate-g3-early.mjs <read|probe> <outfile.json>');
  process.exit(2);
}
if ((process.env.PAYPAL_ENV ?? 'sandbox') !== 'sandbox') {
  console.error('sandbox only');
  process.exit(2);
}
const clientId = process.env.PAYPAL_CLIENT_ID ?? '';
const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? '';
if (!clientId || !clientSecret) {
  console.error('missing sandbox credentials');
  process.exit(2);
}

const errName = (j) => (j && typeof j === 'object' && typeof j.name === 'string' ? j.name : '');
const errIssues = (j) =>
  j && Array.isArray(j.details) ? j.details.map((d) => String(d.issue ?? '')).filter(Boolean) : [];

async function call(method, path, token, body, requestId) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { http: res.status, json };
}

const tokRes = await fetch(`${BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
});
const tokJson = await tokRes.json().catch(() => ({}));
if (!tokRes.ok || typeof tokJson.access_token !== 'string') {
  console.error(`token request failed: ${tokRes.status}`);
  process.exit(1);
}
const token = tokJson.access_token;

const runTag = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(2, 14);
const nowMs = Date.now();
const results = [];
for (const a of AUTHS) {
  const ageDays = (nowMs - a.createdMs) / DAY;
  const r = {
    label: a.label,
    checkpointDays: a.checkpointDays,
    ageDays: Number(ageDays.toFixed(4)),
    atIso: new Date(nowMs).toISOString(),
    dueAtIso: new Date(a.createdMs + a.checkpointDays * DAY).toISOString(),
  };
  const before = await call('GET', `/v2/payments/authorizations/${a.id}`, token);
  r.readBeforeHttp = before.http;
  r.statusBefore = String(before.json?.status ?? '');
  r.statusNameBefore = errName(before.json);
  const due = ageDays >= a.checkpointDays;
  r.probed = false;
  if (mode === 'probe' && due && r.statusBefore === 'CREATED') {
    r.probed = true;
    const cap = await call(
      'POST',
      `/v2/payments/authorizations/${a.id}/capture`,
      token,
      { amount: { currency_code: 'USD', value: '1.00' }, final_capture: false },
      `g3e-${runTag}-${a.label}-cap`,
    );
    r.captureHttp = cap.http;
    r.captureName = errName(cap.json);
    r.captureIssues = errIssues(cap.json);
    const re = await call(
      'POST',
      `/v2/payments/authorizations/${a.id}/reauthorize`,
      token,
      { amount: { currency_code: 'USD', value: '500.00' } },
      `g3e-${runTag}-${a.label}-reauth`,
    );
    r.reauthorizeHttp = re.http;
    r.reauthorizeName = errName(re.json);
    r.reauthorizeIssues = errIssues(re.json);
    const after = await call('GET', `/v2/payments/authorizations/${a.id}`, token);
    r.readAfterHttp = after.http;
    r.statusAfter = String(after.json?.status ?? '');
  }
  results.push(r);
}
writeFileSync(out, `${JSON.stringify({ mode, runTag, results }, null, 2)}\n`);
for (const r of results) {
  console.log(
    `${r.label}: age ${r.ageDays}d status ${r.statusBefore || r.readBeforeHttp} due ${r.dueAtIso} probed ${r.probed}` +
      (r.probed ? ` capture ${r.captureHttp} reauthorize ${r.reauthorizeHttp}` : ''),
  );
}
