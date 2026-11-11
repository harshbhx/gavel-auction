// Cuts the narration take into sentence clips, places each clip on the film timeline and writes
//   audio/voiceover.mp3   the narration track, as long as the film
//   src/captions.json     the burned-in caption cues (film seconds), timed from the take's word timings
// Audio only, a few seconds of ffmpeg. Usage: node voiceover.mjs
// Each clip is cut from one of three ElevenLabs takes (see TAKE_FILES); the word-level transcript of each take
// gives the cut points and the caption timings. Each clip starts `at` seconds into its scene; `cues` are the
// caption lines with the number of spoken words each one covers.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Usage: node voiceover.mjs   (reads the takes and word timings in audio/ and ~/hackathon/film-v3-1-video/vo-src)
// v3.1 voices (ElevenLabs, model eleven_v4): 0 narrator "Ratchet v14 Narrator", 1 auctioneer "Ratchet v14 Ultra",
// 2 the app's confirm prompt "Ratchet v14 Examiner". A plan entry says which take it is cut from (`take`, default 0).
const SRC =
  process.env.VO_SRC || path.join(process.env.HOME ?? '', 'hackathon/film-v3-1-video/vo-src');
const TAKE_FILES = [
  [path.join(SRC, 'narrator.mp3'), path.join(here, 'audio/words-narrator.json')],
  [path.join(SRC, 'auctioneer.mp3'), path.join(here, 'audio/words-auctioneer.json')],
  [path.join(SRC, 'confirm.mp3'), path.join(here, 'audio/words-confirm.json')],
];

const PLAN = [
  { scene: 'hook', at: 0.5, cues: [['$500, held.', 4]] },
  { scene: 'hook', at: 2.9, cues: [['Charged so far: nothing.', 4]] },
  {
    scene: 'title',
    at: 0.7,
    cues: [
      ['This is GAVEL.', 3],
      ['Every bid is a hold.', 5],
      ['The hammer is the payment.', 5],
    ],
  },
  { scene: 'problem', at: 0.3, cues: [['Charge bidders up front, and they hold back.', 8]] },
  { scene: 'problem', at: 3.0, cues: [['Skip the hold, and winners walk away.', 7]] },
  { scene: 'problem', at: 5.6, cues: [['Paper sheets prove nothing.', 4]] },
  { scene: 'mechanism', at: 0.5, cues: [['So each bidder authorizes a ceiling.', 6]] },
  { scene: 'mechanism', at: 3.5, cues: [['Bids climb underneath it.', 4]] },
  {
    scene: 'mechanism',
    at: 6.4,
    cues: [
      ['When the hammer falls,', 4],
      ['GAVEL captures only the winning price,', 6],
      ['and releases everything else.', 4],
    ],
  },
  {
    scene: 'join',
    at: 0.6,
    cues: [
      ['Bidders join from their phone with a room code,', 9],
      ['or by scanning the QR code.', 6],
    ],
  },
  {
    scene: 'hold',
    at: 1.1,
    cues: [
      ['Pick a limit,', 3],
      ['then press and hold to approve a PayPal hold.', 9],
    ],
  },
  { scene: 'hold', at: 7.0, cues: [['The money is held, not charged.', 6]] },
  {
    scene: 'bid',
    at: 0.8,
    cues: [
      ['The auctioneer opens the lot,', 5],
      ['and bids arrive in real time.', 6],
    ],
  },
  {
    scene: 'bid',
    at: 6.3,
    cues: [
      ["The leader's phone turns green,", 5],
      ['the other says outbid,', 4],
      ['and the price only moves up.', 6],
    ],
  },
  { scene: 'voice', at: 0.2, cues: [['The auctioneer can also call a bid out loud.', 9]] },
  { scene: 'voice', at: 3.4, take: 1, cues: [['"three fifty for paddle twelve"', 4]] },
  { scene: 'voice', at: 5.3, cues: [['GAVEL hears it, and asks to confirm.', 7]] },
  { scene: 'voice', at: 7.9, take: 2, cues: [['Did you mean $350 for paddle 12?', 7]] },
  {
    scene: 'hammer',
    at: 0.3,
    cues: [['To close the lot, hold the hammer for three seconds.', 10]],
  },
  { scene: 'hammer', at: 4.0, take: 1, cues: [['Going once.', 2]] },
  { scene: 'hammer', at: 5.0, take: 1, cues: [['Going twice.', 2]] },
  { scene: 'hammer', at: 6.0, take: 1, cues: [['Sold, to paddle 12, at $350.', 6]] },
  { scene: 'settle', at: 0.3, cues: [['Settlement is a single step.', 5]] },
  {
    scene: 'settle',
    at: 2.4,
    cues: [
      ["The winner's hold is captured for the winning price,", 9],
      ['the remainder is released,', 4],
      ['and every other hold is voided.', 6],
    ],
  },
  { scene: 'receipt', at: 0.5, cues: [['Everyone gets a receipt they can share.', 7]] },
  { scene: 'receipt', at: 5.95, cues: [['Every event is written to a hash-chained ledger.', 8]] },
  { scene: 'receipt', at: 8.8, cues: [['Change a single entry, and the chain breaks.', 8]] },
  { scene: 'proof', at: 0.4, cues: [['Measured, not promised.', 3]] },
  { scene: 'proof', at: 2.3, cues: [['A server kill in the middle of settlement: survived.', 9]] },
  { scene: 'proof', at: 5.9, cues: [['Webhooks: six of six verified.', 5]] },
  { scene: 'proof', at: 8.8, cues: [['Latency: both targets missed, and we say so.', 8]] },
  {
    scene: 'speed',
    at: 0.5,
    cues: [
      ['The landing page scores 100 in every Lighthouse category,', 10],
      ['on mobile and on desktop.', 5],
    ],
  },
  {
    scene: 'judges',
    at: 0.5,
    cues: [
      ['For judges: one shared key,', 5],
      ['in the Devpost testing instructions.', 6],
    ],
  },
  { scene: 'judges', at: 6.4, cues: [['And the try page needs no key at all.', 9]] },
  { scene: 'docs', at: 0.5, cues: [['GAVEL ships with a full docs site.', 7]] },
  {
    scene: 'docs',
    at: 3.2,
    cues: [
      ['Guides for every step, from holds to settlement,', 8],
      ['an API reference for the host API,', 7],
      ['and typed SDKs to call it from code.', 8],
    ],
  },
  { scene: 'builtWith', at: 1.0, cues: [['Payments run in the PayPal sandbox.', 6]] },
  { scene: 'builtWith', at: 3.4, cues: [['The API is hosted on Render.', 6]] },
  { scene: 'builtWith', at: 5.7, cues: [['Typed SDKs are generated with APIMatic.', 6]] },
  { scene: 'builtWith', at: 9.1, cues: [['Live bid and audit tables run on AG Grid.', 9]] },
  {
    scene: 'open',
    at: 0.4,
    cues: [
      ['Still open: the honor period test is in progress,', 9],
      ['and speech accuracy is partial.', 5],
    ],
  },
  {
    scene: 'open',
    at: 5.75,
    cues: [
      ['Sandbox only.', 2],
      ['No real money moves.', 4],
    ],
  },
  { scene: 'outro', at: 0.9, cues: [['GAVEL.', 1]] },
  { scene: 'outro', at: 2.1, cues: [['Built by Harsh Bhanushali and Dhairya Patel.', 7]] },
  {
    scene: 'outro',
    at: 5.6,
    cues: [
      ['Every bid is a hold.', 5],
      ['The hammer is the payment.', 5],
    ],
  },
];

