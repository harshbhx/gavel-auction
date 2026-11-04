import type { Transport } from '@gavel/shared';

/** In-process Transport that records what the room sends, for tests and the demo. */
export class MemoryTransport implements Transport {
  readonly frames: string[] = [];
  closed: { code: number; reason: string } | undefined;

  send(text: string): void {
    this.frames.push(text);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  /** Decoded frames, optionally only those of one type. */
  messages(type?: string): Array<Record<string, unknown>> {
    const all = this.frames.map((f) => JSON.parse(f) as Record<string, unknown>);
    return type === undefined ? all : all.filter((m) => m.t === type);
  }
}
