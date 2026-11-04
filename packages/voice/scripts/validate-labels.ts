/**
 * Validates the audio fixture manifest (always) and labels.json plus the rendered WAV files
 * (when they exist). Run: node --experimental-strip-types scripts/validate-labels.ts [dir]
 * Pure functions are exported for the unit test; the CLI only does file I/O.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const cents = z.number().int().min(0);
const candidate = z
  .object({
    paddle: z.string().min(1).optional(),
    bidderId: z.string().min(1).optional(),
    amountCents: cents,
  })
  .strict();

const noiseType = z.enum(['none', 'cafe', 'crowd']);

export const labelSchema = z
  .object({
    id: z.string().regex(/^a[0-9]{2,3}$/),
    file: z.string().regex(/^[a-z0-9][a-z0-9-]*\.wav$/),
    transcript: z.string().min(1),
    category: z.string().min(1),
    voice: z.string().min(1),
    noise: z.object({ type: noiseType, snrDb: z.number().nullable() }).strict(),
    speakerBidderId: z.string().nullable(),
    context: z
      .object({
        currentPriceCents: cents,
        minIncrementCents: cents,
        pendingCandidate: candidate.optional(),
      })
      .strict(),
    expected: z
      .object({
        outcome: z.enum(['bid', 'confirm', 'none']),
        paddle: z.string().min(1).optional(),
        amountCents: cents.optional(),
        intended: candidate.optional(),
      })
      .strict(),
    acceptableConfirm: z.array(z.array(candidate).min(1)),
  })
  .strict();
export type Label = z.infer<typeof labelSchema>;

export const manifestRowSchema = z
  .object({
    id: z.string().regex(/^a[0-9]{2,3}$/),
    file: z.string().regex(/^[a-z0-9][a-z0-9-]*\.wav$/),
    text: z.string().min(1),
    category: z.string().min(1),
    voice: z.string().min(1),
    noise: noiseType,
    snrDb: z.number().nullable(),
    seed: z.number().int().min(0),
    speakerBidderId: z.string().nullable(),
    context: labelSchema.shape.context,
    expected: labelSchema.shape.expected,
    acceptableConfirm: labelSchema.shape.acceptableConfirm,
  })
  .strict();
export type ManifestRow = z.infer<typeof manifestRowSchema>;

export function manifestToLabels(rows: ManifestRow[]): Label[] {
  return rows.map((r) => ({
    id: r.id,
    file: r.file,
    transcript: r.text,
    category: r.category,
    voice: r.voice,
    noise: { type: r.noise, snrDb: r.snrDb },
    speakerBidderId: r.speakerBidderId,
    context: r.context,
    expected: r.expected,
    acceptableConfirm: r.acceptableConfirm,
  }));
}

export const MIN_UTTERANCES = 24;
export const MIN_CATEGORIES = 8;
export const MIN_NOISE_CONDITIONS = 3;
export const MIN_VOICES = 3;
export const MIN_NON_US_VOICES = 2;
export const MIN_CONFIRM = 4;
export const MIN_NONE = 3;
export const MIN_SECONDS = 0.5;
export const MAX_SECONDS = 6;

const REQUIRED_NOISE = ['none:null', 'cafe:10', 'crowd:5'];

/** Coverage and consistency of a label set (R-VOX-073). Returns human readable problems. */
export function validateCoverage(labels: Label[]): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, msg: string): void => {
    if (!ok) errors.push(msg);
  };
  need(
    labels.length >= MIN_UTTERANCES,
    `need at least ${MIN_UTTERANCES} utterances, have ${labels.length}`,
  );
  const ids = labels.map((l) => l.id);
  need(new Set(ids).size === ids.length, 'duplicate ids');
  const files = labels.map((l) => l.file);
  need(new Set(files).size === files.length, 'duplicate files');

  const categories = new Set(labels.map((l) => l.category));
  need(
    categories.size >= MIN_CATEGORIES,
    `need ${MIN_CATEGORIES} categories, have ${categories.size}`,
  );

  const noise = new Set(labels.map((l) => `${l.noise.type}:${String(l.noise.snrDb)}`));
  need(
    noise.size >= MIN_NOISE_CONDITIONS,
    `need ${MIN_NOISE_CONDITIONS} noise conditions, have ${noise.size}`,
  );
  for (const n of REQUIRED_NOISE) need(noise.has(n), `missing noise condition ${n}`);

  const voices = new Set(labels.map((l) => l.voice));
  need(voices.size >= MIN_VOICES, `need ${MIN_VOICES} voices, have ${voices.size}`);
  const nonUs = new Set(
    [...voices].filter((v) => /^tts-en-[A-Z]{2}-/.test(v) && !v.startsWith('tts-en-US-')),
  );
  need(
    nonUs.size >= MIN_NON_US_VOICES,
    `need ${MIN_NON_US_VOICES} non-US accent voices, have ${nonUs.size}`,
  );

  const confirm = labels.filter((l) => l.expected.outcome === 'confirm').length;
  const none = labels.filter((l) => l.expected.outcome === 'none').length;
  need(confirm >= MIN_CONFIRM, `need ${MIN_CONFIRM} expected-confirm items, have ${confirm}`);
  need(none >= MIN_NONE, `need ${MIN_NONE} expected-none items, have ${none}`);

  for (const l of labels) {
    const e = l.expected;
    if (e.outcome === 'bid') {
      need(e.amountCents !== undefined, `${l.id}: bid needs amountCents`);
      need(
        (e.paddle !== undefined) !== (l.speakerBidderId !== null),
        `${l.id}: a bid needs exactly one of paddle and speakerBidderId`,
      );
    } else {
      need(
        e.amountCents === undefined && e.paddle === undefined,
        `${l.id}: ${e.outcome} must not carry a bid`,
      );
    }
    if (e.outcome !== 'confirm') {
      need(l.acceptableConfirm.length === 0, `${l.id}: acceptableConfirm only applies to confirm`);
      need(e.intended === undefined, `${l.id}: intended only applies to confirm`);
    }
    need(
      (l.noise.type === 'none') === (l.noise.snrDb === null),
      `${l.id}: snrDb must be null exactly when noise is none`,
    );
  }
  return errors;
}

