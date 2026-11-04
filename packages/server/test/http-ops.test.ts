import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ADMIN_KEY_HEADER, createOpsRoomsHandler, type OpsRoomView } from '../src/http/ops';

const KEY = 'test-admin-key-placeholder-0000';

interface Reply {
  status: number;
  headers: Record<string, string | number>;
  body: string;
}

function call(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  method: string,
  headers: Record<string, string>,
): Reply {
  const reply: Reply = { status: 0, headers: {}, body: '' };
  const req = { method, headers } as unknown as IncomingMessage;
  const res = {
    setHeader(k: string, v: string) {
      reply.headers[k] = v;
    },
    writeHead(status: number, h: Record<string, string | number>) {
      reply.status = status;
      Object.assign(reply.headers, h);
    },
    end(text: string) {
      reply.body = text;
    },
  } as unknown as ServerResponse;
  handler(req, res);
  return reply;
}

const rooms: OpsRoomView[] = [
  { auctionId: 'a1', seq: 12, status: 'OPEN', connections: 3, mailboxDepth: 1 },
  { auctionId: 'a2', seq: 40, status: 'DONE', connections: 0, mailboxDepth: 0 },
];

describe('ops rooms (T-RT-096)', () => {
  const handler = createOpsRoomsHandler({ adminKey: KEY, rooms: () => rooms });

  it('refuses a missing or wrong key', () => {
    expect(call(handler, 'GET', {}).status).toBe(401);
    expect(call(handler, 'GET', { [ADMIN_KEY_HEADER]: 'nope' }).status).toBe(401);
  });

  it('lists loaded rooms for the admin key', () => {
    const r = call(handler, 'GET', { [ADMIN_KEY_HEADER]: KEY });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ rooms });
  });

  it('rejects other methods and an empty configured key', () => {
    expect(call(handler, 'POST', { [ADMIN_KEY_HEADER]: KEY }).status).toBe(405);
    const open = createOpsRoomsHandler({ adminKey: '', rooms: () => rooms });
    expect(call(open, 'GET', { [ADMIN_KEY_HEADER]: '' }).status).toBe(401);
  });
});
