/** Server time in epoch ms: the local clock plus a measured offset. */
export function serverNow(offsetMs: number): number {
  return Date.now() + offsetMs;
}
