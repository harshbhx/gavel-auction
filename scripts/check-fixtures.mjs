// Fixture validator (R-QA-035, T-QA-029). Usage: node scripts/check-fixtures.mjs [--root <dir>]
// Checks every audio sidecar, its WAV (16 kHz mono PCM, duration within 2 percent
// of durationMs, <= 400 KB), the recorded STT result, the bid fixtures and the
// total size of the fixtures directory (< 15 MB). WAV files are synthesized by
// packages/e2e/fixtures/audio/generate.mjs and must exist when this runs.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_WAV_BYTES = 400 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export function parseWav(buf) {
  if (buf.length < 44) throw new Error('file shorter than a WAV header');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let off = 12;
  let fmt = null;
  let dataBytes = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      dataBytes = size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataBytes === null) throw new Error('missing fmt or data chunk');
  const durationMs = (dataBytes / (fmt.channels * (fmt.bits / 8)) / fmt.sampleRate) * 1000;
  return { ...fmt, durationMs };
}

const ONES = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const isNum = (w) => w in ONES || w in TENS || w === 'hundred' || w === 'thousand';

function wordsValue(run) {
  let total = 0;
  let cur = 0;
  for (const w of run) {
    if (w in ONES) cur += ONES[w];
    else if (w in TENS) cur += TENS[w];
    else if (w === 'hundred') cur = (cur === 0 ? 1 : cur) * 100;
    else if (w === 'thousand') {
      total += (cur === 0 ? 1 : cur) * 1000;
      cur = 0;
    }
  }
  return total + cur;
}

/** Whole-dollar value of a spoken number run; "one fifty" is 150 and "four twenty five" is 425. */
export function spokenValue(run) {
  const first = ONES[run[0]];
  const second = run[1];
  const colloquial =
    first !== undefined &&
    first >= 1 &&
    first <= 9 &&
    second !== undefined &&
    (second in TENS || (second in ONES && ONES[second] >= 10));
  return colloquial ? first * 100 + wordsValue(run.slice(1)) : wordsValue(run);
}

function firstRun(tokens) {
  const start = tokens.findIndex(isNum);
  if (start === -1) return null;
  let end = start;
  while (end < tokens.length && isNum(tokens[end])) end += 1;
  return tokens.slice(start, end);
}

/** Reads { amountCents, bidder } from a clear spoken bid, honouring "no wait" style corrections. */
export function parseSpokenBid(text) {
  const words = text.toLowerCase().split(/\s+/);
  const joined = ` ${words.join(' ')} `;
  let after = joined;
  for (const marker of [' no wait ', ' sorry ', ' make that ']) {
    const at = after.lastIndexOf(marker);
    if (at !== -1) after = after.slice(at + marker.length - 1);
  }
  const tokens = after.trim().split(/\s+/);
  const paddleAt = tokens.lastIndexOf('paddle');
  const amountRun = firstRun(paddleAt === -1 ? tokens : tokens.slice(0, paddleAt));
  const lastPaddle = words.lastIndexOf('paddle');
  const bidderRun = lastPaddle === -1 ? null : firstRun(words.slice(lastPaddle + 1));
  return {
    amountCents: amountRun ? spokenValue(amountRun) * 100 : null,
    bidder: bidderRun ? String(spokenValue(bidderRun)) : null,
  };
}

export function dirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}

function readJson(path, errors) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    errors.push(`${path}: invalid JSON (${e.message})`);
    return null;
  }
}

