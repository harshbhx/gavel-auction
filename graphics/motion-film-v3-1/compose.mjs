// Composes the GAVEL launch film v3 (full motion graphics, no recording) with Remotion. CI only
// (.github/workflows/launch-film.yml); run from this directory after npm ci.
// Usage: [FPS=60|30] [SCALE=1|0.6667] [SCENES=hook,title,mechanism] [NAME=gavel-launch-film-v3]
//        [SPONSOR_LOGOS=on] [SHARE=0] [SHARD=i/n | CHUNKS=<dir>] [MAX_MB=56] node compose.mjs <outDir>
// 1. Links the app fonts, the brand SVGs and the partner marks into public/, writes props.json.
// 2. Renders the Film composition, writes the 720p30 share copy (full cuts), poster, SRT, timeline.json,
//    4 fps contact sheets, the frame-difference check and report.txt; re-encodes under a bitrate cap when the
//    MP4 passes MAX_MB (56, so the voice-over copy stays under 60 MB).
// 3. Full cuts also get a voice-over copy of each MP4 (the picture is copied, audio/voiceover.mp3 is added).
//    The captions are burned into the picture by the Film composition (src/captions.tsx).
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.resolve(process.argv[2] ?? 'out/final');
const FPS = Number(process.env.FPS || 60);
const SCALE = Number(process.env.SCALE || 1);
const NAME = process.env.NAME || 'gavel-launch-film-v3-1';
const SHARE = process.env.SHARE !== '0';
const SPONSOR_LOGOS = process.env.SPONSOR_LOGOS === 'on';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[film]', ...a);
const warn = [];
const W = Math.round(1920 * SCALE);
const H = Math.round(1080 * SCALE);

const sh = (cmd, args, label = cmd, opts = {}) => {
  log('$', cmd, args.join(' ').slice(0, 160));
  try {
    return execFileSync(cmd, args, {
      stdio: opts.capture ? 'pipe' : 'inherit',
      cwd: here,
      ...opts,
    });
  } catch {
    throw new Error(`${label} failed`);
  }
};
const ff = (args, label = 'ffmpeg') =>
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], label);

