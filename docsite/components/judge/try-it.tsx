'use client';

import { useEffect, useMemo, useState } from 'react';

// Call the API as a judge: a small client-side panel that sends real requests to the hosted
// sandbox API and shows the real answer. No answer is faked or cached. The judge key lives in
// this component's state (and sessionStorage for this tab); it is only ever sent to API_BASE.
const API_BASE = 'https://api.gavel.dualmindlab.tech';
const KEY_STORE = 'gavel-judge-key';

type Slot = 'key' | 'session' | 'auctioneer' | 'reviewer' | 'receipt' | 'none';
type Values = { id: string; code: string; key: string; session: string; auctioneer: string; reviewer: string; receipt: string };

interface Endpoint {
  id: string;
  label: string;
  method: 'GET' | 'POST';
  path: string;
  auth: Slot;
  body?: string;
  note: string;
}

const ENDPOINTS: Endpoint[] = [
  { id: 'key', label: '1. Check key', method: 'POST', path: '/api/judge/key', auth: 'key', note: 'Creates nothing. Shows the key id, its room limit and when it expires.' },
  { id: 'create', label: '2. Create room', method: 'POST', path: '/api/judge/rooms', auth: 'key', body: '{\n  "title": "My lot"\n}', note: 'Opens a sandbox room. The tokens in the answer are filled into the later steps.' },
  { id: 'join', label: '3. Join as bidder', method: 'POST', path: '/api/judge/join', auth: 'none', body: '{\n  "code": "{code}",\n  "displayName": "Asha"\n}', note: 'No key needed. Returns a session token for one bidder.' },
  { id: 'hold', label: '4. Simulated hold', method: 'POST', path: '/api/judge/rooms/{id}/sim-hold', auth: 'session', body: '{\n  "ceilingCents": 5000,\n  "name": "Asha"\n}', note: 'A sandbox hold with no PayPal login. The bidder needs one before bidding.' },
  { id: 'bid', label: '5. Bid', method: 'POST', path: '/api/judge/rooms/{id}/bids', auth: 'session', body: '{\n  "amount": 1500\n}', note: 'Amount in cents. A refused bid answers 409 with the reason.' },
  { id: 'hammer', label: '6. Hammer', method: 'POST', path: '/api/auctions/{id}/control', auth: 'auctioneer', body: '{\n  "controlId": "c1",\n  "action": "hammer",\n  "args": { "closeNow": 1 }\n}', note: 'Ends the lot now. Uses the auctioneer token from step 2.' },
  { id: 'ledger', label: '7. Ledger', method: 'GET', path: '/api/judge/rooms/{id}/ledger', auth: 'reviewer', note: 'The hash-chained ledger of the room, as a bundle you can verify.' },
  { id: 'receipt-link', label: '8. Receipt link', method: 'POST', path: '/api/auctions/{id}/receipt-link', auth: 'session', body: '{}', note: 'Mints a receipt token for the bidder.' },
  { id: 'receipt', label: '9. Receipt', method: 'GET', path: '/api/auctions/{id}/receipt', auth: 'receipt', note: 'The bidder receipt, read with the receipt token from step 8.' },
];

const EMPTY: Values = { id: '', code: '', key: '', session: '', auctioneer: '', reviewer: '', receipt: '' };
const ENV_NAME: Record<Slot, string> = { key: 'JUDGE_KEY', session: 'SESSION', auctioneer: 'AUCTIONEER', reviewer: 'REVIEWER', receipt: 'RECEIPT', none: '' };

function fill(text: string, v: Values): string {
  return text.replace('{id}', v.id || '{id}').replace('{code}', v.code || '{code}');
}

function curlOf(e: Endpoint, v: Values, body: string): string {
  const parts = [`curl -s${e.method === 'POST' ? ' -X POST' : ''} ${API_BASE}${fill(e.path, v)}`];
  if (e.auth === 'key') parts.push(`-H "x-judge-key: $${ENV_NAME.key}"`);
  else if (e.auth !== 'none') parts.push(`-H "authorization: Bearer $${ENV_NAME[e.auth]}"`);
  if (e.method === 'POST') {
    parts.push(`-H 'content-type: application/json'`);
    parts.push(`-d '${fill(body, v).replace(/\s*\n\s*/g, ' ')}'`);
  }
  return parts.join(' \\\n  ');
}