const scenes = JSON.parse(readFileSync(path.join(here, 'src/scenes.json'), 'utf8')).scenes;
const startOf = {};
let total = 0;
for (const s of scenes) {
  startOf[s.id] = total;
  total += s.dur;
}
const run = (args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-nostats', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
/** Words, length and detected pauses of one take. */
const analyze = (file, wordsFile) => {
  const words = JSON.parse(readFileSync(wordsFile, 'utf8')).words.filter(
    (x) => (x.type ?? 'word') === 'word',
  );
  const dur = Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { encoding: 'utf8' },
    ).trim(),
  );
  const det = execFileSync(
    'sh',
    [
      '-c',
      `ffmpeg -hide_banner -nostats -i "${file}" -af silencedetect=noise=-35dB:d=0.16 -f null - 2>&1`,
    ],
    { encoding: 'utf8' },
  );
  const silences = [...det.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map(
    (m) => ({ start: +m[1] - +m[2], end: +m[1] }),
  );
  return { file, words, dur, silences };
};
const TAKES = TAKE_FILES.map(([f, w]) => analyze(f, w));
TAKES.forEach((tk, i) => {
  const planned = PLAN.filter((c) => (c.take ?? 0) === i).reduce(
    (n, c) => n + (c.skip ?? c.cues.reduce((m, q) => m + q[1], 0)),
    0,
  );
  if (planned !== tk.words.length)
    throw new Error(`plan covers ${planned} words of take ${i}, the take has ${tk.words.length}`);
});

