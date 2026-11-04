// Deterministic synthesis of the audio fixtures. The WAV files are not
// committed; this script builds them from the committed sidecars so that
// the repository stays small. Usage: node generate.mjs [--check]
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RATE = 16000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function snrDb(noise) {
  if (noise === null) return null;
  const m = /-snr-(\d+)db$/.exec(noise);
  return m ? Number(m[1]) : null;
}

export function synthesize(sidecar) {
  const n = Math.round((sidecar.durationMs * RATE) / 1000);
  const rand = rng(seedOf(sidecar.id));
  const words = sidecar.transcriptTruth.split(' ');
  const voice = new Float64Array(n);
  const lead = 0.35 * RATE;
  const span = (n - 0.6 * RATE) / words.length;
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const w = Math.floor((i - lead) / span);
    if (w < 0 || w >= words.length) continue;
    const pos = ((i - lead) % span) / span;
    const env = Math.sin(Math.PI * Math.min(1, pos * 1.15)) ** 1.5;
    const f0 = 110 + (seedOf(words[w]) % 60) + 12 * Math.sin((2 * Math.PI * i) / (RATE * 0.9));
    phase += (2 * Math.PI * f0) / RATE;
    let s = 0;
    for (let h = 1; h <= 6; h += 1) s += Math.sin(h * phase) / h;
    voice[i] = s * env * 0.28;
  }
  const db = snrDb(sidecar.noise);
  const out = new Int16Array(n);
  let power = 0;
  for (let i = 0; i < n; i += 1) power += voice[i] * voice[i];
  const sigRms = Math.sqrt(power / n) || 0.05;
  const noiseRms = db === null ? 0.002 : sigRms / 10 ** (db / 20);
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    const white = (rand() * 2 - 1) * Math.sqrt(3) * noiseRms;
    lp = 0.7 * lp + 0.3 * white;
    const v = Math.max(-1, Math.min(1, voice[i] + (db === null ? white : lp * 1.8)));
    out[i] = Math.round(v * 32767);
  }
  return out;
}

export function encodeWav(samples) {
  const data = samples.length * 2;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(data, 40);
  for (let i = 0; i < samples.length; i += 1) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}

export function generateAll(dir = here) {
  const written = [];
  for (const f of readdirSync(dir).sort()) {
    if (!/^bid-.*\.json$/.test(f) || f.endsWith('.stt.json')) continue;
    const sidecar = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const target = join(dir, sidecar.file);
    writeFileSync(target, encodeWav(synthesize(sidecar)));
    written.push(sidecar.file);
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const missing = readdirSync(here)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.stt.json') && f.startsWith('bid-'))
      .map((f) => JSON.parse(readFileSync(join(here, f), 'utf8')).file)
      .filter((f) => !existsSync(join(here, f)));
    console.log(missing.length === 0 ? 'all wav files present' : `missing: ${missing.join(', ')}`);
    process.exit(missing.length === 0 ? 0 : 1);
  }
  console.log(`generated ${generateAll().length} wav files`);
}