/** Checks a WAV buffer: PCM, 16 kHz, mono, s16le, 0.5 to 6 s. Returns problems (empty when fine). */
export function checkWav(buf: Uint8Array): string[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number): string =>
    o + 4 <= buf.length
      ? String.fromCharCode(buf[o] ?? 0, buf[o + 1] ?? 0, buf[o + 2] ?? 0, buf[o + 3] ?? 0)
      : '';
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return ['not a RIFF/WAVE file'];
  const errors: string[] = [];
  let fmtSeen = false;
  let dataBytes = -1;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = tag(pos);
    const size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      fmtSeen = true;
      if (dv.getUint16(body, true) !== 1) errors.push('format is not PCM');
      if (dv.getUint16(body + 2, true) !== 1) errors.push('not mono');
      if (dv.getUint32(body + 4, true) !== 16000) errors.push('sample rate is not 16000');
      if (dv.getUint16(body + 14, true) !== 16) errors.push('not 16-bit');
    } else if (id === 'data') {
      dataBytes = Math.min(size, buf.length - body);
      break;
    }
    pos = body + size + (size % 2);
  }
  if (!fmtSeen) errors.push('missing fmt chunk');
  if (dataBytes < 0) {
    errors.push('missing data chunk');
  } else {
    const seconds = dataBytes / 2 / 16000;
    if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
      errors.push(`duration ${seconds.toFixed(2)} s outside ${MIN_SECONDS}..${MAX_SECONDS} s`);
    }
  }
  return errors;
}

export interface ValidateOptions {
  /** Directory holding the wav files; when absent or a file is missing, the file checks are skipped. */
  audioDir?: string;
  exists?: (path: string) => boolean;
  read?: (path: string) => Uint8Array;
  /** Fail when a listed file is missing instead of skipping it. */
  requireFiles?: boolean;
}

export function validateFiles(labels: Label[], opts: ValidateOptions): string[] {
  const dir = opts.audioDir;
  if (dir === undefined) return [];
  const exists = opts.exists ?? existsSync;
  const read = opts.read ?? ((p: string) => readFileSync(p));
  const errors: string[] = [];
  for (const l of labels) {
    const p = join(dir, l.file);
    if (!exists(p)) {
      if (opts.requireFiles === true) errors.push(`${l.id}: missing file ${l.file}`);
      continue;
    }
    for (const e of checkWav(read(p))) errors.push(`${l.id}: ${e}`);
  }
  return errors;
}

export function validateManifest(json: unknown, opts: ValidateOptions = {}): string[] {
  const parsed = z.array(manifestRowSchema).safeParse(json);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `manifest ${i.path.join('.')}: ${i.message}`);
  }
  const labels = manifestToLabels(parsed.data);
  return [...validateCoverage(labels), ...validateFiles(labels, opts)];
}

export function validateLabelsJson(json: unknown, opts: ValidateOptions = {}): string[] {
  const parsed = z.array(labelSchema).safeParse(json);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `labels ${i.path.join('.')}: ${i.message}`);
  }
  return [...validateCoverage(parsed.data), ...validateFiles(parsed.data, opts)];
}

function main(): void {
  const dir = process.argv[2] ?? fileURLToPath(new URL('../fixtures/audio/', import.meta.url));
  const read = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const labelsPath = join(dir, 'labels.json');
  const haveLabels = existsSync(labelsPath);
  const errors = haveLabels
    ? validateLabelsJson(read('labels.json'), { audioDir: dir, requireFiles: true })
    : validateManifest(read('manifest.json'), { audioDir: dir });
  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  console.log(`${haveLabels ? 'labels.json' : 'manifest.json'} is valid`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}