// ----------------------------------------------------------------------------- scenes and props
const table = JSON.parse(readFileSync(path.join(here, 'src/scenes.json'), 'utf8')).scenes;
const ids = (process.env.SCENES || table.map((s) => s.id).join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const scenes = ids.map((id) => {
  const s = table.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  return s;
});
const total = scenes.reduce((n, s) => n + s.dur, 0);
const full = ids.length === table.length;
log(
  `${scenes.length} scenes, ${total.toFixed(1)} s at ${FPS} fps, ${W}x${H}${full ? '' : ' (subset)'}`,
);
if (full && (total < 150 || total > 170))
  warn.push(`duration ${total.toFixed(1)} s is outside 2:30 to 2:50`);

const lockup = readFileSync(path.join(root, 'brand/svg/lockup-h-color.svg'), 'utf8');
const letters = [
  ...lockup.matchAll(/<g><g transform="translate\(([\d.]+) 0\)">([\s\S]*?)<\/g><\/g>/g),
].map((x) => `<g transform="translate(${x[1]} 0)">${x[2]}</g>`);
if (letters.length !== 5)
  throw new Error('expected 5 wordmark letters in brand/svg/lockup-h-color.svg');
const letterSvg = letters.map((l) => l.replace(/fill="#1d1712"/g, 'fill="currentColor"'));

const props = { fps: FPS, ids, scale: SCALE, letters: letterSvg, sponsorLogos: SPONSOR_LOGOS };
const propsFile = path.join(here, 'props.json');
writeFileSync(propsFile, JSON.stringify(props));

const PUBLIC = path.join(here, 'public');
rmSync(PUBLIC, { recursive: true, force: true });
mkdirSync(PUBLIC, { recursive: true });
cpSync(path.join(root, 'packages/web/src/design/fonts'), path.join(PUBLIC, 'fonts'), {
  recursive: true,
});
cpSync(path.join(root, 'brand/svg'), path.join(PUBLIC, 'brand'), { recursive: true });
if (existsSync(path.join(root, 'brand/partners')))
  cpSync(path.join(root, 'brand/partners'), path.join(PUBLIC, 'partners'), { recursive: true });

// ----------------------------------------------------------------------------- render
// Three ways to get the picture: render it all here; render one shard of it (SHARD=i/n, a CI matrix job
// writes chunk-i.mp4 and stops); or stitch the shards another job rendered (CHUNKS=<dir>, no render).
const mp4 = path.join(OUT, `${NAME}.mp4`);
const concurrency = process.env.CONCURRENCY || '3';
const frames = scenes.reduce((n, s) => n + Math.max(1, Math.round(s.dur * FPS)), 0);
const render = (out, range) =>
  sh(
    'npx',
    [
      'remotion',
      'render',
      'Film',
      out,
      `--props=${propsFile}`,
      `--concurrency=${concurrency}`,
      '--crf=17',
      '--codec=h264',
      '--muted',
      '--log=info',
      ...(range ? [`--frames=${range}`] : []),
    ],
    'remotion render',
  );
if (process.env.SHARD) {
  const [i, n] = process.env.SHARD.split('/').map(Number);
  const a = Math.floor((i * frames) / n);
  const b = Math.floor(((i + 1) * frames) / n) - 1;
  log(`shard ${i + 1} of ${n}: frames ${a} to ${b} of ${frames}`);
  render(path.join(OUT, `chunk-${String(i).padStart(2, '0')}.mp4`), `${a}-${b}`);
  process.exit(0);
}
if (process.env.CHUNKS) {
  const dir = path.resolve(process.env.CHUNKS);
  const chunks = readdirSync(dir)
    .filter((f) => /^chunk-\d+\.mp4$/.test(f))
    .sort();
  if (!chunks.length) throw new Error(`no chunk-*.mp4 in ${dir}`);
  const list = path.join(OUT, 'chunks.txt');
  writeFileSync(list, chunks.map((f) => `file '${path.join(dir, f)}'`).join('\n') + '\n');
  ff(
    ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-an', '-movflags', '+faststart', mp4],
    'stitch',
  );
  rmSync(list);
  const got = Number(
    sh(
      'ffprobe',
      [
        '-v',
        'error',
        '-count_packets',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_read_packets',
        '-of',
        'csv=p=0',
        mp4,
      ],
      'ffprobe',
      { capture: true },
    )
      .toString()
      .trim(),
  );
  log(`stitched ${chunks.length} chunks, ${got} frames (expected ${frames})`);
  if (got !== frames) throw new Error(`stitched ${got} frames, expected ${frames}`);
} else {
  render(mp4);
}

const size = (f) => statSync(f).size / 1048576;
const cap = (src, dst, mb, vf) => {
  const kbps = Math.floor((mb * 8 * 1024) / total);
  log(`${path.basename(src)} is ${size(src).toFixed(1)} MB, re-encoding at ${kbps} kbps`);
  const common = [
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-b:v',
    `${kbps}k`,
    '-maxrate',
    `${Math.floor(kbps * 1.3)}k`,
    '-bufsize',
    `${kbps * 2}k`,
    '-an',
  ];
  const v = vf ? ['-vf', vf] : [];
  ff(['-i', src, ...v, ...common, '-pass', '1', '-f', 'mp4', '/dev/null'], 'pass 1');
  ff(
    [
      '-i',
      src,
      ...v,
      ...common,
      '-pass',
      '2',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      dst,
    ],
    'pass 2',
  );
};
const maxMb = full ? Number(process.env.MAX_MB || 56) : 12;
if (size(mp4) > maxMb) {
  const tmp = path.join(OUT, 'tmp-cap.mp4');
  cap(mp4, tmp, maxMb - 2);
  rmSync(mp4);
  execFileSync('mv', [tmp, mp4]);
}

let share = null;
if (SHARE && full) {
  share = path.join(OUT, `${NAME}-720p30.mp4`);
  ff(
    [
      '-i',
      mp4,
      '-vf',
      'scale=1280:720:flags=lanczos',
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '25',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      share,
    ],
    'share 720p',
  );
  if (size(share) > 24) {
    const tmp = path.join(OUT, 'tmp-share.mp4');
    cap(mp4, tmp, 22, 'scale=1280:720:flags=lanczos,fps=30');
    rmSync(share);
    execFileSync('mv', [tmp, share]);
  }
}

// ----------------------------------------------------------------------------- narration (voice-over copies)
// audio/voiceover.mp3 is the narration track laid out on the film timeline by voiceover.mjs. The picture is
// copied, never re-encoded, so the silent and the voice-over file are the same frames.
const VO = path.join(here, 'audio/voiceover.mp3');
const withVoice = (src) => {
  const dst = src.replace(/\.mp4$/, '-voiceover.mp4');
  ff(
    [
      '-i',
      src,
      '-i',
      VO,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-af',
      'apad',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ac',
      '2',
      '-t',
      total.toFixed(3),
      '-movflags',
      '+faststart',
      dst,
    ],
    'voice-over mux',
  );
  return dst;
};
let voiced = null;
let voicedShare = null;
if (full && existsSync(VO)) {
  voiced = withVoice(mp4);
  if (share) voicedShare = withVoice(share);
}

// ----------------------------------------------------------------------------- timeline, SRT, poster, sheets
// The captions are the narration cues (src/captions.json, film seconds), the same lines that are burned in.
const cues = full
  ? JSON.parse(readFileSync(path.join(here, 'src/captions.json'), 'utf8')).cues
  : [];
let cursor = 0;
const timeline = [];
for (const sc of scenes) {
  const caps = cues.filter((c) => c.scene === sc.id).map((c) => ({ a: c.a, b: c.b, text: c.text }));
  timeline.push({ id: sc.id, start: +cursor.toFixed(3), dur: sc.dur, world: sc.world, caps });
  cursor += sc.dur;
}
const tc = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
let n = 0;
const srt = [];
const rows = [];
for (const sc of timeline)
  for (const c of sc.caps) {
    n += 1;
    srt.push(`${n}\n${tc(c.a)} --> ${tc(c.b)}\n${c.text}\n`);
    rows.push(
      `${String(n).padStart(2)}  ${tc(c.a)} --> ${tc(c.b)}  ${(c.b - c.a).toFixed(1)} s  [${sc.id}] ${c.text}`,
    );
    if (c.b - c.a < 0.8)
      warn.push(`caption ${n} [${sc.id}] shows ${(c.b - c.a).toFixed(1)} s (< 0.8 s)`);
  }
writeFileSync(path.join(OUT, `${NAME}.en.srt`), srt.join('\n'));
writeFileSync(
  path.join(OUT, 'timeline.json'),
  JSON.stringify(
    {
      name: NAME,
      fps: FPS,
      width: W,
      height: H,
      duration: +total.toFixed(3),
      bpm: 120,
      beat: 0.5,
      scenes: timeline,
    },
    null,
    2,
  ),
);
const title = timeline.find((s) => s.id === 'title') ?? timeline[0];
ff(
  [
    '-ss',
    ((title?.start ?? 0) + 3.8).toFixed(2),
    '-i',
    mp4,
    '-frames:v',
    '1',
    path.join(OUT, `${NAME}-poster.png`),
  ],
  'poster',
);
ff(
  [
    '-i',
    mp4,
    '-vf',
    'fps=4,scale=320:180,tile=6x5:padding=4:color=0x1d1712',
    '-vsync',
    '0',
    path.join(OUT, 'contact-%02d.png'),
  ],
  'contact',
);

// ----------------------------------------------------------------------------- frame-difference check (no static hold > 1 s)
const grey = sh(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    mp4,
    '-vf',
    'fps=4,scale=96:54',
    '-pix_fmt',
    'gray',
    '-f',
    'rawvideo',
    '-',
  ],
  'diff',
  { capture: true, maxBuffer: 1 << 28 },
);
const F = 96 * 54;
const count = Math.floor(grey.length / F);
const diffs = [];
for (let i = 1; i < count; i += 1) {
  let d = 0;
  const a = i * F;
  const b = (i - 1) * F;
  for (let k = 0; k < F; k += 1) d += Math.abs(grey[a + k] - grey[b + k]);
  diffs.push(d / F / 255);
}
const THRESH = 0.006;
const holds = [];
let run = 0;
for (let i = 0; i < diffs.length; i += 1) {
  if (diffs[i] < THRESH) run += 1;
  else run = 0;
  if (run === 4) holds.push(+((i - 3) / 4).toFixed(2));
}
const sceneAt = (s) => timeline.find((x) => s >= x.start && s < x.start + x.dur)?.id ?? '?';
for (const h of holds) warn.push(`static hold of 1 s or more at ${h.toFixed(2)} s [${sceneAt(h)}]`);
const meanDiff = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);

const report = [
  `${NAME}: duration ${total.toFixed(1)} s, ${FPS} fps, ${W}x${H}${full ? '' : ` (scenes: ${ids.join(', ')})`}`,
  `mp4 ${size(mp4).toFixed(2)} MB${share ? `, share 720p30 ${size(share).toFixed(2)} MB` : ''}`,
  voiced
    ? `voice-over ${size(voiced).toFixed(2)} MB${voicedShare ? `, share 720p30 ${size(voicedShare).toFixed(2)} MB` : ''}`
    : 'voice-over: not built',
  `motion: mean frame difference ${(meanDiff * 100).toFixed(2)} % at 4 fps, static holds (>= 1 s under ${THRESH * 100} %): ${holds.length}`,
  '',
  ...timeline.map(
    (s) => `${tc(s.start)}  ${s.dur.toFixed(1).padStart(5)} s  ${s.world.padEnd(5)}  ${s.id}`,
  ),
  '',
  ...rows,
  '',
  `warnings (${warn.length}):`,
  ...warn.map((w) => '  ' + w),
].join('\n');
writeFileSync(path.join(OUT, 'report.txt'), report + '\n');
console.log(report);
