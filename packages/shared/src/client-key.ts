/**
 * The key a network client is counted under by every per-client limit (join limiter, HTTP
 * limiter, webhook budget). An IPv6 client owns a whole /64, so the key is its first four
 * groups; an IPv4-mapped IPv6 address counts as the IPv4 address; anything else is
 * returned trimmed and lower-cased, so one client cannot dodge a limit by rotating
 * addresses inside its prefix.
 */
export function clientKey(source: string): string {
  let a = source.trim().toLowerCase();
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  if (!a.includes(':')) return a;
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped?.[1] !== undefined) return mapped[1];
  let groups: string[];
  const dbl = a.indexOf('::');
  if (dbl >= 0) {
    const head = a.slice(0, dbl) === '' ? [] : a.slice(0, dbl).split(':');
    const tail = a.slice(dbl + 2) === '' ? [] : a.slice(dbl + 2).split(':');
    const fill = Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0');
    groups = [...head, ...fill, ...tail];
  } else {
    groups = a.split(':');
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a;
  const first = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ''));
  return first.join(':') + '::/64';
}
