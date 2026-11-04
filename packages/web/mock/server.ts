import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { Scenario } from '../src/net/transport';
import { happy } from '../src/testing/scenarios/happy';
import { outbid_race } from '../src/testing/scenarios/outbid_race';
import { rejections } from '../src/testing/scenarios/rejections';
import { soft_close } from '../src/testing/scenarios/soft_close';
import { applyFaultToScenario, faultToWire, parseFaultBody } from './faults';

const PORT = 8787;
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB5DA31115E';

const scenarios: Record<string, Scenario> = {
  happy,
  outbid_race,
  soft_close,
  rejections,
};

let activeFault: ReturnType<typeof parseFaultBody> = null;

function sendWsFrame(socket: Socket, text: string): void {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function sendWsClose(socket: Socket): void {
  const frame = Buffer.alloc(2);
  frame[0] = 0x88;
  frame[1] = 0;
  socket.write(frame);
  socket.end();
}

function playScenario(socket: Socket, scenario: Scenario): void {
  const applied =
    activeFault !== null ? applyFaultToScenario(scenario, faultToWire(activeFault)) : scenario;

  const timers: ReturnType<typeof setTimeout>[] = [];

  for (const step of applied.steps) {
    if (step.emit === undefined) continue;
    if (step.fault === 'drop') continue;
    if (step.fault === 'disconnect') {
      timers.push(setTimeout(() => sendWsClose(socket), step.at));
      continue;
    }

    let delay = step.at;
    if (step.fault !== undefined && step.fault.startsWith('delay:')) {
      delay += Number(step.fault.slice('delay:'.length)) || 0;
    }

    const msg = JSON.stringify(step.emit);
    timers.push(setTimeout(() => sendWsFrame(socket, msg), delay));

    if (step.fault === 'dup') {
      timers.push(setTimeout(() => sendWsFrame(socket, msg), delay));
    }
  }

  socket.on('close', () => {
    for (const t of timers) clearTimeout(t);
  });
}

function handleFaultPost(req: IncomingMessage, res: ServerResponse): void {
  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    const spec = parseFaultBody(body);
    if (spec === null) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('invalid fault');
      return;
    }
    activeFault = spec;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'POST' && req.url === '/__fault') {
    handleFaultPost(req, res);
    return;
  }
  if (req.method === 'DELETE' && req.url === '/__fault') {
    activeFault = null;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('cleared');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

function handleUpgrade(req: IncomingMessage, socket: Socket): void {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const scenarioName = url.searchParams.get('scenario') ?? 'happy';
  const scenario = scenarios[scenarioName];
  if (scenario === undefined) {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    return;
  }

  const accept = createHash('sha1')
    .update(key + WS_MAGIC)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n',
  );

  playScenario(socket, scenario);
}

export function createMockServer(): ReturnType<typeof createServer> {
  const server = createServer(handleRequest);
  server.on('upgrade', handleUpgrade);
  return server;
}

export function resetFault(): void {
  activeFault = null;
}

if (
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  process.argv[1].includes('mock/server')
) {
  const server = createMockServer();
  server.listen(PORT, () => {
    console.log(`Mock WS server on ws://localhost:${PORT}/?scenario=happy`);
  });
}
