/** Runs `fn` and reports its result and how many milliseconds it took on the wall clock. For benchmarks only. */
export function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}
