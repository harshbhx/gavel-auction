/**
 * Deterministic audio fixture production from the manifest (R-VOX-079). Runs only in CI.
 *
 * Usage:
 *   node --experimental-strip-types scripts/make-fixtures.ts --manifest fixtures/audio/manifest.json
 *     [--out <dir>] [--licenses <file>] [--dry-run]
 *
 * A dry run plans every item, verifies that LICENSES.md names each voice and noise id, and prints a
 * hash report that depends only on the manifest entries, so two runs give identical hashes. A real
 * run renders each text with the engine named by the environment, mixes noise through
 * mix-noise.sh and writes 16 kHz mono s16le files plus a sha256 report of the outputs.
 *
 * Environment variable names (values are never committed):
 *   FIXTURE_TTS_BIN      path of the open-source speech synthesis binary
 *   FIXTURE_TTS_VOICES   directory holding one model per voice id
 *   FIXTURE_NOISE_DIR    directory holding one wav per noise id (default fixtures/audio/noise)
 *   FIXTURE_FFMPEG       ffmpeg binary (default ffmpeg)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ManifestItem {
  id: string;
  file: string;
  text: string;
  voice: string;
  noise: string;
  snrDb: number | null;
  seed: number;
}

export interface PlanEntry {
  id: string;
  file: string;
  voice: string;
  noise: string;
  snrDb: number | null;
  seed: number;
  /** sha256 over the canonical render inputs; stable across runs and machines. */
  planHash: string;
}

const SAMPLE_RATE = 16000;
const TARGET_FORMAT = 'mono s16le';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function parseManifest(json: unknown): ManifestItem[] {
  if (!Array.isArray(json)) throw new Error('manifest must be an array');
  return json.map((raw: unknown, i: number): ManifestItem => {
    if (!isRecord(raw)) throw new Error(`manifest item ${i} must be an object`);
    const { id, file, text, voice, noise, snrDb, seed } = raw;
    if (
      typeof id !== 'string' ||
      typeof file !== 'string' ||
      typeof text !== 'string' ||
      typeof voice !== 'string' ||
      typeof noise !== 'string' ||
      typeof seed !== 'number' ||
      !Number.isInteger(seed)
    ) {
      throw new Error(`manifest item ${i} is missing id, file, text, voice, noise or seed`);
    }
    if (snrDb !== null && typeof snrDb !== 'number') {
      throw new Error(`manifest item ${id} has a bad snrDb`);
    }
    if (noise !== 'none' && snrDb === null) {
      throw new Error(`manifest item ${id} has noise but no snrDb`);
    }
    return { id, file, text, voice, noise, snrDb: snrDb as number | null, seed };
  });
}

export function planItem(item: ManifestItem): PlanEntry {
  const canonical = JSON.stringify([
    item.text,
    item.voice,
    item.noise,
    item.snrDb,
    item.seed,
    SAMPLE_RATE,
    TARGET_FORMAT,
  ]);
  return {
    id: item.id,
    file: item.file,
    voice: item.voice,
    noise: item.noise,
    snrDb: item.snrDb,
    seed: item.seed,
    planHash: createHash('sha256').update(canonical).digest('hex'),
  };
}

export function buildPlan(items: readonly ManifestItem[]): PlanEntry[] {
  return items.map(planItem);
}

/** Returns the voice and noise ids used by the plan that have no row in the licenses table. */
export function missingLicenses(plan: readonly PlanEntry[], licensesText: string): string[] {
  const rows = new Set<string>();
  for (const line of licensesText.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1];
    if (first !== undefined) rows.add(first.trim());
  }
  const used = new Set<string>();
  for (const e of plan) {
    used.add(e.voice);
    if (e.noise !== 'none') used.add(e.noise);
  }
  return [...used].filter((id) => !rows.has(id)).sort();
}

export function reportHash(plan: readonly PlanEntry[]): string {
  return createHash('sha256')
    .update(plan.map((e) => e.planHash).join('\n'))
    .digest('hex');
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} failed with status ${String(r.status)}`);
}

function render(plan: readonly PlanEntry[], items: readonly ManifestItem[], outDir: string): void {
  const tts = process.env['FIXTURE_TTS_BIN'];
  const voices = process.env['FIXTURE_TTS_VOICES'];
  if (tts === undefined || voices === undefined) {
    throw new Error('FIXTURE_TTS_BIN and FIXTURE_TTS_VOICES must be set');
  }
  const noiseDir = process.env['FIXTURE_NOISE_DIR'] ?? 'fixtures/audio/noise';
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const e of plan) {
    const item = items.find((x) => x.id === e.id);
    if (item === undefined) continue;
    const raw = join(outDir, `${e.id}.raw.wav`);
    const out = join(outDir, e.file);
    const speech = spawnSync(tts, ['--model', join(voices, e.voice), '--output_file', raw], {
      input: item.text,
    });
    if (speech.status !== 0) throw new Error(`speech rendering failed for ${e.id}`);
    const noisePath = e.noise === 'none' ? 'none' : join(noiseDir, `${e.noise}.wav`);
    run('bash', [
      join(here, 'mix-noise.sh'),
      raw,
      out,
      noisePath,
      e.snrDb === null ? '0' : String(e.snrDb),
      String(e.seed),
    ]);
    hashes[e.file] = sha256File(out);
  }
  writeFileSync(join(outDir, 'hashes.json'), `${JSON.stringify(hashes, null, 2)}\n`);
}

export function main(argv: readonly string[]): number {
  const manifestPath = arg(argv, '--manifest');
  if (manifestPath === undefined) {
    process.stderr.write('usage: make-fixtures --manifest <file> [--out dir] [--dry-run]\n');
    return 2;
  }
  const items = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown);
  const plan = buildPlan(items);
  const licensesPath = arg(argv, '--licenses') ?? resolve(dirname(manifestPath), 'LICENSES.md');
  const missing = missingLicenses(plan, readFileSync(licensesPath, 'utf8'));
  if (missing.length > 0) {
    process.stderr.write(`LICENSES.md has no row for: ${missing.join(', ')}\n`);
    return 1;
  }
  if (argv.includes('--dry-run')) {
    for (const e of plan) process.stdout.write(`${e.id} ${e.file} ${e.planHash}\n`);
    process.stdout.write(`report ${reportHash(plan)}\n`);
    return 0;
  }
  render(plan, items, arg(argv, '--out') ?? 'fixtures/audio/out');
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
