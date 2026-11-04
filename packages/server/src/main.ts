import { composeServer } from './boot/compose';
import { createShutdown } from './ops/shutdown';
import { SystemClock } from '@gavel/shared';

/** Process entry (`npm start -w @gavel/server`): validates the environment, boots and listens. */
async function main(): Promise<void> {
  const app = await composeServer(process.env);
  const port = await app.listen();
  process.stdout.write(`${JSON.stringify({ msg: 'listening', port })}\n`);
  createShutdown({
    clock: new SystemClock(),
    stopAccepting: () => app.close(),
    rooms: () => [],
    closeConnections: () => undefined,
    exit: (code) => process.exit(code),
    onError: (e) => console.error(e instanceof Error ? e.message : String(e)),
  }).install(process);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
