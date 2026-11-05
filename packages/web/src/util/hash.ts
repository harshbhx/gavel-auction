/** JSON with object keys sorted at every depth, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
  return `{${parts.join(',')}}`;
}

function defaultSubtle(): SubtleCrypto | null {
  return typeof globalThis.crypto === 'undefined' ? null : (globalThis.crypto.subtle ?? null);
}

/** Lower-case hex SHA-256 of the text, or null when the browser has no SubtleCrypto. */
export async function sha256Hex(
  text: string,
  subtle: SubtleCrypto | null = defaultSubtle(),
): Promise<string | null> {
  if (subtle === null) return null;
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
