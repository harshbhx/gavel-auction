import { composeServer } from './boot/compose';
import { validateBootEnv } from './config/validate';
import { installFatalHandlers } from './ops/fatal';
import { createShutdown, SHUTDOWN_DEADLINE_MS } from './ops/shutdown';
import { SystemClock } from '@gavel/shared';

/** Process entry (`npm start -w @gavel/server`): validates the environment, boots and listens. */
async function main(): Promise<void> {
  // Exits 78 naming each missing or invalid variable before anything else starts (R-QA-043).
  validateBootEnv(process.env);
  const app = await composeServer(process.env);
  const port = await app.listen();
  process.stdout.write(`${JSON.stringify({ msg: 'listening', port })}\n`);
  const deadline = Number.parseInt(process.env.SHUTDOWN_DEADLINE_MS ?? '', 10);
  let faulted = false;
  const shutdown = createShutdown({
    deadlineMs: Number.isFinite(deadline) && deadline > 0 ? deadline : SHUTDOWN_DEADLINE_MS,
    clock: new SystemClock(),
    // app.close() closes the Node WebSocket host (its sockets), drains in-flight requests, waits
    // for settlement runs and closes every room, so no separate rooms or sockets are tracked here.
    stopAccepting: () => app.close(),
    rooms: () => [],
    closeConnections: () => undefined,
    exit: (code) => process.exit(faulted ? 1 : code),
    onError: (e) => console.error(e instanceof Error ? e.message : String(e)),
  });
  shutdown.install(process, ['SIGTERM', 'SIGINT']);
  installFatalHandlers(process, {
    onError: (m) => console.error(m),
    shutdown: () => {
      faulted = true;
      return shutdown.run();
    },
    exit: (code) => process.exit(code),
  });
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
