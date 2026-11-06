/** The process events that end a Node process when nothing handles them. */
export interface FatalProc {
  on: (event: 'unhandledRejection' | 'uncaughtException', fn: (err: unknown) => void) => unknown;
}

export interface FatalDeps {
  /** Reports the error with its cause named; must not throw. */
  onError: (message: string) => void;
  /** Runs the normal shutdown sequence (lock, stores, rooms); the process exits non-zero after. */
  shutdown: () => Promise<unknown>;
  exit: (code: number) => void;
}

/**
 * Logs an unhandled rejection or uncaught exception naming its kind and message, then runs the
 * same shutdown as a signal so the data directory lock is released and stores are closed, and
 * exits non-zero. Only the first fault runs the sequence.
 */
export function installFatalHandlers(proc: FatalProc, deps: FatalDeps): void {
  let handling = false;
  const handle = (kind: string) => (err: unknown) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    deps.onError(`${kind}: ${detail}`);
    if (handling) return;
    handling = true;
    deps.shutdown().then(
      () => deps.exit(1),
      () => deps.exit(1),
    );
  };
  proc.on('unhandledRejection', handle('unhandledRejection'));
  proc.on('uncaughtException', handle('uncaughtException'));
}
