import type { Clock } from '@gavel/shared';

/** WebSocket close code for a server going away (R-RT-136). */
export const CLOSE_GOING_AWAY = 1001;
/** Total time allowed from the signal to exit. */
export const SHUTDOWN_DEADLINE_MS = 10_000;

export interface ShutdownDeps {
  clock: Clock;
  /** Stop the listener so new connections and requests are refused. */
  stopAccepting: () => Promise<void>;
  /** Loaded rooms; `close` waits for the room mailbox to drain. */
  rooms: () => Iterable<{ close: () => Promise<void> }>;
  /** Close every open socket with the given code. */
  closeConnections: (code: number, reason: string) => void;
  exit: (code: number) => void;
  onError?: (error: unknown) => void;
  deadlineMs?: number;
}

export interface Shutdown {
  /** Runs the sequence once; later calls return the same promise. Resolves to the exit code. */
  run: () => Promise<number>;
  /** Register `run` for the given signals on a process-like emitter. */
  install: (proc: { once: (sig: string, fn: () => void) => unknown }, signals?: string[]) => void;
}

export function createShutdown(deps: ShutdownDeps): Shutdown {
  const deadlineMs = deps.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  let running: Promise<number> | undefined;

  const sequence = async (): Promise<number> => {
    let code = 0;
    try {
      await deps.stopAccepting();
    } catch (error) {
      code = 1;
      deps.onError?.(error);
    }
    const results = await Promise.allSettled([...deps.rooms()].map((r) => r.close()));
    for (const r of results) {
      if (r.status === 'rejected') {
        code = 1;
        deps.onError?.(r.reason);
      }
    }
    return code;
  };

  const run = (): Promise<number> => {
    if (running) return running;
    running = new Promise<number>((resolve) => {
      let finished = false;
      let cancel: () => void = () => undefined;
      const finish = (code: number): void => {
        if (finished) return;
        finished = true;
        cancel();
        try {
          deps.closeConnections(CLOSE_GOING_AWAY, 'server_shutdown');
        } catch (error) {
          deps.onError?.(error);
        }
        deps.exit(code);
        resolve(code);
      };
      cancel = deps.clock.setTimer(deps.clock.now() + deadlineMs, () => finish(1));
      sequence().then(finish, (error: unknown) => {
        deps.onError?.(error);
        finish(1);
      });
    });
    return running;
  };

  return {
    run,
    install: (proc, signals = ['SIGTERM']) => {
      for (const sig of signals) {
        proc.once(sig, () => {
          void run();
        });
      }
    },
  };
}
