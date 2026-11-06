import { createServer, type IncomingMessage } from 'node:http';
import { DEFAULT_FAKE_WEBHOOK_ID, FakePayPalServer } from '@gavel/payments/fake';
import { FakeControl } from '../../../payments/src/fake/control';

/**
 * The fake PayPal as a process of its own for the stack runner (R-QA-025, R-QA-027). The server
 * under test is killed with SIGKILL at settlement checkpoints; because the fake lives here, its
 * orders, authorizations, captures and idempotency keys survive that kill, as the real PayPal
 * would. Two loopback listeners:
 *
 *   GAVEL_E2E_FAKE_PORT     the PayPal-shaped REST routes the server calls
 *   GAVEL_E2E_CONTROL_PORT  the /__fake/* control routes plus GET /__e2e/snapshot?auth=A,B
 *
 * The snapshot reports, for the named authorizations, what the fake holds, captured and
 * released, and every request id a capture call carried (replays included).
 */

const MAX_BODY_BYTES = 1_048_576;

function port(name: string): number {
  const n = Number(process.env[name]);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a port number`);
  return n;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('request too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const paypal = new FakePayPalServer({
    webhookId: DEFAULT_FAKE_WEBHOOK_ID,
    port: port('GAVEL_E2E_FAKE_PORT'),
  });
  await paypal.start();
  const control = new FakeControl(paypal, { webhookId: DEFAULT_FAKE_WEBHOOK_ID });

  const { core } = paypal;
  const requestIds: string[] = [];
  const capture = core.capture.bind(core);
  core.capture = ((...args: Parameters<typeof capture>) => {
    requestIds.push(args[3] ?? '(none)');
    return capture(...args);
  }) as typeof core.capture;

  const snapshot = (authIds: readonly string[]): Record<string, unknown> => {
    const authorizations = authIds.map((id) => {
      const a = core.getAuthorization(id);
      return {
        id,
        status: a.status,
        holdCents: a.holdCents,
        capturedCents: a.capturedCents,
        releasedCents: core.released(id),
        captureCount: a.captures.length,
        voided: a.status === 'VOIDED',
      };
    });
    const count = (op: string): number => core.calls.filter((c) => c.op === op).length;
    let invariantsOk = true;
    try {
      core.checkInvariants();
    } catch {
      invariantsOk = false;
    }
    return {
      authorizations,
      captureRequestIds: [...requestIds],
      calls: { capture: count('capture'), void: count('void'), reauthorize: count('reauthorize') },
      invariantsOk,
    };
  };

  const http = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      let status = 404;
      let headers: Record<string, string> = { 'content-type': 'application/json' };
      let body = JSON.stringify({ error: 'not_found', path: url.pathname });
      if (req.method === 'GET' && url.pathname === '/__e2e/snapshot') {
        const ids = (url.searchParams.get('auth') ?? '').split(',').filter((s) => s !== '');
        status = 200;
        body = JSON.stringify(snapshot(ids));
      } else {
        const r = await control.handle(req.method ?? 'GET', url.pathname, await readBody(req));
        if (r !== undefined) {
          status = r.status;
          headers = r.headers ?? headers;
          body = r.body;
        }
      }
      res.writeHead(status, headers);
      res.end(body);
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port('GAVEL_E2E_CONTROL_PORT'), '127.0.0.1', () => resolve());
  });
  process.stdout.write(`${JSON.stringify({ msg: 'fake-ready' })}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