/** Plain words for the failures a judge is most likely to hit. */
function explain(status: number, error: string | undefined, retryAfter: string | null): string | null {
  if (status === 401 && error === 'judge_key_expired') return 'This key has expired. Ask for a new one.';
  if (status === 401 && error === 'judge_key_revoked') return 'This key was revoked. Ask for a new one.';
  if (status === 401 && error === 'judge_key_invalid') return 'The host did not accept this key. Check that you pasted the whole key, with no spaces.';
  if (status === 401) return 'The token for this step is missing or expired. Run the earlier step that returns it, or paste it into the values above.';
  if (status === 429) return `Rate limited${retryAfter ? `, try again in ${retryAfter} seconds` : ''}. Keys have a room cap and an hourly cap.`;
  if (status === 404) return 'Not found. Judge rooms may be switched off, or the room id or code is wrong.';
  if (status === 410) return 'That room has ended. Create a new one.';
  if (status === 409) return 'The room refused this action. The answer says why.';
  return null;
}

export function JudgeTryIt() {
  const [v, setV] = useState<Values>(EMPTY);
  const [sel, setSel] = useState('key');
  const endpoint = ENDPOINTS.find((e) => e.id === sel) ?? ENDPOINTS[0]!;
  const [bodies, setBodies] = useState<Record<string, string>>(() =>
    Object.fromEntries(ENDPOINTS.map((e) => [e.id, e.body ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ status: number; statusText: string; headers: string; body: string; hint: string | null } | null>(null);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    try {
      const k = sessionStorage.getItem(KEY_STORE);
      if (k) setV((x) => ({ ...x, key: k }));
    } catch {
      // storage can be blocked; the key then lives in memory only
    }
  }, []);

  const setKey = (key: string) => {
    setV((x) => ({ ...x, key }));
    try {
      if (key) sessionStorage.setItem(KEY_STORE, key);
      else sessionStorage.removeItem(KEY_STORE);
    } catch {
      // ignore
    }
  };

  const body = bodies[endpoint.id] ?? '';
  const curl = useMemo(() => curlOf(endpoint, v, body), [endpoint, v, body]);

  async function send() {
    setBusy(true);
    setOut(null);
    setNetErr(null);
    const headers: Record<string, string> = {};
    if (endpoint.auth === 'key') headers['x-judge-key'] = v.key.trim();
    else if (endpoint.auth !== 'none') headers.authorization = `Bearer ${v[endpoint.auth].trim()}`;
    if (endpoint.method === 'POST') headers['content-type'] = 'application/json';
    try {
      const res = await fetch(`${API_BASE}${fill(endpoint.path, v)}`, {
        method: endpoint.method,
        headers,
        ...(endpoint.method === 'POST' ? { body: fill(body, v) } : {}),
        cache: 'no-store',
        credentials: 'omit',
      });
      const text = await res.text();
      let data: unknown;
      let pretty = text;
      try {
        data = JSON.parse(text);
        pretty = JSON.stringify(data, null, 2);
      } catch {
        data = undefined;
      }
      const h = [...res.headers.entries()].map(([k, val]) => `${k}: ${val}`).join('\n');
      const rec = (data ?? {}) as Record<string, unknown>;
      const error = typeof rec.error === 'string' ? rec.error : undefined;
      setOut({ status: res.status, statusText: res.statusText, headers: h, body: pretty, hint: explain(res.status, error, res.headers.get('retry-after')) });
      if (res.ok && data !== undefined) {
        // Carry what the host returned into the later steps.
        const s = (x: unknown) => (typeof x === 'string' ? x : undefined);
        setV((x) => ({
          ...x,
          id: s(rec.auctionId) ?? x.id,
          code: s(rec.joinCode) ?? x.code,
          session: s(rec.sessionToken) ?? x.session,
          auctioneer: s(rec.auctioneerToken) ?? x.auctioneer,
          reviewer: s(rec.reviewerToken) ?? x.reviewer,
          receipt: endpoint.id === 'receipt-link' ? (s(rec.token) ?? x.receipt) : x.receipt,
        }));
      }
    } catch {
      setNetErr(
        `The browser got no readable reply from ${API_BASE}. Likely causes: no network, the host is asleep (try again in a few seconds), or this page is not on https://docs.gavel.dualmindlab.tech, the only docs origin the API lets read its answers. The curl command below works from any terminal.`,
      );
    } finally {
      setBusy(false);
    }
  }

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  };

  const field = 'w-full border-0 border-b border-fd-border bg-transparent py-1 font-mono text-sm outline-none focus:border-fd-foreground';
  const btn = 'border border-fd-border px-3 py-1 text-sm hover:bg-fd-muted disabled:opacity-50';
  const slots: Array<[keyof Values, string]> = [
    ['id', 'Room id'], ['code', 'Join code'], ['session', 'Session token'],
    ['auctioneer', 'Auctioneer token'], ['reviewer', 'Reviewer token'], ['receipt', 'Receipt token'],
  ];

  return (
    <section aria-label="Try the judge API" className="not-prose my-8 border-y border-fd-border">
      <div className="border-b border-fd-border py-3">
        <label htmlFor="judge-key" className="block text-sm font-medium">Your judge key</label>
        <input id="judge-key" type="password" autoComplete="off" spellCheck={false} placeholder="gvl_judge_..." value={v.key} onChange={(e) => setKey(e.target.value)} className={field} />
        <p className="mt-1 text-xs text-fd-muted-foreground">
          Kept in this tab only (memory and session storage) and sent only to {API_BASE}. Steps 3 to 9 use the tokens the earlier steps return.
        </p>
      </div>

      <div className="grid gap-x-6 gap-y-2 border-b border-fd-border py-3 sm:grid-cols-2">
        {slots.map(([k, label]) => (
          <label key={k} className="block text-xs text-fd-muted-foreground">
            {label}
            <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} spellCheck={false} autoComplete="off" className={field} />
          </label>
        ))}
      </div>

      <div className="border-b border-fd-border py-3">
        <label htmlFor="judge-endpoint" className="block text-sm font-medium">Endpoint</label>
        <select id="judge-endpoint" value={sel} onChange={(e) => setSel(e.target.value)} className="mt-1 w-full border border-fd-border bg-fd-background px-2 py-1 text-sm">
          {ENDPOINTS.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
        <p className="mt-2 font-mono text-sm"><b>{endpoint.method}</b> {API_BASE}{fill(endpoint.path, v)}</p>
        <p className="mt-1 text-xs text-fd-muted-foreground">{endpoint.note}</p>
        {endpoint.method === 'POST' && (
          <>
            <label htmlFor="judge-body" className="mt-3 block text-sm font-medium">Request body</label>
            <textarea id="judge-body" rows={Math.max(3, body.split('\n').length)} value={body} onChange={(e) => setBodies({ ...bodies, [endpoint.id]: e.target.value })} spellCheck={false} className="mt-1 w-full border border-fd-border bg-transparent p-2 font-mono text-sm" />
          </>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={send} disabled={busy}>{busy ? 'Sending...' : 'Send'}</button>
          <button type="button" className={btn} onClick={() => copy('curl', curl)}>{copied === 'curl' ? 'Copied' : 'Copy as curl'}</button>
        </div>
      </div>

      <div className="py-3" aria-live="polite">
        {netErr && <p role="alert" className="text-sm">{netErr}</p>}
        {out && (
          <div>
            <p className="font-mono text-sm"><b>{out.status}</b> {out.statusText}</p>
            {out.hint && <p role="alert" className="mt-1 text-sm">{out.hint}</p>}
            <details className="mt-2 border-t border-fd-border pt-2">
              <summary className="cursor-pointer text-sm">Response headers</summary>
              <pre className="mt-1 overflow-x-auto font-mono text-xs">{out.headers}</pre>
            </details>
            <div className="mt-2 flex items-center justify-between border-t border-fd-border pt-2">
              <span className="text-sm font-medium">Response body</span>
              <button type="button" className={btn} onClick={() => copy('body', out.body)}>{copied === 'body' ? 'Copied' : 'Copy'}</button>
            </div>
            <pre className="mt-1 max-h-96 overflow-auto font-mono text-xs">{out.body}</pre>
          </div>
        )}
        {!out && !netErr && <p className="text-sm text-fd-muted-foreground">The host's real answer appears here.</p>}
        <p className="mt-3 border-t border-fd-border pt-2 text-xs text-fd-muted-foreground">curl for this request (keys and tokens stay in your shell variables)</p>
        <pre className="overflow-x-auto font-mono text-xs">{curl}</pre>
      </div>
    </section>
  );
}
