import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clientSchemas } from '../src/wire/client';
import { decodeMsg, encodeMsg } from '../src/wire/codec';
import { serverSchemas } from '../src/wire/server';
import { RoomEventSchema } from '../src/events';

const dir = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const load = (name: string): { file: string; value: unknown }[] =>
  readdirSync(dir(name))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, value: JSON.parse(readFileSync(`${dir(name)}/${file}`, 'utf8')) }));

const messages = load('messages');
const events = load('events');

describe('golden fixtures (T-RT-020)', () => {
  it('has one message fixture per wire message type', () => {
    const want = [...Object.keys(clientSchemas), ...Object.keys(serverSchemas)].sort();
    expect(messages.map((m) => m.file.replace(/\.json$/, ''))).toEqual(want);
  });

  it('has one event fixture per RoomEvent type', () => {
    const want = RoomEventSchema.options.map((o) => o.shape.type.value).sort();
    expect(events.map((e) => e.file.replace(/\.json$/, ''))).toEqual(want);
  });

  it.each(messages)('message $file decodes then encodes byte-identically', ({ value }) => {
    const raw = JSON.stringify(value);
    const from = Object.prototype.hasOwnProperty.call(clientSchemas, (value as { t: string }).t)
      ? 'client'
      : 'server';
    const decoded = decodeMsg(raw, from);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const encoded = encodeMsg(decoded.value);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.value).toBe(raw);
  });

  it.each(events)('event $file decodes then encodes byte-identically', ({ value }) => {
    const raw = JSON.stringify(value);
    const parsed = RoomEventSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(JSON.stringify(parsed.data)).toBe(raw);
  });
});
