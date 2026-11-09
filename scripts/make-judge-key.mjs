#!/usr/bin/env node
// Prints a new judge API key and the JUDGE_KEYS entry that goes into the host config.
// Run it in a terminal, give the KEY line to the judge once, put the ENTRY line into JUDGE_KEYS.
// Only the sha256 of the secret is configured; the key itself is never stored anywhere.
//
// Usage: node scripts/make-judge-key.mjs [--label "Asha"] [--expires 2026-11-30T23:59:00Z]
//                                        [--rooms 2] [--per-hour 10] [--json]
//        node scripts/make-judge-key.mjs --never-expires [--label "Shared judging key"]
//                                        [--rooms 10] [--per-hour 100] [--json]
// --never-expires makes ONE common key with `"expiresAt": null` and cannot be combined with
// --expires. Revoke it with POST /api/judge/keys/<id>/revoke if it ever leaks.
import { createHash, randomBytes } from 'node:crypto';

const DEFAULT_EXPIRY = '2026-11-30T23:59:00Z';
const LATEST_EXPIRY = '2026-12-15T00:00:00Z';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

/** Makes one key: `gvl_judge_<8 chars>_<48 hex>` and the matching config entry. */
export function makeJudgeKey({
  label = '',
  expires = undefined,
  neverExpires = false,
  rooms = 2,
  perHour = 10,
} = {}) {
  if (neverExpires && expires !== undefined) {
    throw new Error('--never-expires cannot be combined with --expires');
  }
  if (!neverExpires) expires = expires ?? DEFAULT_EXPIRY;
  // Same rules as the server's parseJudgeKeys (packages/server/src/auth/judge-keys.ts), so the
  // script never prints an entry the host would skip.
  let at = Number.NaN;
  if (!neverExpires) {
    if (
      typeof expires !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(expires)
    ) {
      throw new Error('--expires must be an ISO-8601 date with time and a Z or offset');
    }
    at = Date.parse(expires);
    if (Number.isNaN(at)) throw new Error('--expires must be an ISO date');
  }
  const intIn = (v, lo, hi) =>
    typeof v === 'string' || typeof v === 'number'
      ? /^\d+$/.test(String(v)) && Number(v) >= lo && Number(v) <= hi
      : false;
  if (!intIn(rooms, 1, 10)) throw new Error('--rooms must be an integer from 1 to 10');
  if (!intIn(perHour, 1, 100)) throw new Error('--per-hour must be an integer from 1 to 100');
  if (!neverExpires && at > Date.parse(LATEST_EXPIRY))
    throw new Error(`--expires must not be after ${LATEST_EXPIRY}`);
  if (typeof label !== 'string') throw new Error('--label must be text');
  const id = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('hex');
  const hash = createHash('sha256').update(secret).digest('hex');
  return {
    key: `gvl_judge_${id}_${secret}`,
    entry: {
      id,
      hash,
      label,
      expiresAt: neverExpires ? null : new Date(at).toISOString().replace('.000Z', 'Z'),
      maxRooms: Number(rooms),
      perHour: Number(perHour),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const never = process.argv.includes('--never-expires');
    const { key, entry } = makeJudgeKey({
      label: arg('label', ''),
      expires: arg('expires', undefined),
      neverExpires: never,
      rooms: arg('rooms', 2),
      perHour: arg('per-hour', 10),
    });
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ key, entry }));
    } else {
      console.log(`KEY    ${key}`);
      console.log(`ENTRY  ${JSON.stringify(entry)}`);
      console.log('');
      console.log(
        'Give the KEY to the judge once. Add the ENTRY to the JUDGE_KEYS array on the host.',
      );
      if (never) {
        console.log('');
        console.log('This key NEVER expires (sandbox rooms only). If it leaks, revoke it with');
        console.log(`POST /api/judge/keys/${entry.id}/revoke and the X-Admin-Key header.`);
        console.log('Its limits still apply: a shared key may keep up to 10 rooms (--rooms) and');
        console.log('create up to 100 per hour (--per-hour).');
      }
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
