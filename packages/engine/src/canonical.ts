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

function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
    out.push(JSON.stringify(v));
  } else if (Array.isArray(v)) {
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(',');
      encode(v[i], out);
    }
    out.push(']');
  } else if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareUtf16);
    out.push('{');
    keys.forEach((k, i) => {
      if (FORBIDDEN_KEYS.has(k)) bad(`forbidden key ${k}`);
      checkString(k);
      if (i > 0) out.push(',');
      out.push(JSON.stringify(k), ':');
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
