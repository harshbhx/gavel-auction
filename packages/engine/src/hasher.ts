export interface Hasher {
  sha256Hex(bytes: Uint8Array): string;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export { pureHasher } from './sha256.js';
