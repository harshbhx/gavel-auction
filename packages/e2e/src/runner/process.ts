import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

/** Child process control for the stack runner: free ports, readiness, SIGKILL and cleanup. */

/** Asks the OS for a free loopback port. The port is released before it is returned. */
export function freePort(): Promise<number> {
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

export interface SpawnOptions {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
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
