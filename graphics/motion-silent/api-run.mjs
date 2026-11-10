// Runs the judge API calls of docs/judges/call-the-api against a local server with a judge key and
// writes the trimmed answers the video shows (tokens and ids are cut to a short prefix, never the
// key). CI only. Usage: API_URL=... JUDGE_KEY=... node api-run.mjs <outFile>
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const API = (process.env.API_URL ?? 'http://127.0.0.1:8788').replace(/\/$/, '');
const KEY = process.env.JUDGE_KEY ?? '';
const out = path.resolve(process.argv[2] ?? 'out/api.json');
mkdirSync(path.dirname(out), { recursive: true });

async function call(method, url, { headers = {}, body } = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}
const cut = (s, n = 10) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '...' : s);

const room = await call('POST', '/api/judge/rooms', {
  headers: { 'x-judge-key': KEY },
  body: { title: 'My lot' },
});
if (room.status >= 300 || !room.json) throw new Error('create room answered ' + room.status);
const r = room.json;
const id = r.auctionId ?? r.id;
const join = await call('POST', '/api/judge/join', {
  body: { code: r.joinCode, displayName: 'Asha' },
});
const sess = join.json?.sessionToken;
const hold = await call('POST', `/api/judge/rooms/${id}/sim-hold`, {
  headers: { authorization: `Bearer ${sess}` },
  body: { ceilingCents: 5000, name: 'Asha' },
});
const bid = await call('POST', `/api/judge/rooms/${id}/bids`, {
  headers: { authorization: `Bearer ${sess}` },
  body: { amount: 1500 },
});
const ledger = await call('GET', `/api/judge/rooms/${id}/ledger`, {
  headers: { authorization: `Bearer ${r.reviewerToken}` },
});
const entries = ledger.json?.entries ?? ledger.json?.ledger ?? ledger.json?.events ?? [];

const shown = {
  create: {
    status: room.status,
    body: {
      auctionId: cut(id, 8),
      joinCode: r.joinCode,
      auctioneerToken: cut(r.auctioneerToken, 6),
      reviewerToken: cut(r.reviewerToken, 6),
    },
  },
  hold: {
    status: hold.status,
    body: hold.json
      ? { holdId: cut(hold.json.holdId, 8), ceilingCents: hold.json.ceilingCents }
      : null,
  },
  bid: { status: bid.status, body: bid.json },
  ledger: {
    status: ledger.status,
    keys: ledger.json ? Object.keys(ledger.json) : [],
    count: ledger.json?.count ?? (Array.isArray(entries) ? entries.length : null),
    headHash: cut(ledger.json?.headHash, 10),
  },
};
writeFileSync(out, JSON.stringify(shown, null, 2));
console.log(
  JSON.stringify({
    create: room.status,
    join: join.status,
    hold: hold.status,
    bid: bid.status,
    ledger: ledger.status,
  }),
);
