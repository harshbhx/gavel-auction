#!/usr/bin/env node
// Prints a new judge API key and the JUDGE_KEYS entry that goes into the host config.
// Run it in a terminal, give the KEY line to the judge once, put the ENTRY line into JUDGE_KEYS.
// Only the sha256 of the secret is configured; the key itself is never stored anywhere.
//
// Usage: node scripts/make-judge-key.mjs [--label "Asha"] [--expires 2026-11-30T23:59:00Z]
//                                        [--rooms 2] [--per-hour 10] [--json]
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
  expires = DEFAULT_EXPIRY,
  rooms = 2,
  perHour = 10,
} = {}) {
  const at = Date.parse(expires);
  if (Number.isNaN(at)) throw new Error('--expires must be an ISO date');
  if (at > Date.parse(LATEST_EXPIRY))
    throw new Error(`--expires must not be after ${LATEST_EXPIRY}`);
  const id = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('hex');
  const hash = createHash('sha256').update(secret).digest('hex');
  return {
    key: `gvl_judge_${id}_${secret}`,
    entry: {
      id,
      hash,
      label,
      expiresAt: new Date(at).toISOString().replace('.000Z', 'Z'),
      maxRooms: Number(rooms),
      perHour: Number(perHour),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { key, entry } = makeJudgeKey({
      label: arg('label', ''),
      expires: arg('expires', DEFAULT_EXPIRY),
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
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
