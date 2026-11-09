/**
 * The one place that decides which browser origins the API trusts. The write-origin check (#2168),
 * the CORS headers and the WebSocket upgrade all read the same set built here, so a single
 * configuration mistake cannot make them disagree (#2233).
 */

/** scheme://host[:port] with an optional single trailing slash, nothing else. */
const BARE_ORIGIN = /^https?:\/\/[^/?#@\s*]+\/?$/i;

/** Normalises one configured origin; throws an Error with a plain message when it is unusable. */
export function normalizeOrigin(raw: string): string {
  const entry = raw.trim();
  if (entry === '') throw new Error('is empty');
  if (entry.includes('*')) throw new Error(`"${entry}" has a wildcard; list each origin`);
  if (!BARE_ORIGIN.test(entry)) {
    throw new Error(
      `"${entry}" is not a bare origin: use http(s)://host[:port] with no path, query or credentials`,
    );
  }
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error(`"${entry}" is not a valid URL`);
  }
  // URL lowercases scheme and host and drops a default port; the origin has no trailing slash.
  return url.origin;
}

/** Parses a comma separated list of origins; every entry is normalised and repeats are dropped. */
export function parseOriginList(csv: string): { origins: string[]; errors: string[] } {
  const origins: string[] = [];
  const errors: string[] = [];
  for (const piece of csv.split(',')) {
    if (piece.trim() === '') continue;
    try {
      const origin = normalizeOrigin(piece);
      if (!origins.includes(origin)) origins.push(origin);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { origins, errors };
}

function originOrNull(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Every origin a browser may call from: CORS_ORIGINS, the web app (WEB_ORIGIN) and the API's own
 * origin (PUBLIC_URL). An entry that cannot be normalised is skipped here; config refuses it at
 * boot, so only hand-built test deps can reach that.
 */
export function allowedOriginsOf(src: {
  corsOrigins: readonly string[];
  webOrigin?: string | undefined;
  publicUrl: string;
}): string[] {
  const out = new Set<string>();
  for (const raw of src.corsOrigins) {
    try {
      out.add(normalizeOrigin(raw));
    } catch {
      // not usable: never allowed
    }
  }
  for (const url of [src.webOrigin, src.publicUrl]) {
    const origin = originOrNull(url);
    if (origin !== null) out.add(origin);
  }
  return [...out];
}

/** True when the browser's `Origin` header value is in the allowed list. `null` never is. */
export function isOriginAllowed(
  allowed: readonly string[],
  origin: string | null | undefined,
): origin is string {
  return typeof origin === 'string' && origin !== 'null' && allowed.includes(origin);
}

/** Browser origin of the docs site, the one extra origin the judge routes answer to by default. */
export const DEFAULT_DOCS_ORIGIN = 'https://docs.gavel.dualmindlab.tech';

/**
 * The routes the docs "Try it" panel may call from the docs origin: judge rooms and the room
 * routes a judge's own tokens open (control, receipt). Everything else, admin and ops routes
 * included, never gets CORS headers for the docs origin, and a browser write from it is refused.
 */
const DOCS_PATHS: readonly RegExp[] = [
  /^\/api\/judge\/(capabilities|key|join|rooms)$/,
  /^\/api\/judge\/rooms\/[^/]+\/(sim-hold|bids|ledger)$/,
  /^\/api\/auctions\/[^/]+\/(control|receipt-link|receipt)$/,
];

/** True when `origin` is on the explicit docs list and `pathname` is one of the judge routes. */
export function isDocsCall(
  docsOrigins: readonly string[] | undefined,
  origin: string | null | undefined,
  pathname: string,
): boolean {
  return isOriginAllowed(docsOrigins ?? [], origin) && DOCS_PATHS.some((re) => re.test(pathname));
}
