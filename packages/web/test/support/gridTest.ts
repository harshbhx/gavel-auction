import { createHash } from 'node:crypto';

/** SHA-256 for the ledger tests, so they do not depend on WebCrypto being present in jsdom. */
export function nodeHash(text: string): Promise<string | null> {
  return Promise.resolve(createHash('sha256').update(text).digest('hex'));
}

/** AG Grid measures with ResizeObserver, which jsdom lacks. */
export function stubResizeObserver(): void {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
}
