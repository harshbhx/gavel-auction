import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { ManagedProcess, ProcessGroup, freePort, waitForHttp } from '../src/runner/process';

const idle = (): ManagedProcess =>
  new ManagedProcess({
    name: 'idle',
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: process.cwd(),
    env: process.env,
  });

describe('stack process control (T-QA-027)', () => {
  it('hands out a port that can be bound', async () => {
    const port = await freePort();
    await new Promise<void>((resolve, reject) => {
      const s = createServer();
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => s.close(() => resolve()));
    });
  });

  it('kills a child and leaves no live process in the group', async () => {
    const group = new ProcessGroup();
    const p = group.add(idle());
    p.start();
    expect(group.alive).toHaveLength(1);
    await group.killAll();
    expect(p.running).toBe(false);
    expect(group.alive).toHaveLength(0);
  });

  it('reports a child that exits before it answers', async () => {
    const p = new ManagedProcess({
      name: 'quitter',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("boom"); process.exit(3)'],
      cwd: process.cwd(),
      env: process.env,
    });
    p.start();
    await p.exited();
    await expect(waitForHttp('http://127.0.0.1:1/', p, 2000)).rejects.toThrow(
      /quitter exited early/,
    );
  });
});