const r3 = (x) => +x.toFixed(3);
const wc = TAKES.map(() => 0);
const clips = [];
for (const c of PLAN) {
  const ti = c.take ?? 0;
  if (c.skip) {
    wc[ti] += c.skip;
    continue;
  }
  const { words, silences, dur: takeDur } = TAKES[ti];
  let w = wc[ti];
  const first = w;
  const cueFirst = [];
  for (const q of c.cues) {
    cueFirst.push(w);
    w += q[1];
  }
  wc[ti] = w;
  const last = w - 1;
  const prevEnd = first > 0 ? words[first - 1].end : 0;
  const nextStart = last + 1 < words.length ? words[last + 1].start : takeDur;
  // Cut in the pause before the first word and in the pause after the last one (the transcript's word ends
  // can run into the pause, so the detected silence decides).
  const before = silences.find(
    (s) => s.end > words[first].start - 0.25 && s.end < words[first].start + 0.12,
  );
  const from = Math.max(
    0,
    before
      ? Math.max(before.start + 0.04, before.end - 0.1)
      : Math.max(prevEnd + 0.02, words[first].start - 0.08),
  );
  const after = silences.find(
    (s) => s.start > words[last].start + 0.08 && s.start < nextStart + 0.05,
  );
  const to =
    last + 1 < words.length
      ? Math.min(
          after ? after.start + 0.24 : words[last].end + 0.2,
          (after ? after.end : nextStart) - 0.04,
        )
      : takeDur;
  const abs = startOf[c.scene] + c.at;
  clips.push({
    ti,
    scene: c.scene,
    abs: r3(abs),
    from: r3(from),
    to: r3(to),
    len: r3(to - from),
    cues: c.cues.map((q, i) => ({
      text: q[0],
      a: r3(abs + Math.max(0, words[cueFirst[i]].start - from - 0.06)),
    })),
  });
}

const problems = [];
for (let i = 0; i < clips.length; i += 1) {
  const c = clips[i];
  const next = clips[i + 1];
  const end = c.abs + c.len;
  // The last 0.24 s of a clip is the pause after its last word, so a small overlap of that tail is silent.
  if (next && end - 0.2 > next.abs)
    problems.push(
      `clip ${i} [${c.scene}] ends ${end.toFixed(2)} but the next starts ${next.abs.toFixed(2)}`,
    );
  const sceneEnd = startOf[c.scene] + scenes.find((s) => s.id === c.scene).dur;
  if (end - 0.2 > sceneEnd)
    problems.push(
      `clip ${i} [${c.scene}] ends ${end.toFixed(2)} after its scene (${sceneEnd.toFixed(2)})`,
    );
}
if (problems.length) throw new Error(problems.join('\n'));

// captions
const cues = [];
clips.forEach((c, i) => {
  const next = clips[i + 1];
  c.cues.forEach((q, j) => {
    const b =
      j + 1 < c.cues.length
        ? c.cues[j + 1].a
        : Math.min(c.abs + c.len + 0.3, next ? next.cues[0].a - 0.04 : total - 0.1);
    cues.push({ a: q.a, b: r3(b), text: q.text, scene: c.scene });
  });
});
writeFileSync(
  path.join(here, 'src/captions.json'),
  JSON.stringify({ duration: total, cues }, null, 2) + '\n',
);

// narration track
mkdirSync(path.join(here, 'audio'), { recursive: true });
const parts = clips.map((c, i) => {
  const fadeOut = Math.max(0, c.len - 0.09);
  return `[${c.ti}:a]atrim=${c.from}:${c.to},asetpts=PTS-STARTPTS,afade=t=in:d=0.025,afade=t=out:st=${fadeOut.toFixed(3)}:d=0.09,adelay=${Math.round(c.abs * 1000)}:all=1[c${i}]`;
});
// A silent bed from 0 s is the first input of the mix: without it the mix would start at the first clip and the
// whole track would sit early by that clip's delay.
const mix = `[${TAKES.length}:a]${clips.map((_, i) => `[c${i}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0:dropout_transition=0,apad=whole_dur=${total},atrim=0:${total},volume=3dB,alimiter=limit=0.89:level=disabled,aresample=44100[out]`;
const out = path.join(here, 'audio/voiceover.mp3');
run([
  '-y',
  ...TAKES.flatMap((tk) => ['-i', tk.file]),
  '-f',
  'lavfi',
  '-t',
  String(total),
  '-i',
  'anullsrc=r=44100:cl=mono',
  '-filter_complex',
  [...parts, mix].join(';'),
  '-map',
  '[out]',
  '-ac',
  '1',
  '-c:a',
  'libmp3lame',
  '-b:a',
  '128k',
  out,
]);

console.log(`film ${total} s, ${clips.length} clips, ${cues.length} caption cues`);
for (const c of clips)
  console.log(
    `${c.abs.toFixed(2).padStart(7)} -> ${(c.abs + c.len).toFixed(2).padStart(7)}  [${c.scene}] take ${c.from.toFixed(2)}-${c.to.toFixed(2)}  ${c.cues.map((q) => q.text).join(' | ')}`,
  );