export function validate(fixturesDir) {
  const errors = [];
  const audioDir = join(fixturesDir, 'audio');
  const sidecars = readdirSync(audioDir)
    .filter((f) => f.startsWith('bid-') && f.endsWith('.json') && !f.endsWith('.stt.json'))
    .sort();
  const byId = new Map();
  for (const f of sidecars) {
    const s = readJson(join(audioDir, f), errors);
    if (!s) continue;
    const where = `audio/${f}`;
    if (s.id !== f.replace(/\.json$/, '')) errors.push(`${where}: id does not match file name`);
    if (s.sampleRate !== 16000) errors.push(`${where}: sampleRate must be 16000`);
    if (!Number.isInteger(s.durationMs) || s.durationMs <= 0)
      errors.push(`${where}: durationMs must be a positive integer`);
    if (typeof s.transcriptTruth !== 'string' || s.transcriptTruth === '')
      errors.push(`${where}: transcriptTruth required`);
    if (!(s.noise === null || typeof s.noise === 'string'))
      errors.push(`${where}: noise must be a string or null`);
    const e = s.expected;
    if (!e || typeof e !== 'object') {
      errors.push(`${where}: expected missing`);
    } else {
      if (typeof e.kind !== 'string') errors.push(`${where}: expected.kind required`);
      if (!Number.isInteger(e.amountCents) || e.amountCents <= 0)
        errors.push(`${where}: expected.amountCents must be a positive integer`);
      if (typeof e.bidder !== 'string' || e.bidder === '')
        errors.push(`${where}: expected.bidder required`);
      if (typeof e.needsConfirm !== 'boolean')
        errors.push(`${where}: expected.needsConfirm must be boolean`);
      if (
        e.needsConfirm === true &&
        Array.isArray(e.candidates) &&
        !e.candidates.includes(e.amountCents)
      )
        errors.push(`${where}: expected.candidates must include expected.amountCents`);
      if (e.needsConfirm === false && typeof s.transcriptTruth === 'string') {
        const spoken = parseSpokenBid(s.transcriptTruth);
        if (spoken.amountCents !== e.amountCents)
          errors.push(
            `${where}: expected.amountCents ${e.amountCents} disagrees with the spoken amount ${spoken.amountCents}`,
          );
        if (spoken.bidder !== e.bidder)
          errors.push(
            `${where}: expected.bidder ${e.bidder} disagrees with the spoken bidder ${spoken.bidder}`,
          );
      }
    }
    byId.set(s.id, s);
    const wavPath = join(audioDir, String(s.file));
    if (!existsSync(wavPath)) {
      errors.push(`${where}: wav ${s.file} missing (run generate.mjs)`);
    } else {
      const st = statSync(wavPath);
      if (st.size > MAX_WAV_BYTES)
        errors.push(`${where}: wav is ${st.size} bytes, limit ${MAX_WAV_BYTES}`);
      try {
        const w = parseWav(readFileSync(wavPath));
        if (w.format !== 1) errors.push(`${where}: wav is not PCM`);
        if (w.channels !== 1) errors.push(`${where}: wav is not mono`);
        if (w.sampleRate !== 16000) errors.push(`${where}: wav sample rate is ${w.sampleRate}`);
        if (Math.abs(w.durationMs - s.durationMs) > s.durationMs * 0.02) {
          errors.push(
            `${where}: wav duration ${w.durationMs.toFixed(0)} ms differs from durationMs ${s.durationMs} by more than 2 percent`,
          );
        }
      } catch (err) {
        errors.push(`${where}: ${err.message}`);
      }
    }
    const sttPath = join(audioDir, String(s.sttFixture));
    if (!existsSync(sttPath)) {
      errors.push(`${where}: sttFixture ${s.sttFixture} missing`);
    } else {
      const stt = readJson(sttPath, errors);
      if (stt && (!Array.isArray(stt.words) || stt.words.length === 0))
        errors.push(`audio/${s.sttFixture}: words required`);
      else if (stt) {
        if (stt.transcript !== s.transcriptTruth)
          errors.push(`audio/${s.sttFixture}: transcript differs from transcriptTruth`);
        else if (
          Array.isArray(stt.words) &&
          stt.words.map((w) => w.word).join(' ') !== stt.transcript
        )
          errors.push(`audio/${s.sttFixture}: words do not spell the transcript`);
        for (const w of stt.words) {
          if (
            typeof w.word !== 'string' ||
            !(w.endMs > w.startMs) ||
            !(w.confidence >= 0 && w.confidence <= 1)
          ) {
            errors.push(`audio/${s.sttFixture}: bad word entry ${JSON.stringify(w)}`);
            break;
          }
        }
      }
    }
  }
  if (sidecars.length < 24)
    errors.push(`audio: expected at least 24 clips, found ${sidecars.length}`);

  const indexPath = join(audioDir, 'index.json');
  if (existsSync(indexPath)) {
    const idx = readJson(indexPath, errors);
    const ids = new Set((idx?.clips ?? []).map((c) => c.id));
    for (const id of byId.keys())
      if (!ids.has(id)) errors.push(`audio/index.json: ${id} not listed`);
    for (const id of ids) if (!byId.has(id)) errors.push(`audio/index.json: ${id} has no sidecar`);
  } else {
    errors.push('audio/index.json missing');
  }

  const bidsPath = join(fixturesDir, 'bids', 'voice-bids.json');
  if (existsSync(bidsPath)) {
    const bids = readJson(bidsPath, errors);
    for (const b of bids?.bids ?? []) {
      const s = byId.get(b.clip);
      if (!s) errors.push(`bids/voice-bids.json: unknown clip ${b.clip}`);
      else if (b.amountCents !== s.expected?.amountCents || b.paddle !== s.expected?.bidder) {
        errors.push(`bids/voice-bids.json: ${b.clip} disagrees with its sidecar`);
      }
    }
  } else {
    errors.push('bids/voice-bids.json missing');
  }

  const total = dirSize(fixturesDir);
  if (total >= MAX_TOTAL_BYTES)
    errors.push(`fixtures directory is ${total} bytes, limit ${MAX_TOTAL_BYTES}`);
  return { errors, clips: sidecars.length, totalBytes: total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root =
    i >= 0
      ? resolve(process.argv[i + 1])
      : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'e2e', 'fixtures');
  const { errors, clips, totalBytes } = validate(root);
  if (errors.length > 0) {
    for (const e of errors) console.error(`check-fixtures: ${e}`);
    process.exit(1);
  }
  console.log(`check-fixtures: ok (${clips} clips, ${totalBytes} bytes)`);
}
