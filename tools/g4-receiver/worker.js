// Receiver for the G4 gate: logs each PayPal webhook delivery untouched and serves the log.
//   POST   /hook             store {headers, rawBody, receivedAt} (body up to 256 KB)
//   GET    /log?token=...    JSONL, one {"headers":{...},"rawBody":"..."} per delivery
//   DELETE /log?token=...    clear the log
// Secret: LOG_TOKEN (wrangler secret put LOG_TOKEN). Binding: LOG (KV namespace).

const MAX_BODY = 256 * 1024;
const TTL_SECONDS = 7 * 24 * 3600;
const PREFIX = 'd:';

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

async function listKeys(kv) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: PREFIX, cursor });
    for (const k of page.keys) keys.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);
  return keys.sort();
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
      for (const [name, value] of request.headers) headers[name.toLowerCase()] = value;
      const receivedAt = new Date().toISOString();
      const entry = { headers, rawBody, receivedAt };
      const key = `${PREFIX}${receivedAt}:${crypto.randomUUID()}`;
      await env.LOG.put(key, JSON.stringify(entry), { expirationTtl: TTL_SECONDS });
      return text(200, 'ok');
    }

    if (url.pathname === '/log') {
      if (request.method !== 'GET' && request.method !== 'DELETE') {
        return text(405, 'method not allowed');
      }
      if (!sameToken(url.searchParams.get('token'), env.LOG_TOKEN)) {
        return text(401, 'unauthorized');
      }
      const keys = await listKeys(env.LOG);
      if (request.method === 'DELETE') {
        await Promise.all(keys.map((k) => env.LOG.delete(k)));
        return text(200, `cleared ${keys.length}`);
      }
      const lines = [];
      for (const k of keys) {
        const raw = await env.LOG.get(k);
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
