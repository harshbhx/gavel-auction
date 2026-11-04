/**
 * Idempotency table of the fake (R-PAY-123). Same (op, id, request id) with equal
 * params replays the stored result; different params conflict. The conflict error
 * name DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS is assumed (UNVERIFIED, G1).
 */

export class IdempotencyConflict extends Error {
  constructor(key: string) {
    super(`request id reused with different params: ${key}`);
    this.name = 'IdempotencyConflict';
  }
}

export class IdempotencyTable {
  private readonly rows = new Map<string, { params: string; result: unknown }>();

  /** Stored result for the key, undefined when absent; throws on a params mismatch. */
  replay<T>(key: string, params: string): T | undefined {
    const row = this.rows.get(key);
    if (row === undefined) return undefined;
    if (row.params !== params) throw new IdempotencyConflict(key);
    return structuredClone(row.result) as T;
  }

  store(key: string, params: string, result: unknown): void {
    this.rows.set(key, { params, result: structuredClone(result) });
  }

  /** Simulates retention expiry. */
  clear(): void {
    this.rows.clear();
  }

  size(): number {
    return this.rows.size;
  }
}
