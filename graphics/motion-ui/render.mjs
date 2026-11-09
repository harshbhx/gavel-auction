// "See it run" GIFs: short clips cut from REAL Playwright recordings of the live app (nothing is mocked).
// Source: the videos artifact of a judge-smoke run against https://gavel.dualmindlab.tech (sandbox demo
// room, simulated holds, the SANDBOX banner is in the app itself). Usage: node graphics/motion-ui/render.mjs <outDir>
// Env: GH_TOKEN, GITHUB_REPOSITORY, UI_RUN (default below). CI only, see graphics.yml.
import { mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const RUN = process.env.UI_RUN || '42561627128';
const out = path.resolve(process.argv[2] ?? 'out/motion-ui');
const src = path.join(out, '.src');
mkdirSync(src, { recursive: true });
execFileSync(
  'gh',
  [
    'run',
    'download',
    RUN,
    '-R',
    process.env.GITHUB_REPOSITORY || 'harshbhx/gavel-auction',
    '-n',
    'judge-smoke-desktop',
    '-D',
    src,
  ],
  { stdio: 'inherit' },
);
const vid = (n) => path.join(src, 'videos', `desktop-${n}.webm`);

// [file, video, start s, source length s, speed-up, what it shows]. Waiting is cut by playing faster.
const CLIPS = [
  [
    'see-it-run-1-start-room',
    'host',
    16.0,
    4,
    1,
    'Start a demo room: the hub with the room code and QR',
  ],
  ['see-it-run-2-hold', 'bidderA', 97, 8, 1.6, 'A bidder approves a hold (demo hold, simulated)'],
  ['see-it-run-3-bids', 'bidderA', 265, 8, 1.5, 'Bids from two bidders: leading, then outbid'],
  ['see-it-run-4-hammer', 'console', 56, 7, 1.4, 'The auctioneer console: hold to hammer'],
  [
    'see-it-run-5-sold',
    'screen',
    62,
    8,
    1.5,
    'The big screen: sold, the winner captured and the other hold released',
  ],
  ['see-it-run-6-receipt', 'bidderA', 305.5, 6, 1.2, 'The receipt, with a share link and QR'],
];
const FPS = 20;
const LIMIT = 2.2 * 1024 * 1024;
const report = [];
for (const [name, v, ss, t, speed, what] of CLIPS) {
  const gif = path.join(out, `${name}.gif`);
  let size = 0;
  for (const [colors, lossy, width] of [
    [128, 30, 960],
    [96, 60, 960],
    [64, 90, 900],
    [48, 120, 800],
  ]) {
    const vf = `setpts=PTS/${speed},fps=${FPS},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(ss),
      '-t',
      String(t),
      '-i',
      vid(v),
      '-vf',
      vf,
      '-loop',
      '0',
      gif,
    ]);
    try {
      execFileSync('gifsicle', ['-O3', `--lossy=${lossy}`, '-b', gif]);
    } catch {
      /* optional */
    }
    size = statSync(gif).size;
    if (size <= LIMIT) break;
  }
  // MP4 and WebM of the same clip (WhatsApp and most chats show a GIF as a still, an MP4 plays).
  const clip = [
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(ss),
    '-t',
    String(t),
    '-i',
    vid(v),
    '-an',
    '-vf',
    `setpts=PTS/${speed},scale=960:-2,fps=30`,
  ];
  execFileSync('ffmpeg', [
    ...clip,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '26',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    path.join(out, `${name}.mp4`),
  ]);
  execFileSync('ffmpeg', [
    ...clip,
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '38',
    '-pix_fmt',
    'yuv420p',
    path.join(out, `${name}.webm`),
  ]);
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(ss + t * 0.6),
    '-i',
    vid(v),
    '-frames:v',
    '1',
    '-vf',
    'scale=960:-1',
    path.join(out, `${name}.png`),
  ]);
  report.push(
    `${name}: mp4 ${statSync(path.join(out, name + '.mp4')).size} webm ${statSync(path.join(out, name + '.webm')).size}; ${name}.gif ${size} bytes, ${Math.round((t / speed) * FPS)} frames at ${FPS} fps, ${t} s of source at ${speed}x from ${v} at ${ss} s: ${what}`,
  );
}
writeFileSync(path.join(out, 'report.txt'), `source run ${RUN}\n` + report.join('\n') + '\n');
console.log(report.join('\n'));
console.log(readdirSync(out).join(' '));
