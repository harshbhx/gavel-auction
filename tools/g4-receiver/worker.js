// Receiver for the G4 gate: logs each PayPal webhook delivery untouched and serves the log.
//   POST   /hook             store {headers, rawBody, receivedAt} (body up to 256 KB) when the
//                            request looks like a PayPal delivery; anything else is not stored
//   GET    /log?token=...    JSONL, one {"headers":{...},"rawBody":"..."} per delivery
//   DELETE /log?token=...    clear the log
// Secret: LOG_TOKEN (wrangler secret put LOG_TOKEN). Binding: LOG (KV namespace).

const MAX_BODY = 256 * 1024;
const TTL_SECONDS = 2 * 24 * 3600;
const PREFIX = 'd:';
// One request does at most one list call plus MAX_ENTRIES reads or deletes, which stays inside
// the subrequest limit of a Worker invocation, and the stored log never exceeds this many entries.
const MAX_ENTRIES = 40;
const PAYPAL_HEADERS = [
  'paypal-transmission-id',
  'paypal-transmission-time',
  'paypal-transmission-sig',
  'paypal-cert-url',
  'paypal-auth-algo',
];
// Client address headers are never stored, the log is fetched by a workflow whose output is kept.
const STRIPPED_HEADERS = new Set([
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'cf-pseudo-ipv4',
  'true-client-ip',
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
]);

function text(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function sameToken(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected.length < 32) {
    return false;
  }
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i += 1) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

async function listKeys(kv, limit) {
  const page = await kv.list({ prefix: PREFIX, limit });
  return { keys: page.keys.map((k) => k.name).sort(), complete: page.list_complete };
}

function looksLikePayPalDelivery(headers, rawBody) {
  const type = headers['content-type'] ?? '';
  if (!type.toLowerCase().includes('json')) return false;
  for (const name of PAYPAL_HEADERS) {
    if (!headers[name]) return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  return (
    typeof parsed.id === 'string' &&
    parsed.id !== '' &&
    typeof parsed.event_type === 'string' &&
    parsed.event_type !== ''
  );
}

async function readLimited(request) {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY) return undefined;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/hook') {
      if (request.method !== 'POST') return text(405, 'method not allowed');
      const rawBody = await readLimited(request);
      if (rawBody === undefined) return text(413, 'payload too large');
      const headers = {};
      for (const [name, value] of request.headers) {
        const lower = name.toLowerCase();
        if (!STRIPPED_HEADERS.has(lower)) headers[lower] = value;
      }
      if (!looksLikePayPalDelivery(headers, rawBody)) return text(400, 'not a paypal delivery');
      const existing = await listKeys(env.LOG, MAX_ENTRIES);
      if (existing.keys.length >= MAX_ENTRIES) return text(429, 'log full');
      const receivedAt = new Date().toISOString();
      const entry = { headers, rawBody, receivedAt };
      const key = `${PREFIX}${receivedAt}:${crypto.randomUUID()}`;
      await env.LOG.put(key, JSON.stringify(entry), {
        expirationTtl: TTL_SECONDS,
        metadata: {
          receivedAt,
          bytes: rawBody.length,
          transmissionId: headers['paypal-transmission-id'],
        },
      });
      return text(200, 'ok');
    }

    if (url.pathname === '/log') {
      if (request.method !== 'GET' && request.method !== 'DELETE') {
        return text(405, 'method not allowed');
      }
      if (!sameToken(url.searchParams.get('token'), env.LOG_TOKEN)) {
        return text(401, 'unauthorized');
      }
      const { keys, complete } = await listKeys(env.LOG, MAX_ENTRIES);
      if (request.method === 'DELETE') {
        await Promise.all(keys.map((k) => env.LOG.delete(k)));
        return text(200, `cleared ${keys.length} more ${complete ? 0 : 1}`);
      }
      const raws = await Promise.all(keys.map((k) => env.LOG.get(k)));
      const lines = [];
      for (const raw of raws) {
        if (raw === null) continue;
        const { headers, rawBody } = JSON.parse(raw);
        lines.push(JSON.stringify({ headers, rawBody }));
      }
      return new Response(lines.length === 0 ? '' : `${lines.join('\n')}\n`, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
      });
    }

    return text(404, 'not found');
  },
};
