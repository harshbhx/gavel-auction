/**
 * Response and request shapes of the 12 endpoints (T-QA-028, R-QA-028).
 *
 * A shape lists every field the real client reads or sends, plus the fields PayPal documents
 * that the client ignores (marked `opt`). `diffShape` reports a field the shape requires and the
 * value lacks (missing), and a field the value carries that the shape does not declare (extra),
 * so a drift of the fake or of the client shows up in both directions.
 */

export type Prim = 'string' | 'number' | 'boolean' | 'amount' | 'iso';

export interface PrimNode {
  k: Prim;
  opt?: boolean;
}
export interface ObjNode {
  k: 'object';
  fields: Record<string, Node>;
  opt?: boolean;
}
export interface ArrNode {
  k: 'array';
  item: ObjNode;
  opt?: boolean;
}
export type Node = PrimNode | ObjNode | ArrNode;

const str = (opt = false): PrimNode => ({ k: 'string', ...(opt ? { opt } : {}) });
const num = (opt = false): PrimNode => ({ k: 'number', ...(opt ? { opt } : {}) });
const bool = (opt = false): PrimNode => ({ k: 'boolean', ...(opt ? { opt } : {}) });
const amount = (opt = false): PrimNode => ({ k: 'amount', ...(opt ? { opt } : {}) });
const iso = (opt = false): PrimNode => ({ k: 'iso', ...(opt ? { opt } : {}) });
const obj = (fields: Record<string, Node>, opt = false): ObjNode => ({
  k: 'object',
  fields,
  ...(opt ? { opt } : {}),
});
const arr = (item: ObjNode, opt = false): ArrNode => ({
  k: 'array',
  item,
  ...(opt ? { opt } : {}),
});

const link = obj({ href: str(), rel: str(), method: str() });
const authorization = obj({ id: str(), status: str(), amount: amount(), create_time: iso() });
const capture = (invoice: boolean): ObjNode =>
  obj({
    id: str(),
    status: str(),
    amount: amount(),
    final_capture: bool(),
    invoice_id: str(!invoice),
    links: arr(link, true),
  });

const orderUnit = (payments: boolean): ObjNode =>
  obj({
    reference_id: str(),
    custom_id: str(),
    amount: amount(),
    description: str(true),
    payments: obj(
      { authorizations: arr(authorization), captures: arr(capture(false), true) },
      !payments,
    ),
  });

const error = obj({ name: str(), message: str(), details: arr(obj({ issue: str() })) });

export interface Endpoint {
  id: string;
  method: 'GET' | 'POST';
  /** Matches the request path. */
  path: RegExp;
  /** Which call of the flow, when a path is used twice. */
  call?: number;
  status: number;
  response: Node | 'empty';
  /** Shape of the JSON body the real client sends, when it sends one. */
  request?: ObjNode;
}

