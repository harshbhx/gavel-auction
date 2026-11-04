import { EngineError } from './errors.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function bad(msg: string): never {
  throw new EngineError('non_canonical', msg);
}

function checkString(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) bad('lone surrogate');
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      bad('lone surrogate');
    }
  }
}

/** Python json.dumps(ensure_ascii=True): every code unit outside 0x20..0x7e becomes \\uXXXX. */
function quote(s: string): string {
  return JSON.stringify(s).replace(
    /[^\x20-\x7e]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Orders by code point, as Python's sort_keys does; UTF-16 order differs for astral characters. */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = (x[i] as string).codePointAt(0) as number;
    const q = (y[i] as string).codePointAt(0) as number;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length < y.length ? -1 : x.length > y.length ? 1 : 0;
}

function encode(v: unknown, out: string[]): void {
  if (v === null) {
    out.push('null');
  } else if (typeof v === 'boolean') {
    out.push(v ? 'true' : 'false');
  } else if (typeof v === 'number') {
    if (!Number.isInteger(v) || Object.is(v, -0) || !Number.isSafeInteger(v)) {
      bad('numbers must be safe integers');
    }
    out.push(String(v));
  } else if (typeof v === 'string') {
    checkString(v);
    out.push(quote(v));
  } else if (Array.isArray(v)) {
    if (Object.keys(v).length !== v.length) bad('arrays must be dense without extra properties');
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(',');
      encode(v[i], out);
    }
    out.push(']');
  } else if (typeof v === 'object') {
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) bad('only plain objects are canonical');
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareCodePoints);
    out.push('{');
    keys.forEach((k, i) => {
      if (FORBIDDEN_KEYS.has(k)) bad(`forbidden key ${k}`);
      checkString(k);
      if (i > 0) out.push(',');
      out.push(quote(k), ':');
      encode(obj[k], out);
    });
    out.push('}');
  } else {
    bad(`unsupported value of type ${typeof v}`);
  }
}

/** Canonical JSON: sorted keys, no whitespace, integers only. Throws non_canonical otherwise. */
export function canonicalize(v: JsonValue): string {
  const out: string[] = [];
  encode(v, out);
  return out.join('');
}

export function canonicalBytes(v: JsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalize(v));
}
