import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { createServer } from 'node:net';

/** Child process control for the stack runner: free ports, readiness, SIGKILL and cleanup. */

// Ports come from a range below Linux's ephemeral range (32768+). A port the kernel hands out from
// that range can be taken a moment later as the source port of an outgoing connection (the
// readiness polls fetch in a loop), which is what produced EADDRINUSE between freePort() and the
// child's listen(). Each process works in its own slice so parallel workers do not collide either.
const RANGE_START = 20_000;
const SLICE = 200;
const SLICES = 60;
const issued = new Set<number>();

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

function osPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('no port was assigned'))));
    });
  });
}

/**
 * Finds a free loopback port. The port is released before it is returned, never repeats within this
 * process, and is picked from a slice of a fixed range keyed on the test worker (or the pid).
 */
export async function freePort(): Promise<number> {
  const worker = Number(process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? process.pid);
  const base = RANGE_START + (Number.isFinite(worker) ? worker % SLICES : 0) * SLICE;
  // Scan the slice from a pid-based offset, so processes sharing a slice start at different ports.
  const offset = process.pid % SLICE;
  for (let i = 0; i < SLICE; i += 1) {
    const port = base + ((offset + i) % SLICE);
    if (issued.has(port) || !(await canBind(port))) continue;
    issued.add(port);
    return port;
  }
  // The slice is crowded: let the OS choose, and still never repeat a port.
  for (;;) {
    const port = await osPort();
    if (!issued.has(port)) {
      issued.add(port);
      return port;
    }
  }
}

export interface SpawnOptions {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Append everything the process writes to stdout and stderr to this file (SEC-15 log scan). */
  logPath?: string;
}

const WIN = process.platform === 'win32';

export class ManagedProcess {
  readonly name: string;
  private child: ChildProcess | undefined;
  private tail = '';
  private done: Promise<number | null> = Promise.resolve(null);

  constructor(private readonly opts: SpawnOptions) {
    this.name = opts.name;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get running(): boolean {
    return (
      this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null
    );
  }

  /** The last 4 KB of output, for the message of a failed run. */
  get output(): string {
    return this.tail;
  }

  start(): void {
    if (this.running) throw new Error(`${this.name} is already running`);
    this.tail = '';
    // A POSIX child leads its own group so that one kill reaches its helpers too.
    const child = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd,
      env: this.opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !WIN,
      windowsHide: true,
    });
    const keep = (b: Buffer): void => {
      this.tail = (this.tail + b.toString('utf8')).slice(-4096);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    if (this.opts.logPath !== undefined) {
      const sink: WriteStream = createWriteStream(this.opts.logPath, { flags: 'a' });
      child.stdout?.pipe(sink, { end: false });
      child.stderr?.pipe(sink, { end: false });
      child.once('close', () => sink.end());
    }
    this.done = new Promise((resolve) => {
      child.once('exit', (code) => resolve(code));
      child.once('error', () => resolve(null));
    });
    this.child = child;
  }

  /** SIGKILL for the whole process tree; resolves once the process has exited. */
  async kill(): Promise<void> {
    const child = this.child;
    if (child === undefined || !this.running) return;
    const pid = child.pid;
    if (pid !== undefined) {
      if (WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      else {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }
    await this.done;
  }

  exited(): Promise<number | null> {
    return this.done;
  }
}

/** Polls a URL until it answers with any status below 500, or fails with the child's output. */
export async function waitForHttp(
  url: string,
  proc: ManagedProcess,
  timeoutMs = 30_000,
): Promise<void> {
  const attempts = Math.ceil(timeoutMs / 100);
  for (let i = 0; i < attempts; i += 1) {
    if (!proc.running) throw new Error(`${proc.name} exited early:\n${proc.output}`);
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await proc.kill();
  throw new Error(`${proc.name} did not answer ${url} in ${timeoutMs} ms:\n${proc.output}`);
}

/** Every process of a run, so a failure or a finished run leaves none behind. */
export class ProcessGroup {
  private readonly procs: ManagedProcess[] = [];

  add(p: ManagedProcess): ManagedProcess {
    this.procs.push(p);
    return p;
  }

  async killAll(): Promise<void> {
    await Promise.all(this.procs.map((p) => p.kill()));
  }

  get alive(): ManagedProcess[] {
    return this.procs.filter((p) => p.running);
  }
}
