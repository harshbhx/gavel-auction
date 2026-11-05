import { composeServer } from './boot/compose';
import { validateBootEnv } from './config/validate';
import { createShutdown } from './ops/shutdown';
import { SystemClock } from '@gavel/shared';

/** Process entry (`npm start -w @gavel/server`): validates the environment, boots and listens. */
async function main(): Promise<void> {
  // Exits 78 naming each missing or invalid variable before anything else starts (R-QA-043).
  validateBootEnv(process.env);
  const app = await composeServer(process.env);
  const port = await app.listen();
  process.stdout.write(`${JSON.stringify({ msg: 'listening', port })}\n`);
  createShutdown({
    clock: new SystemClock(),
    // app.close() drains in-flight requests, waits for settlement runs and closes every room;
    // no websocket gateway is mounted by this entry point yet, so there are no sockets to close.
    stopAccepting: () => app.close(),
    rooms: () => [],
    closeConnections: () => undefined,
    exit: (code) => process.exit(code),
    onError: (e) => console.error(e instanceof Error ? e.message : String(e)),
  }).install(process, ['SIGTERM', 'SIGINT']);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