export const ENDPOINTS: readonly Endpoint[] = [
  {
    id: 'token',
    method: 'POST',
    path: /^\/v1\/oauth2\/token$/,
    status: 200,
    response: obj({
      access_token: str(),
      expires_in: num(),
      token_type: str(true),
      scope: str(true),
      app_id: str(true),
      nonce: str(true),
    }),
  },
  {
    id: 'create order',
    method: 'POST',
    path: /^\/v2\/checkout\/orders$/,
    call: 0,
    status: 201,
    response: obj({
      id: str(),
      status: str(),
      intent: str(),
      purchase_units: arr(orderUnit(false)),
      create_time: iso(),
      links: arr(link),
    }),
    request: obj({
      intent: str(),
      purchase_units: arr(
        obj({ reference_id: str(), custom_id: str(), description: str(), amount: amount() }),
      ),
    }),
  },
  {
    id: 'get order (created)',
    method: 'GET',
    path: /^\/v2\/checkout\/orders\/[^/]+$/,
    call: 0,
    status: 200,
    response: obj({
      id: str(),
      status: str(),
      intent: str(),
      purchase_units: arr(orderUnit(false)),
      links: arr(link),
    }),
  },
  {
    id: 'authorize order',
    method: 'POST',
    path: /^\/v2\/checkout\/orders\/[^/]+\/authorize$/,
    call: 0,
    status: 201,
    response: obj({
      id: str(),
      status: str(),
      intent: str(),
      purchase_units: arr(
        obj({
          amount: amount(),
          payments: obj({ authorizations: arr(authorization) }),
        }),
      ),
    }),
  },
  {
    id: 'get authorization',
    method: 'GET',
    path: /^\/v2\/payments\/authorizations\/[^/]+$/,
    call: 0,
    status: 200,
    response: obj({
      id: str(),
      status: str(),
      amount: amount(),
      create_time: iso(),
      links: arr(link),
    }),
  },
  {
    id: 'capture',
    method: 'POST',
    path: /^\/v2\/payments\/authorizations\/[^/]+\/capture$/,
    call: 0,
    status: 201,
    response: capture(true),
    request: obj({ amount: amount(), final_capture: bool(), invoice_id: str() }),
  },
  {
    id: 'get order (authorized)',
    method: 'GET',
    path: /^\/v2\/checkout\/orders\/[^/]+$/,
    call: 1,
    status: 200,
    response: obj({
      id: str(),
      status: str(),
      intent: str(),
      purchase_units: arr(orderUnit(true)),
      links: arr(link),
    }),
  },
  {
    id: 'reauthorize',
    method: 'POST',
    path: /^\/v2\/payments\/authorizations\/[^/]+\/reauthorize$/,
    call: 0,
    status: 201,
    response: obj({
      id: str(),
      status: str(),
      amount: amount(),
      create_time: iso(),
      links: arr(link, true),
    }),
    request: obj({ amount: amount() }),
  },
  {
    id: 'void',
    method: 'POST',
    path: /^\/v2\/payments\/authorizations\/[^/]+\/void$/,
    call: 0,
    status: 204,
    response: 'empty',
  },
  {
    id: 'verify webhook signature',
    method: 'POST',
    path: /^\/v1\/notifications\/verify-webhook-signature$/,
    call: 0,
    status: 200,
    response: obj({ verification_status: str() }),
  },
  {
    id: 'error 404 (unknown authorization)',
    method: 'GET',
    path: /^\/v2\/payments\/authorizations\/[^/]+$/,
    call: 1,
    status: 404,
    response: error,
  },
  {
    id: 'error 422 (order not approved)',
    method: 'POST',
    path: /^\/v2\/checkout\/orders\/[^/]+\/authorize$/,
    call: 2,
    status: 422,
    response: error,
  },
];

const AMOUNT_VALUE = /^\d+\.\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function check(node: Node, value: unknown, path: string, out: string[]): void {
  switch (node.k) {
    case 'string':
    case 'number':
    case 'boolean':
      if (typeof value !== node.k) out.push(`type ${path}: expected ${node.k}`);
      return;
    case 'iso':
      if (typeof value !== 'string' || !ISO_TIME.test(value)) out.push(`type ${path}: not iso`);
      return;
    case 'amount': {
      if (!isObject(value)) {
        out.push(`type ${path}: expected amount`);
        return;
      }
      for (const key of Object.keys(value)) {
        if (key !== 'currency_code' && key !== 'value') out.push(`extra ${path}.${key}`);
      }
      if (typeof value['currency_code'] !== 'string') out.push(`missing ${path}.currency_code`);
      const v = value['value'];
      if (v === undefined) out.push(`missing ${path}.value`);
      else if (typeof v !== 'string' || !AMOUNT_VALUE.test(v)) out.push(`type ${path}.value`);
      return;
    }
    case 'array': {
      if (!Array.isArray(value) || value.length === 0) {
        out.push(`type ${path}: expected a non-empty array`);
        return;
      }
      value.forEach((item, i) => check(node.item, item, `${path}[${String(i)}]`, out));
      return;
    }
    case 'object': {
      if (!isObject(value)) {
        out.push(`type ${path}: expected object`);
        return;
      }
      for (const [key, child] of Object.entries(node.fields)) {
        const v = value[key];
        if (v === undefined) {
          if (child.opt !== true) out.push(`missing ${path}.${key}`);
          continue;
        }
        check(child, v, `${path}.${key}`, out);
      }
      for (const key of Object.keys(value)) {
        if (!(key in node.fields)) out.push(`extra ${path}.${key}`);
      }
    }
  }
}

/** Problems of one value against a shape; empty when it conforms. */
export function diffShape(node: Node, value: unknown): string[] {
  const out: string[] = [];
  check(node, value, '$', out);
  return out;
}
