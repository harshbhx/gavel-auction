/**
 * Keeps the held-out text set honest (R-VOX-077): its hash is recorded in HELDOUT.sha256 and a
 * change is only accepted together with a new dated line in CHANGELOG-HELDOUT.md that names the
 * new hash. Run: node --experimental-strip-types scripts/check-heldout.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Canonical hash of the held-out entries of cases.json: compact JSON, file order. */
export function heldoutHash(cases: unknown): string {
  if (!Array.isArray(cases)) throw new Error('cases.json must be an array');
  const held = cases.filter(
    (c): boolean =>
      typeof c === 'object' && c !== null && (c as { set?: unknown }).set === 'heldout',
  );
  return createHash('sha256').update(JSON.stringify(held)).digest('hex');
}

const CHANGELOG_LINE = /^- (\d{4}-\d{2}-\d{2}) ([0-9a-f]{64}) (.+)$/;

export interface HeldoutInputs {
  cases: unknown;
  /** Content of HELDOUT.sha256. */
  recorded: string;
  /** Content of CHANGELOG-HELDOUT.md. */
  changelog: string;
}

/** Returns the problems found; an empty list means the held-out set is untouched or properly logged. */
export function checkHeldout(input: HeldoutInputs): string[] {
  const actual = heldoutHash(input.cases);
  const recorded = input.recorded.trim();
  const entries = input.changelog
    .split('\n')
    .map((l) => CHANGELOG_LINE.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null);
  const errors: string[] = [];
  if (actual !== recorded) {
    errors.push(
      `held-out set changed: hash is ${actual}, HELDOUT.sha256 records ${recorded}. ` +
        'Add a dated line "- YYYY-MM-DD <new hash> <reason>" to CHANGELOG-HELDOUT.md and update HELDOUT.sha256.',
    );
  }
  const last = entries[entries.length - 1];
  if (last === undefined) {
    errors.push('CHANGELOG-HELDOUT.md has no dated entry');
  } else if (last[2] !== recorded) {
    errors.push(
      'the newest CHANGELOG-HELDOUT.md line does not name the hash recorded in HELDOUT.sha256',
    );
  }
  const dates = entries.map((e) => e[1] ?? '');
  if (dates.some((d, i) => i > 0 && d < (dates[i - 1] ?? ''))) {
    errors.push('CHANGELOG-HELDOUT.md entries must be in date order');
  }
  return errors;
}

function main(): void {
  const dir = fileURLToPath(new URL('../fixtures/text/', import.meta.url));
  const errors = checkHeldout({
    cases: JSON.parse(readFileSync(`${dir}cases.json`, 'utf8')),
    recorded: readFileSync(`${dir}HELDOUT.sha256`, 'utf8'),
    changelog: readFileSync(`${dir}CHANGELOG-HELDOUT.md`, 'utf8'),
  });
  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  console.log('held-out set matches its recorded hash');
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}
