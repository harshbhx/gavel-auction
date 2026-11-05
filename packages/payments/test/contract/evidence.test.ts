import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-QA-028: the recorded sandbox exchanges in docs/evidence are the ground truth for the real
// response shapes. Every top-level field the real client reads must be present in each recorded
// success response of its endpoint. A recorded response that lacks one means the client (and the
// fake that mirrors it) reads a field PayPal does not send.

interface Recorded {
  method: string;
  path: string;
  status: number;
  body: Record<string, unknown>;
}

const root = join(import.meta.dirname, '../../../../docs/evidence');

function load(): Recorded[] {
  const out: Recorded[] = [];
  for (const gate of readdirSync(root)) {
    for (const file of readdirSync(join(root, gate))) {
      if (!file.endsWith('.jsonl')) continue;
      for (const line of readFileSync(join(root, gate, file), 'utf8').split('\n')) {
        if (line.trim() === '') continue;
        const rec = JSON.parse(line) as {
          request?: { method?: string; url?: string };
          response?: { status?: number; body?: unknown };
        };
        const { request, response } = rec;
        if (request?.method === undefined || request.url === undefined) continue;
        if (response?.status === undefined) continue;
        if (typeof response.body !== 'object' || response.body === null) continue;
        out.push({
          method: request.method,
          path: new URL(request.url).pathname,
          status: response.status,
          body: response.body as Record<string, unknown>,
        });
      }
    }
  }
  return out;
}

interface ClientRead {
  id: string;
  method: string;
  path: RegExp;
  statuses: readonly number[];
  fields: readonly string[];
}

const CLIENT_READS: readonly ClientRead[] = [
  {
    id: 'token',
    method: 'POST',
    path: /^\/v1\/oauth2\/token$/,
    statuses: [200],
    fields: ['access_token', 'expires_in'],
  },
  {
    id: 'create order',
    method: 'POST',
    path: /^\/v2\/checkout\/orders$/,
    statuses: [200, 201],
    fields: ['id', 'status', 'links'],
  },
  {
    id: 'get order',
    method: 'GET',
    path: /^\/v2\/checkout\/orders\/[^/]+$/,
    statuses: [200],
    fields: ['id', 'status', 'intent', 'purchase_units', 'links'],
  },
  {
    id: 'authorize order',
    method: 'POST',
    path: /^\/v2\/checkout\/orders\/[^/]+\/authorize$/,
    statuses: [201],
    fields: ['id', 'status', 'purchase_units'],
  },
  {
    id: 'get authorization',
    method: 'GET',
    path: /^\/v2\/payments\/authorizations\/[^/]+$/,
    statuses: [200],
    fields: ['id', 'status', 'amount', 'create_time', 'links'],
  },
  {
    id: 'capture',
    method: 'POST',
    path: /^\/v2\/payments\/authorizations\/[^/]+\/capture$/,
    statuses: [201],
    fields: ['id', 'status'],
  },
  {
    id: 'error 422',
    method: 'POST',
    path: /^\/v2\/payments\/authorizations\/[^/]+\/void$/,
    statuses: [422],
    fields: ['name', 'message', 'details'],
  },
];

const recorded = load();

describe('recorded sandbox evidence', () => {
  it('has recorded exchanges to check against', () => {
    expect(recorded.length).toBeGreaterThan(10);
  });

  for (const read of CLIENT_READS) {
    it(`${read.id}: every field the client reads is in the real response`, () => {
      const hits = recorded.filter(
        (r) =>
          r.method === read.method && read.path.test(r.path) && read.statuses.includes(r.status),
      );
      expect(hits.length, `no recorded ${read.id} exchange`).toBeGreaterThan(0);
      for (const hit of hits) {
        for (const field of read.fields) {
          expect(hit.body, `${read.id} ${hit.path} lacks ${field}`).toHaveProperty(field);
        }
      }
    });
  }
});
