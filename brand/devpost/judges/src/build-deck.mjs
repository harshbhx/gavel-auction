// Builds the GAVEL judge deck (16:9) with pptxgenjs from the assets that assets.py rendered.
// Writes OUT/deck-raw.pptx and OUT/motion.json (per slide: the transition and the build order).
// finalize.py then writes the theme colours and the transitions and animations into the slides.
// Usage: node build-deck.mjs OUT_DIR   (pptxgenjs is resolved from DECK_DEPS, a node_modules parent)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const out = resolve(process.argv[2] ?? join(here, '../.build'));
const require = createRequire(join(process.env.DECK_DEPS ?? here, 'package.json'));
const PptxGenJS = require('pptxgenjs');

const A = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
const GIF = (name) => join(repo, 'brand/archive/see-it-run', name);

// Brand tokens (packages/web/src/design/tokens.css): ink, paper, orange.
const K = {
  ink: '1D1712',
  ink2: '2A231D',
  line: '3D342B',
  paper: 'EFE6D3',
  paper2: 'F7F1E4',
  rule: 'D8CCB5',
  orange: 'FF6A1F',
  mutedDark: 'A89C8A',
  mutedPaper: '6B5F52',
};
const FONT = 'Arial';
const MONO = 'Consolas';
const LINKS = {
  try: 'https://gavel.dualmindlab.tech/try',
  scripted: 'https://gavel.dualmindlab.tech/demo/scripted',
  docs: 'https://docs.gavel.dualmindlab.tech',
  api: 'https://docs.gavel.dualmindlab.tech/api-reference',
  source: 'https://github.com/harshbhx/gavel-auction',
  harsh: 'https://github.com/harshbhx',
  dhairya: 'https://github.com/DhairyaPatel-Devloper',
};

const pres = new PptxGenJS();
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
pres.title = 'GAVEL: every bid is a hold, the hammer is the payment';
pres.subject = 'PayPal Hackathon 2026 judge deck';
pres.author = 'Harsh Bhanushali and Dhairya Patel';
pres.company = 'GAVEL';
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

for (const [name, bg, muted] of [
  ['GAVEL_DARK', K.ink, K.mutedDark],
  ['GAVEL_PAPER', K.paper, K.mutedPaper],
]) {
  pres.defineSlideMaster({
    title: name,
    background: { color: bg },
    objects: [
      {
        placeholder: {
          options: {
            name: 'title',
            type: 'title',
            x: 0.6,
            y: 0.36,
            w: 10.5,
            h: 0.44,
            fontFace: FONT,
            fontSize: 11,
            bold: true,
            color: muted,
            charSpacing: 3,
            margin: 0,
            align: 'left',
            valign: 'middle',
          },
          text: '',
        },
      },
      {
        text: {
          text: 'PAYPAL SANDBOX ONLY. NO REAL MONEY MOVES.',
          options: {
            x: 0.6,
            y: 6.98,
            w: 6.5,
            h: 0.26,
            fontFace: FONT,
            fontSize: 9,
            bold: true,
            color: muted,
            charSpacing: 2,
            margin: 0,
            valign: 'middle',
          },
        },
      },
    ],
  });
}

const motion = [];
let current;

function newSlide(layout, kicker, transition) {
  const dark = layout === 'dark';
  const slide = pres.addSlide({ masterName: dark ? 'GAVEL_DARK' : 'GAVEL_PAPER' });
  const accent = dark ? K.orange : K.ink;
  const [lot, label] = kicker;
  slide.addText(
    [
      { text: `${lot}   `, options: { color: accent } },
      { text: label, options: { color: dark ? K.mutedDark : K.mutedPaper } },
    ],
    { placeholder: 'title' },
  );
  current = { slide, dark, anims: [], transition };
  motion.push(current);
  return current;
}

// Effects: fade, float (rise and fade), wipe (dir), zoom (from scale), wheel, path, exitFade, exitRight.
// start: 'after' the previous effect, or 'with' it (plus delay). Times in ms.
function fx(name, effect, opts = {}) {
  current.anims.push({ name, fx: effect, start: 'after', dur: 500, delay: 0, ...opts });
}

function cornerMark(s) {
  s.slide.addImage({
    path: A[s.dark ? 'mark_dark' : 'mark_paper'].file,
    x: 12.3,
    y: 0.36,
    w: 0.44,
    h: 0.44,
    altText: 'GAVEL logo mark',
    objectName: '!!mark',
  });
}

// A display-type image placed by the top of its capitals.
function disp(s, key, x, capY, name, scale = 1) {
  const a = A[key];
  const box = { x, y: capY - a.cap * scale, w: a.w * scale, h: a.h * scale };
  s.slide.addImage({ path: a.file, ...box, altText: a.text, objectName: name });
  return box;
}

function text(s, name, runs, box, opts = {}) {
  const color = s.dark ? K.paper : K.ink;
  s.slide.addText(runs, {
    ...box,
    fontFace: FONT,
    fontSize: 16,
    color,
    margin: 0,
    valign: 'top',
    isTextBox: true,
    objectName: name,
    ...opts,
  });
}

function label(s, name, str, box, opts = {}) {
  text(s, name, str, box, {
    fontSize: 11,
    bold: true,
    charSpacing: 3,
    color: s.dark ? K.mutedDark : K.mutedPaper,
    valign: 'middle',
    ...opts,
  });
}

function rect(s, name, box, opts = {}) {
  s.slide.addShape(pres.shapes.RECTANGLE, { ...box, objectName: name, ...opts });
}

function oval(s, name, cx, cy, d, line, opts = {}) {
  s.slide.addShape(pres.shapes.OVAL, {
    x: cx - d / 2,
    y: cy - d / 2,
    w: d,
    h: d,
    line,
    objectName: name,
    ...opts,
  });
}

const hardShadow = () => ({
  type: 'outer',
  color: K.ink,
  blur: 0.01,
  offset: 5,
  angle: 45,
  opacity: 1,
});

function rings(s, cx, cy, fades) {
  [1.75, 2.45, 3.2].forEach((r, i) => {
    oval(s, `!!ring${i + 1}`, cx, cy, r * 2, {
      color: K.orange,
      width: 1.5,
      transparency: fades[i],
    });
  });
}

// ---------------------------------------------------------------------------------------------
// 1. Cover
{
  const s = newSlide('dark', [
    'GAVEL',
    'PAYPAL HACKATHON 2026   /   HARSH BHANUSHALI + DHAIRYA PATEL',
  ]);
  rings(s, 10.35, 3.85, [0, 45, 70]);
  s.slide.addImage({
    path: A.mark_dark.file,
    x: 9.05,
    y: 2.55,
    w: 2.6,
    h: 2.6,
    altText: 'GAVEL logo mark',
    objectName: '!!mark',
  });
  disp(s, 'hero_l1', 0.6, 1.5, 'hero-l1');
  const l2 = disp(s, 'hero_l2a', 0.6, 3.22, 'hero-l2a');
  disp(s, 'hero_l2b', l2.x + l2.w + 0.42, 3.22, 'hero-l2b');
  disp(s, 'hero_tag', 0.62, 5.0, 'hero-tag');
  text(
    s,
    'hero-body',
    'A live auction on PayPal authorization holds. The winner pays the hammer price, and every other hold is released.',
    { x: 0.62, y: 5.68, w: 6.6, h: 0.75 },
    { fontSize: 17, color: K.mutedDark },
  );
  fx('!!ring3', 'zoom', { from: 0.4, dur: 800 });
  fx('!!ring2', 'zoom', { from: 0.4, dur: 800, start: 'with', delay: 120 });
  fx('!!ring1', 'zoom', { from: 0.4, dur: 800, start: 'with', delay: 240 });
  fx('!!mark', 'zoom', { from: 0.15, dur: 700, start: 'with', delay: 200, rotate: -60 });
  fx('hero-l1', 'float', { dur: 600, delay: 100 });
  fx('hero-l2a', 'float', { dur: 600, start: 'with', delay: 150 });
  fx('hero-l2b', 'zoom', { from: 1.6, dur: 450 });
  fx('hero-tag', 'fade', { dur: 500 });
  fx('hero-body', 'fade', { dur: 600, start: 'with', delay: 250 });
  s.slide.addNotes(
    [
      'GAVEL is a live auction where every bid is a PayPal authorization hold.',
      'A bidder approves a ceiling once; it is held, not charged. When the hammer falls, GAVEL captures only the winning price and releases every other hold.',
      'Built for the PayPal Hackathon 2026 by Harsh Bhanushali and Dhairya Patel. Everything runs in the PayPal sandbox; no real money moves.',
      `Live app: ${LINKS.try}`,
    ].join('\n\n'),
  );
}

// 2. Hook
{
  const s = newSlide('dark', ['LOT 01', 'A CHARITY NIGHT'], 'morph');
  rings(s, 2.75, 2.85, [84, 89, 94]);
  cornerMark(s);
  label(s, 'hook-label', 'A SIGNED PRINT. THE AUCTIONEER CALLS', { x: 0.6, y: 1.05, w: 6, h: 0.3 });
  disp(s, 'hook_200', 0.55, 1.72, 'hook-200');
  const lines = [
    ['Her card would be charged the moment she bids. ', 'Her paddle goes back down.'],
    ['Across the room, a man bids $400, wins, and ', 'is never heard from again.'],
    ['The organizer chases an invoice for a week. ', 'The only record is a paper sheet.'],
  ];
  lines.forEach(([a, b], i) => {
    text(
      s,
      `hook-line${i + 1}`,
      [{ text: a }, { text: b, options: { color: K.orange, bold: true } }],
      { x: 0.6, y: 4.5 + i * 0.72, w: 6.6, h: 0.64 },
      { fontSize: 18 },
    );
  });
  s.slide.addImage({
    path: A.paddle_23.file,
    x: 7.75,
    y: 2.25,
    w: 1.6,
    h: 3.0,
    altText: A.paddle_23.text,
    objectName: 'paddle-23',
  });
  s.slide.addImage({
    path: A.paddle_41.file,
    x: 10.55,
    y: 2.25,
    w: 1.6,
    h: 3.0,
    altText: A.paddle_41.text,
    objectName: 'paddle-41',
  });
  disp(s, 'hook_400', 10.66, 1.35, 'hook-400');
  fx('hook-label', 'fade', { dur: 400, delay: 200 });
  fx('hook-200', 'zoom', { from: 0.85, dur: 600 });
  fx('paddle-23', 'float', { dur: 600, rise: 0.08 });
  fx('hook-line1', 'fade', { dur: 500, start: 'with', delay: 300 });
  fx('paddle-23', 'path', {
    dur: 900,
    delay: 500,
    path: [
      [0, 0],
      [0, 0.1],
    ],
  });
  fx('paddle-23', 'exitFade', { dur: 500, start: 'with', delay: 450 });
  fx('paddle-41', 'float', { dur: 600, rise: 0.08 });
  fx('hook-400', 'zoom', { from: 0.6, dur: 400, start: 'with', delay: 350 });
  fx('hook-line2', 'fade', { dur: 500, start: 'with', delay: 350 });
  fx('paddle-41', 'exitRight', { dur: 800, delay: 700 });
  fx('hook-400', 'exitRight', { dur: 800, start: 'with' });
  fx('hook-line3', 'fade', { dur: 500, delay: 100 });
  s.slide.addNotes(
    [
      'Picture a charity night. The auctioneer calls 200 dollars for a signed print.',
      'A woman near the back has her hand half raised, and she lowers it: her card would be charged the moment she bids.',
      'Across the room, a man bids 400 with a grin, wins, and is never heard from again. The organizer spends a week chasing an invoice, with a paper sheet as the only record.',
      'Source: the Inspiration section of brand/devpost/DESCRIPTION.md.',
    ].join('\n\n'),
  );
}

// 3. Problem
{
  const s = newSlide('paper', ['LOT 02', 'THE PROBLEM'], 'fade');
  cornerMark(s);
  disp(s, 'prob_h', 0.6, 1.1, 'prob-h');
  const cols = [
    [
      'icon_card',
      'prob_w1',
      'Bidders hold back. Nobody wants a charge for a lot they may not win.',
    ],
    ['icon_door', 'prob_w2', 'Winners walk away, and the organizer chases the money for days.'],
    ['icon_sheet', 'prob_w3', 'Nothing anyone can check once the night is over.'],
  ];
  cols.forEach(([icon, word, body], i) => {
    const x = 0.6 + i * 4.09;
    s.slide.addImage({
      path: A[icon].file,
      x,
      y: 3.15,
      w: 0.95,
      h: 0.95,
      altText: A[icon].text,
      objectName: `prob-icon${i + 1}`,
    });
    disp(s, word, x, 4.45, `prob-word${i + 1}`);
    text(s, `prob-body${i + 1}`, body, { x, y: 5.08, w: 3.6, h: 1.1 }, { fontSize: 17 });
  });
  fx('prob-h', 'float', { dur: 600, delay: 150 });
  cols.forEach((_, i) => {
    fx(`prob-icon${i + 1}`, 'zoom', {
      from: 0.3,
      dur: 450,
      start: i === 0 ? 'after' : 'with',
      delay: i * 450,
    });
    fx(`prob-word${i + 1}`, 'float', { dur: 500, start: 'with', delay: i * 450 + 120 });
    fx(`prob-body${i + 1}`, 'fade', { dur: 500, start: 'with', delay: i * 450 + 260 });
  });
  s.slide.addNotes(
    [
      'Online auctions usually make a bidder pay first, or trust the bidder to pay later.',
      'Charging first makes people hold back. Trusting them later means winners can walk away. And a paper sheet gives nobody a record they can check.',
    ].join('\n\n'),
  );
}

// 4. The idea
{
  const s = newSlide('dark', ['LOT 03', 'THE IDEA'], 'fade');
  cornerMark(s);
  disp(s, 'idea_h', 0.6, 1.1, 'idea-h');
  text(
    s,
    'idea-sub',
    'PayPal already has the shape of an auction: authorize an amount now, capture it later.',
    { x: 0.6, y: 2.32, w: 11.5, h: 0.45 },
    { fontSize: 18, color: K.mutedDark },
  );
  const verb = (v, rest) => [
    { text: v, options: { bold: true, color: K.orange, charSpacing: 2 } },
    { text: `   ${rest}` },
  ];
  text(
    s,
    'idea-a-label',
    verb('AUTHORIZE', 'The bidder approves a ceiling. It is held, not charged.'),
    {
      x: 0.6,
      y: 3.0,
      w: 9,
      h: 0.36,
    },
  );
  s.slide.addImage({
    path: A.hatch.file,
    x: 0.6,
    y: 3.48,
    w: 9.0,
    h: 0.62,
    altText: A.hatch.text,
    objectName: 'idea-hatch',
  });
  disp(s, 'idea_500', 9.95, 3.5, 'idea-500');
  label(s, 'idea-held', 'HELD', { x: 11.3, y: 3.5, w: 1.3, h: 0.5 });
  text(s, 'idea-b-label', verb('CAPTURE', 'The hammer falls at $350. Only that is taken.'), {
    x: 0.6,
    y: 4.42,
    w: 9,
    h: 0.36,
  });
  rect(
    s,
    'idea-outline',
    { x: 0.6, y: 4.9, w: 9.0, h: 0.62 },
    {
      line: { color: K.mutedDark, width: 1.25, dashType: 'dash' },
    },
  );
  rect(s, 'idea-capture', { x: 0.6, y: 4.9, w: 6.3, h: 0.62 }, { fill: { color: K.orange } });
  label(
    s,
    'idea-released',
    '$150 RELEASED',
    { x: 6.9, y: 4.9, w: 2.7, h: 0.62 },
    {
      align: 'center',
      color: K.paper,
    },
  );
  disp(s, 'idea_350', 9.95, 4.92, 'idea-350');
  label(s, 'idea-captured', 'CAPTURED', { x: 11.3, y: 4.92, w: 1.4, h: 0.5 });
  text(
    s,
    'idea-c',
    verb('VOID', "Every other bidder's hold is released. Nobody pays for a lot they lost."),
    {
      x: 0.6,
      y: 5.95,
      w: 11.5,
      h: 0.4,
    },
  );
  fx('idea-h', 'float', { dur: 600, delay: 150 });
  fx('idea-sub', 'fade', { dur: 500, start: 'with', delay: 300 });
  fx('idea-a-label', 'fade', { dur: 400 });
  fx('idea-hatch', 'wipe', { dir: 'left', dur: 900, start: 'with', delay: 150 });
  fx('idea-500', 'fade', { dur: 400 });
  fx('idea-held', 'fade', { dur: 400, start: 'with', delay: 100 });
  fx('idea-b-label', 'fade', { dur: 400, delay: 200 });
  fx('idea-outline', 'fade', { dur: 400, start: 'with', delay: 100 });
  fx('idea-capture', 'wipe', { dir: 'left', dur: 900 });
  fx('idea-released', 'fade', { dur: 500 });
  fx('idea-350', 'fade', { dur: 400, start: 'with' });
  fx('idea-captured', 'fade', { dur: 400, start: 'with', delay: 100 });
  fx('idea-c', 'fade', { dur: 500, delay: 150 });
  s.slide.addNotes(
    [
      'A PayPal authorization holds an amount, and a capture takes it later. That is the shape of an auction.',
      'The bidder approves a ceiling as a hold. At the hammer GAVEL captures only the winning price with final_capture, and every other hold is voided.',
      'The numbers on this slide are the real G1 gate run on the PayPal sandbox: authorize 500.00, capture 350.00 with final_capture; the 150.00 remainder is released (a later void answers 422 PREVIOUSLY_CAPTURED, so the release is inferred, not read from a buyer balance).',
      'PayPal APIs: Orders v2 with intent AUTHORIZE, Payments v2 capture, void and reauthorize, JS SDK v6, signature-verified webhooks.',
      'Source: docs/GATES.md (G1).',
    ].join('\n\n'),
  );
}

// 5. How it works
{
  const s = newSlide('paper', ['LOT 04', 'HOW IT WORKS'], 'fade');
  cornerMark(s);
  disp(s, 'how_h', 0.6, 1.1, 'how-h');
  const trackY = 2.95;
  s.slide.addShape(pres.shapes.LINE, {
    x: 0.78,
    y: trackY,
    w: 11.75,
    h: 0,
    line: { color: K.ink, width: 1.5 },
    objectName: 'how-track',
  });
  const steps = [
    ['how_w1', 'The bidder approves a ceiling. Held, not charged.'],
    ['how_w2', 'Tap, scan or speak. A bid above the ceiling is refused.'],
    ['how_w3', 'Capture the winning price. Void every other hold.'],
    ['how_w4', 'Every accepted bid sits in a hash-chained ledger anyone can check.'],
  ];
  const colX = (i) => 0.6 + i * 3.08;
  steps.forEach(([word, body], i) => {
    const x = colX(i);
    oval(
      s,
      `how-node${i + 1}`,
      x + 0.18,
      trackY,
      0.36,
      { color: K.ink, width: 2 },
      {
        fill: { color: K.paper },
      },
    );
    label(s, `how-num${i + 1}`, `0${i + 1}`, { x, y: 3.38, w: 1, h: 0.3 });
    disp(s, word, x, 3.9, `how-word${i + 1}`);
    text(s, `how-body${i + 1}`, body, { x, y: 4.75, w: 2.78, h: 1.4 }, { fontSize: 17 });
  });
  oval(s, 'how-packet', colX(0) + 0.18, trackY, 0.24, undefined, { fill: { color: K.orange } });
  fx('how-h', 'float', { dur: 600, delay: 150 });
  fx('how-track', 'wipe', { dir: 'left', dur: 800 });
  steps.forEach((_, i) => {
    if (i === 0) fx('how-packet', 'zoom', { from: 0.2, dur: 350 });
    else
      fx('how-packet', 'path', {
        dur: 550,
        delay: 150,
        path: [
          [(colX(i - 1) - colX(0)) / 13.333, 0],
          [(colX(i) - colX(0)) / 13.333, 0],
        ],
      });
    fx(`how-node${i + 1}`, 'zoom', {
      from: 0.4,
      dur: 350,
      start: 'with',
      delay: i === 0 ? 0 : 400,
    });
    fx(`how-num${i + 1}`, 'fade', { dur: 350, start: 'with', delay: i === 0 ? 100 : 450 });
    fx(`how-word${i + 1}`, 'float', { dur: 450, start: 'with', delay: i === 0 ? 150 : 500 });
    fx(`how-body${i + 1}`, 'fade', { dur: 450, start: 'with', delay: i === 0 ? 300 : 650 });
  });
  s.slide.addNotes(
    [
      'Four moves, and the money rule never changes.',
      'Hold: the bidder approves a ceiling as a PayPal authorization. Bid: bids come from phones, a QR code, the console or the auctioneer microphone; a deterministic engine refuses any bid above the ceiling. Hammer: the settlement saga captures the winning price and voids every other hold, journalling each step so a crash cannot double-charge. Receipt: every accepted bid sits in a hash-chained ledger anyone can re-check.',
    ].join('\n\n'),
  );
}

// 6. How it feels: the bidder
{
  const s = newSlide('dark', ['LOT 05', 'HOW IT FEELS'], 'fade');
  cornerMark(s);
  disp(s, 'feel_h', 0.6, 1.1, 'feel-h');
  const shots = [
    [
      'see-it-run-2-hold.gif',
      'Recording of the live app: choose a ceiling, press and hold to approve the PayPal hold, then the hold is in place',
      '01   HOLD',
      'Press and hold to approve the PayPal hold. Held, not charged.',
    ],
    [
      'see-it-run-3-bids.gif',
      'Recording of the live app: the bidder phone bids, turns green while leading and red when outbid',
      '02   BID',
      'One tap per bid. Green while you lead, red when you are outbid.',
    ],
  ];
  shots.forEach(([file, alt, head, body], i) => {
    const x = 0.6 + i * 6.33;
    s.slide.addImage({
      path: GIF(file),
      x,
      y: 2.15,
      w: 5.8,
      h: 3.625,
      altText: alt,
      objectName: `feel-shot${i + 1}`,
    });
    text(
      s,
      `feel-cap${i + 1}`,
      [
        {
          text: head,
          options: { bold: true, color: K.orange, fontSize: 11, charSpacing: 3, breakLine: true },
        },
        { text: body, options: { fontSize: 16 } },
      ],
      { x, y: 5.98, w: 5.8, h: 0.78 },
      { paraSpaceAfter: 4 },
    );
  });
  label(
    s,
    'feel-note',
    'SCREEN RECORDINGS OF THE LIVE APP',
    { x: 7.2, y: 6.98, w: 5.53, h: 0.26 },
    {
      fontSize: 9,
      charSpacing: 2,
      align: 'right',
    },
  );
  fx('feel-h', 'float', { dur: 600, delay: 150 });
  fx('feel-shot1', 'float', { dur: 700, rise: 0.05 });
  fx('feel-cap1', 'fade', { dur: 450, start: 'with', delay: 350 });
  fx('feel-shot2', 'float', { dur: 700, rise: 0.05, start: 'with', delay: 450 });
  fx('feel-cap2', 'fade', { dur: 450, start: 'with', delay: 800 });
  fx('feel-note', 'fade', { dur: 400 });
  s.slide.addNotes(
    [
      'This is the bidder side, recorded from the live app in a sandbox demo room.',
      'Left: the bidder picks a ceiling and presses and holds for three seconds to approve the PayPal hold. Held, not charged.',
      'Right: the bid screen. One tap per bid; the screen turns green while you lead and red when you are outbid, and a bid above your ceiling is refused.',
    ].join('\n\n'),
  );
}

// 7. Voice
{
  const s = newSlide('paper', ['LOT 06', 'VOICE BIDDING'], 'fade');
  cornerMark(s);
  disp(s, 'voice_h', 0.6, 1.1, 'voice-h');
  s.slide.addImage({
    path: A.wave.file,
    x: 0.6,
    y: 2.3,
    w: 5.8,
    h: 1.3,
    altText: A.wave.text,
    objectName: 'voice-wave',
  });
  text(
    s,
    'voice-said',
    `${String.fromCodePoint(0x201c)}Three fifty for paddle twelve.${String.fromCodePoint(0x201d)}`,
    { x: 0.6, y: 3.9, w: 6.2, h: 0.55 },
    {
      fontSize: 26,
      italic: true,
    },
  );
  const chip = (name, x, w, k, v) =>
    text(
      s,
      name,
      [
        { text: `${k}   `, options: { color: K.mutedPaper } },
        { text: v, options: { color: K.ink } },
      ],
      { x, y: 4.75, w, h: 0.55 },
      {
        fontSize: 13,
        bold: true,
        charSpacing: 2,
        align: 'center',
        valign: 'middle',
        fill: { color: K.paper2 },
        line: { color: K.ink, width: 1.25 },
      },
    );
  chip('voice-chip1', 0.6, 2.5, 'AMOUNT', '350.00');
  chip('voice-chip2', 3.3, 2.1, 'PADDLE', '12');
  rect(
    s,
    'voice-card',
    { x: 7.35, y: 2.3, w: 5.35, h: 3.0 },
    {
      fill: { color: K.paper2 },
      line: { color: K.ink, width: 1.5 },
      shadow: hardShadow(),
    },
  );
  label(s, 'voice-card-label', 'CONFIRM BEFORE IT COUNTS', { x: 7.7, y: 2.55, w: 4.6, h: 0.3 });
  disp(s, 'voice_q', 7.7, 3.12, 'voice-q');
  text(
    s,
    'voice-confirm',
    'CONFIRM',
    { x: 7.7, y: 4.45, w: 1.9, h: 0.55 },
    {
      fontSize: 13,
      bold: true,
      charSpacing: 2,
      align: 'center',
      valign: 'middle',
      fill: { color: K.orange },
      line: { color: K.ink, width: 1.25 },
    },
  );
  text(
    s,
    'voice-cancel',
    'CANCEL',
    { x: 9.8, y: 4.45, w: 1.6, h: 0.55 },
    {
      fontSize: 13,
      bold: true,
      charSpacing: 2,
      align: 'center',
      valign: 'middle',
      line: { color: K.ink, width: 1.25 },
    },
  );
  text(
    s,
    'voice-foot',
    'Deepgram nova-3 transcribes, with Groq whisper-large-v3-turbo as failover. A rule-based parser and the auction rules decide, so the model never picks a winner or moves money. Accuracy is measured on synthetic clips only.',
    { x: 0.6, y: 5.82, w: 12.1, h: 0.85 },
    { fontSize: 15, color: K.mutedPaper },
  );
  fx('voice-h', 'float', { dur: 600, delay: 150 });
  fx('voice-wave', 'wipe', { dir: 'left', dur: 1400 });
  fx('voice-said', 'fade', { dur: 500, start: 'with', delay: 700 });
  fx('voice-chip1', 'zoom', { from: 0.6, dur: 350 });
  fx('voice-chip2', 'zoom', { from: 0.6, dur: 350, start: 'with', delay: 150 });
  for (const n of ['voice-card', 'voice-card-label', 'voice-q', 'voice-confirm', 'voice-cancel']) {
    fx(n, 'float', {
      dur: 600,
      rise: 0.04,
      start: n === 'voice-card' ? 'after' : 'with',
      delay: n === 'voice-card' ? 150 : 0,
    });
  }
  fx('voice-confirm', 'pulse', { dur: 600, delay: 150 });
  fx('voice-foot', 'fade', { dur: 500, start: 'with', delay: 200 });
  s.slide.addNotes(
    [
      'The auctioneer can speak a bid into the console microphone.',
      'Audio goes to Deepgram nova-3, with Groq whisper-large-v3-turbo as failover. A rule-based parser turns the transcript into a structured bid and a deterministic validator checks it against the auction rules. Every spoken bid waits for a confirm: "Did you mean 350 for paddle 12?"',
      'Honest scope: gate G5 is PARTIAL. Accuracy is measured on synthetic clips only; on a held-out noisy set of 120 synthetic clips, wrong accept was 0.058 (Groq) and 0.092 (Deepgram) against a 0.05 limit, which is why the confirm step stays. The microphone works when the server has a speech provider; a judge can also bid by tap, QR or typed entry.',
    ].join('\n\n'),
  );
}

// 8. Hammer
{
  const s = newSlide('dark', ['LOT 07', 'THE HAMMER'], 'fade');
  cornerMark(s);
  disp(s, 'ham_h', 0.6, 1.1, 'ham-h');
  s.slide.addImage({
    path: GIF('see-it-run-4-hammer.gif'),
    x: 0.6,
    y: 2.15,
    w: 6.4,
    h: 4.0,
    altText:
      'Recording of the live app console: open the lot, take bids, then confirm the hammer by holding the button',
    objectName: 'ham-shot',
  });
  const cx = 10.15;
  const cy = 3.7;
  oval(s, 'ham-shock2', cx, cy, 4.5, { color: K.orange, width: 1.25, transparency: 72 });
  oval(s, 'ham-shock1', cx, cy, 3.8, { color: K.orange, width: 1.5, transparency: 45 });
  oval(s, 'ham-track', cx, cy, 3.1, { color: K.line, width: 10 });
  oval(s, 'ham-ring', cx, cy, 3.1, { color: K.orange, width: 10 });
  const sold = A.ham_sold;
  s.slide.addImage({
    path: sold.file,
    x: cx - sold.w / 2,
    y: cy - sold.h / 2,
    w: sold.w,
    h: sold.h,
    altText: sold.text,
    objectName: 'ham-sold',
  });
  text(
    s,
    'ham-cap',
    'Press and hold for three seconds. GAVEL captures the winning price and voids every other hold.',
    { x: 7.75, y: 6.12, w: 4.95, h: 0.75 },
    { fontSize: 15, color: K.mutedDark },
  );
  label(
    s,
    'ham-note',
    'SCREEN RECORDING OF THE LIVE CONSOLE',
    { x: 0.6, y: 6.3, w: 6.4, h: 0.26 },
    {
      fontSize: 9,
      charSpacing: 2,
    },
  );
  fx('ham-h', 'float', { dur: 600, delay: 150 });
  fx('ham-shot', 'float', { dur: 700, rise: 0.05 });
  fx('ham-note', 'fade', { dur: 400, start: 'with', delay: 400 });
  fx('ham-track', 'fade', { dur: 400, start: 'with', delay: 300 });
  fx('ham-ring', 'wheel', { dur: 1800 });
  fx('ham-sold', 'zoom', { from: 1.7, dur: 400 });
  fx('ham-shock1', 'zoom', { from: 0.8, dur: 500, start: 'with', delay: 80 });
  fx('ham-shock2', 'zoom', { from: 0.8, dur: 600, start: 'with', delay: 200 });
  fx('ham-cap', 'fade', { dur: 500, delay: 100 });
  s.slide.addNotes(
    [
      'The auctioneer closes the lot by pressing and holding the hammer for three seconds, so a stray tap cannot sell a lot.',
      'At the hammer GAVEL captures only the winning price from the winner hold, with final_capture, and voids every other hold. The settlement saga writes a journal: if the process dies mid-settlement it asks PayPal what is true and continues instead of repeating, and an unknown answer stops for review.',
      'The left side is a screen recording of the live console in a sandbox demo room.',
    ].join('\n\n'),
  );
}

// 9. Receipt and verify
{
  const s = newSlide('paper', ['LOT 08', 'RECEIPT AND VERIFY'], 'fade');
  cornerMark(s);
  disp(s, 'ver_h', 0.6, 1.1, 'ver-h');
  text(
    s,
    'ver-sub',
    'Every accepted bid is hashed with the one before it. Anyone can re-check the public export in a browser.',
    { x: 0.6, y: 2.0, w: 12, h: 0.45 },
    { fontSize: 18 },
  );
  const chain = [
    ['ver_e1', 'a41f90c2', 'PREV   START'],
    ['ver_e2', '7be3d518', 'PREV   A41F'],
    ['ver_e3', '55e0c1aa', 'PREV   7BE3'],
    ['ver_e4', '1d6fa8b3', 'PREV   55E0'],
  ];
  const cw = 2.62;
  const cardX = (i) => 0.6 + i * 3.17;
  chain.forEach(([ev, hash, prev], i) => {
    const x = cardX(i);
    const y = 2.85;
    rect(
      s,
      `ver-card${i + 1}`,
      { x, y, w: cw, h: 2.05 },
      {
        fill: { color: K.paper2 },
        line: { color: K.ink, width: 1.5 },
        shadow: hardShadow(),
      },
    );
    label(s, `ver-idx${i + 1}`, `0${i + 1}`, { x: x + 0.25, y: y + 0.18, w: 1, h: 0.28 });
    disp(s, ev, x + 0.25, y + 0.66, `ver-ev${i + 1}`);
    text(
      s,
      `ver-hash${i + 1}`,
      hash,
      { x: x + 0.25, y: y + 1.17, w: 2.1, h: 0.36 },
      {
        fontFace: MONO,
        fontSize: 17,
      },
    );
    label(
      s,
      `ver-prev${i + 1}`,
      prev,
      { x: x + 0.25, y: y + 1.58, w: 2.1, h: 0.26 },
      { fontSize: 10 },
    );
    if (i < 3) {
      s.slide.addShape(pres.shapes.LINE, {
        x: x + cw + 0.08,
        y: y + 1.02,
        w: 3.17 - cw - 0.16,
        h: 0,
        line: { color: K.orange, width: 2.5, endArrowType: 'triangle' },
        objectName: `ver-link${i + 1}`,
      });
    }
  });
  text(
    s,
    'ver-stamp',
    'CHAIN VERIFIES',
    { x: 0.6, y: 5.42, w: 3.1, h: 0.62 },
    {
      fontSize: 15,
      bold: true,
      charSpacing: 3,
      color: K.paper,
      align: 'center',
      valign: 'middle',
      fill: { color: K.ink },
    },
  );
  text(
    s,
    'ver-aside',
    'Change one amount and every later link breaks. An edited entry is marked as edited, never hidden.',
    { x: 4.05, y: 5.42, w: 8.6, h: 0.7 },
    { fontSize: 17, valign: 'middle' },
  );
  label(
    s,
    'ver-note',
    'HASHES SHORTENED FOR THE SLIDE',
    { x: 7.2, y: 6.98, w: 5.53, h: 0.26 },
    {
      fontSize: 9,
      charSpacing: 2,
      align: 'right',
    },
  );
  fx('ver-h', 'float', { dur: 600, delay: 150 });
  fx('ver-sub', 'fade', { dur: 500, start: 'with', delay: 300 });
  chain.forEach((_, i) => {
    const parts = ['card', 'idx', 'ev', 'hash', 'prev'];
    parts.forEach((p, j) => {
      fx(`ver-${p}${i + 1}`, 'float', { dur: 450, rise: 0.04, start: j === 0 ? 'after' : 'with' });
    });
    if (i < 3) fx(`ver-link${i + 1}`, 'wipe', { dir: 'left', dur: 300 });
  });
  fx('ver-stamp', 'zoom', { from: 1.6, dur: 400, delay: 150 });
  fx('ver-aside', 'fade', { dur: 500 });
  fx('ver-note', 'fade', { dur: 400, start: 'with', delay: 200 });
  s.slide.addNotes(
    [
      'Do not trust, verify. Every accepted bid goes into a hash-chained ledger: each entry carries the hash of the one before it, so an edited entry shows up as edited.',
      'The audit page and the ledger lab (AG Grid) re-check the chain in the browser from the public export. Hashes on the slide are shortened examples.',
    ].join('\n\n'),
  );
}

// 10. Under the hood
{
  const s = newSlide('dark', ['LOT 09', 'UNDER THE HOOD'], 'fade');
  cornerMark(s);
  disp(s, 'arch_h', 0.6, 1.1, 'arch-h');
  const stops = [
    ['arch_w1', 'Bidder phones, the auctioneer console and the big screen.'],
    ['arch_w2', 'Workers serve the web app and the docs, with security headers.'],
    [
      'arch_w3',
      'One Node service runs the API and the auction engine. The ledger lives on its disk.',
    ],
    ['arch_w4', 'Sandbox holds, capture and void. Signed webhooks come back to the API.'],
  ];
  const sx = (i) => 0.6 + i * 3.13;
  const wireY = 5.15;
  stops.forEach(([word, body], i) => {
    const x = sx(i);
    rect(
      s,
      `arch-card${i + 1}`,
      { x, y: 2.2, w: 2.75, h: 2.45 },
      {
        fill: { color: K.ink2 },
        line: { color: K.line, width: 1 },
      },
    );
    label(
      s,
      `arch-num${i + 1}`,
      `0${i + 1}`,
      { x: x + 0.25, y: 2.42, w: 1, h: 0.28 },
      { color: K.orange },
    );
    disp(s, word, x + 0.25, 2.95, `arch-word${i + 1}`);
    text(
      s,
      `arch-body${i + 1}`,
      body,
      { x: x + 0.25, y: 3.55, w: 2.3, h: 1.3 },
      {
        fontSize: 14,
        color: K.mutedDark,
      },
    );
  });
  s.slide.addShape(pres.shapes.LINE, {
    x: sx(0) + 1.375,
    y: wireY,
    w: sx(3) - sx(0),
    h: 0,
    line: { color: K.line, width: 2 },
    objectName: 'arch-wire',
  });
  stops.forEach((_, i) => {
    oval(
      s,
      `arch-stop${i + 1}`,
      sx(i) + 1.375,
      wireY,
      0.16,
      { color: K.mutedDark, width: 1.5 },
      {
        fill: { color: K.ink },
      },
    );
  });
  oval(s, 'arch-packet', sx(0) + 1.375, wireY, 0.24, undefined, { fill: { color: K.orange } });
  text(
    s,
    'arch-foot',
    'TypeScript monorepo on Node 22. A deterministic engine keeps money in integer cents. AG Grid powers the ledger lab, and five open datasets sit on Hugging Face.',
    { x: 0.6, y: 5.65, w: 12.1, h: 0.8 },
    { fontSize: 15, color: K.mutedDark },
  );
  fx('arch-h', 'float', { dur: 600, delay: 150 });
  stops.forEach((_, i) => {
    const st = i === 0 ? 'after' : 'with';
    const d = i * 220;
    fx(`arch-card${i + 1}`, 'float', { dur: 550, rise: 0.04, start: st, delay: d });
    fx(`arch-num${i + 1}`, 'float', { dur: 550, rise: 0.04, start: 'with', delay: d });
    fx(`arch-word${i + 1}`, 'float', { dur: 550, rise: 0.04, start: 'with', delay: d });
    fx(`arch-body${i + 1}`, 'fade', { dur: 500, start: 'with', delay: d + 250 });
  });
  fx('arch-wire', 'wipe', { dir: 'left', dur: 700, delay: 100 });
  stops.forEach((_, i) =>
    fx(`arch-stop${i + 1}`, 'zoom', { from: 0.3, dur: 300, start: 'with', delay: 150 * i }),
  );
  fx('arch-packet', 'zoom', { from: 0.2, dur: 300 });
  for (let i = 1; i < 4; i += 1) {
    fx('arch-packet', 'path', {
      dur: 600,
      delay: 120,
      path: [
        [(sx(i - 1) - sx(0)) / 13.333, 0],
        [(sx(i) - sx(0)) / 13.333, 0],
      ],
    });
  }
  fx('arch-foot', 'fade', { dur: 500 });
  s.slide.addNotes(
    [
      'One bid, four stops. The browser (bidder phone, console, big screen) loads the web app from Cloudflare Workers; bids and hold approvals go to the API on Render; the API talks to the PayPal sandbox for authorize, capture and void, and signed webhooks come back.',
      'The API and WebSocket host is one always-on Node service on Render with a 1 GB disk for the ledger and settlement journals. The engine has no Node built-ins, so the same events always give the same result.',
      'Deeper architecture, security and the settlement saga are in the judge guide (PDF).',
    ].join('\n\n'),
  );
}

// 11. Proof
{
  const s = newSlide('dark', ['LOT 10', 'PROOF, NOT PROMISES'], 'fade');
  cornerMark(s);
  disp(s, 'proof_h', 0.6, 1.1, 'proof-h');
  const tiles = [
    [
      'proof_n1',
      'proof_u1',
      'A real server killed mid-settlement. On restart: one capture, two holds voided, the journal equal to PayPal.',
    ],
    [
      'proof_n2',
      'proof_u2',
      'Synthetic clips on the live voice socket. No spoken bid counted without a confirm.',
    ],
    [
      'proof_n3',
      'proof_u3',
      'The hosted judge flow, from the judge panel to the receipts, on the live domains.',
    ],
    ['proof_n4', 'proof_u4', 'Run in CI. All eight P0 items of the security review pass.'],
  ];
  const tx = (i) => 0.6 + i * 3.09;
  tiles.forEach(([n, u, body], i) => {
    const x = tx(i);
    rect(s, `proof-tile${i + 1}`, { x, y: 2.15, w: 2.85, h: 3.1 }, { fill: { color: K.ink2 } });
    disp(s, n, x + 0.25, 2.45, `proof-num${i + 1}`, 0.8);
    disp(s, u, x + 0.25, 3.45, `proof-unit${i + 1}`);
    text(
      s,
      `proof-body${i + 1}`,
      body,
      { x: x + 0.25, y: 3.98, w: 2.4, h: 1.15 },
      {
        fontSize: 13,
        color: K.mutedDark,
      },
    );
  });
  label(s, 'proof-gates', 'SANDBOX GATES', { x: 0.6, y: 5.55, w: 1.9, h: 0.42 });
  const chips = [
    ['G0 PASS', 1.12, true],
    ['G1 PASS', 1.12, true],
    ['G2 PASS', 1.12, true],
    ['G4 PASS', 1.12, true],
    ['G3 IN PROGRESS', 2.05, false],
    ['G5 PARTIAL', 1.45, false],
  ];
  let cx = 2.55;
  chips.forEach(([t, w, pass], i) => {
    text(
      s,
      `proof-chip${i + 1}`,
      t,
      { x: cx, y: 5.55, w, h: 0.42 },
      {
        fontSize: 11,
        bold: true,
        charSpacing: 2,
        align: 'center',
        valign: 'middle',
        color: pass ? K.ink : K.paper,
        fill: pass ? { color: K.orange } : undefined,
        line: { color: pass ? K.orange : K.mutedDark, width: 1 },
      },
    );
    cx += w + 0.12;
  });
  text(
    s,
    'proof-note',
    'The kill ran on a CI runner against the sandbox. Voice accuracy is measured on synthetic clips. Both latency targets are missed. The judge guide has every number with its evidence.',
    { x: 0.6, y: 6.15, w: 12.1, h: 0.62 },
    { fontSize: 13, color: K.mutedDark },
  );
  fx('proof-h', 'float', { dur: 600, delay: 150 });
  tiles.forEach((_, i) => {
    const st = i === 0 ? 'after' : 'with';
    const d = i * 300;
    fx(`proof-tile${i + 1}`, 'fade', { dur: 450, start: st, delay: d });
    fx(`proof-num${i + 1}`, 'zoom', { from: 0.5, dur: 450, start: 'with', delay: d + 120 });
    fx(`proof-unit${i + 1}`, 'fade', { dur: 400, start: 'with', delay: d + 250 });
    fx(`proof-body${i + 1}`, 'fade', { dur: 400, start: 'with', delay: d + 350 });
  });
  fx('proof-gates', 'fade', { dur: 350, delay: 150 });
  chips.forEach((_, i) =>
    fx(`proof-chip${i + 1}`, 'zoom', { from: 0.6, dur: 300, start: 'with', delay: 120 + i * 110 }),
  );
  fx('proof-note', 'fade', { dur: 500, delay: 100 });
  s.slide.addNotes(
    [
      'Evidence before claims: nothing counted until a real run backed it.',
      'Kill test: a real server process was killed after the capture request and before the response. On restart with the same data folder it settled with one capture of 12500 cents, equal to the hammer price, two losers voided, a journal equal to PayPal and a ledger of 19 entries that verifies (Actions run 42558021614; it ran on a CI runner, not on the deployed host).',
      'Voice: both providers answered 24 of 24 synthetic clips through the live audio socket, and no bid was accepted without a confirm (run 42575018866).',
      'Judge flow: 17 of 17 steps on the live domains (run 42584326641). More than 4,500 test cases run in CI, and all eight P0 security items pass.',
      'Gates: G0, G1, G2 and G4 PASS on the real PayPal sandbox. G3 (how long a hold lasts) is a timed probe in progress, reading out about 12 Nov 06:17 UTC. G5 (voice accuracy) is PARTIAL. Latency: hammer to settled p95 6927.43 ms against a 6000 ms target, and hammer to captured p95 3766.67 ms against 2500 ms; both are missed.',
      'Source: docs/GATES.md and README "What is proven".',
    ].join('\n\n'),
  );
}

// 12. Performance
{
  const s = newSlide('paper', ['LOT 11', 'PERFORMANCE'], 'fade');
  cornerMark(s);
  disp(s, 'ps_h', 0.6, 1.1, 'ps-h');
  text(
    s,
    'ps-sub',
    'PageSpeed Insights on the landing page: 100 in all four categories, on mobile and on desktop.',
    { x: 0.6, y: 2.0, w: 12, h: 0.45 },
    { fontSize: 18 },
  );
  const cats = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST PRACTICES', 'SEO'];
  const ringC = (i) => 0.6 + i * 3.033 + 1.517;
  cats.forEach((c, i) => {
    const cx = ringC(i);
    oval(s, `ps-track${i + 1}`, cx, 3.95, 2.1, { color: K.rule, width: 9 });
    oval(s, `ps-ring${i + 1}`, cx, 3.95, 2.1, { color: K.orange, width: 9 });
    const a = A.ps_100;
    s.slide.addImage({
      path: a.file,
      x: cx - a.w / 2,
      y: 3.95 - a.h / 2,
      w: a.w,
      h: a.h,
      altText: `${c.toLowerCase()} 100`,
      objectName: `ps-100-${i + 1}`,
    });
    label(
      s,
      `ps-cat${i + 1}`,
      c,
      { x: cx - 1.5, y: 5.2, w: 3.0, h: 0.32 },
      {
        align: 'center',
        color: K.ink,
        fontSize: 12,
      },
    );
  });
  text(
    s,
    'ps-metrics',
    'Mobile: LCP 1.1 s, TBT 10 ms, CLS 0.   Desktop: LCP 0.2 s, TBT 20 ms, CLS 0.',
    { x: 0.6, y: 5.85, w: 12.1, h: 0.4 },
    { fontSize: 16 },
  );
  text(
    s,
    'ps-scope',
    'Lighthouse 13.6.0 lab data, measured by hand on 10 Nov 2026. The landing page only, not the whole app.',
    { x: 0.6, y: 6.3, w: 12.1, h: 0.4 },
    { fontSize: 13, color: K.mutedPaper },
  );
  fx('ps-h', 'float', { dur: 600, delay: 150 });
  fx('ps-sub', 'fade', { dur: 500, start: 'with', delay: 300 });
  cats.forEach((_, i) => {
    const st = i === 0 ? 'after' : 'with';
    const d = i * 260;
    fx(`ps-track${i + 1}`, 'fade', { dur: 300, start: st, delay: d });
    fx(`ps-ring${i + 1}`, 'wheel', { dur: 1100, start: 'with', delay: d + 100 });
    fx(`ps-100-${i + 1}`, 'zoom', { from: 0.5, dur: 400, start: 'with', delay: d + 900 });
    fx(`ps-cat${i + 1}`, 'fade', { dur: 400, start: 'with', delay: d + 1000 });
  });
  fx('ps-metrics', 'fade', { dur: 500, delay: 100 });
  fx('ps-scope', 'fade', { dur: 500, start: 'with', delay: 200 });
  s.slide.addNotes(
    [
      'PageSpeed Insights scored the landing page 100 for Performance, Accessibility, Best Practices and SEO, on both mobile and desktop.',
      'Measured by hand on the public PageSpeed Insights site on 10 Nov 2026 (Lighthouse 13.6.0, lab data). Mobile: FCP and LCP 1.1 s, TBT 10 ms, CLS 0. Desktop: LCP 0.2 s, TBT 20 ms, CLS 0.',
      'Scope: the landing page only, not the room, hub, console, audit or docs pages. Source: docs/evidence/perf/PAGESPEED.md.',
    ].join('\n\n'),
  );
}

// 13. Team
{
  const s = newSlide('dark', ['LOT 12', 'THE TEAM'], 'fade');
  cornerMark(s);
  disp(s, 'team_h', 0.6, 1.1, 'team-h');
  const people = [
    [
      'team_hb',
      'team_n1',
      'The auction engine, PayPal payments and settlement, voice, evidence and operations.',
      'harshbhx',
      LINKS.harsh,
    ],
    [
      'team_dp',
      'team_n2',
      'The web UI, accessibility, UX polish, the end-to-end scenario runner and deploys on Render.',
      'DhairyaPatel-Devloper',
      LINKS.dhairya,
    ],
  ];
  people.forEach(([ini, name, role, handle, url], i) => {
    const x = 0.6 + i * 6.23;
    const y = 2.15;
    const n = i + 1;
    rect(s, `team-card${n}`, { x, y, w: 5.9, h: 3.75 }, { fill: { color: K.ink2 } });
    oval(s, `team-ring${n}`, x + 0.98, y + 0.98, 1.3, { color: K.orange, width: 2.5 });
    const a = A[ini];
    s.slide.addImage({
      path: a.file,
      x: x + 0.98 - a.w / 2,
      y: y + 0.98 - a.h / 2,
      w: a.w,
      h: a.h,
      altText: `${a.text} monogram`,
      objectName: `team-ini${n}`,
    });
    disp(s, name, x + 0.35, y + 2.0, `team-name${n}`);
    text(s, `team-role${n}`, role, { x: x + 0.35, y: y + 2.6, w: 5.2, h: 0.62 }, { fontSize: 15 });
    text(
      s,
      `team-link${n}`,
      [
        {
          text: `${handle} on GitHub`,
          options: { hyperlink: { url, tooltip: `${handle} on GitHub` }, color: K.orange },
        },
      ],
      { x: x + 0.35, y: y + 3.25, w: 5.2, h: 0.32 },
      { fontSize: 13 },
    );
  });
  text(
    s,
    'team-foot',
    'Started on 4 Nov 2026. A TypeScript monorepo, open source under the MIT licence.',
    { x: 0.6, y: 6.2, w: 12.1, h: 0.4 },
    { fontSize: 14, color: K.mutedDark },
  );
  fx('team-h', 'float', { dur: 600, delay: 150 });
  people.forEach((_, i) => {
    const n = i + 1;
    const st = i === 0 ? 'after' : 'with';
    const d = i * 350;
    fx(`team-card${n}`, 'float', { dur: 550, rise: 0.04, start: st, delay: d });
    fx(`team-ring${n}`, 'wheel', { dur: 800, start: 'with', delay: d + 200 });
    fx(`team-ini${n}`, 'fade', { dur: 400, start: 'with', delay: d + 500 });
    fx(`team-name${n}`, 'float', { dur: 500, rise: 0.04, start: 'with', delay: d + 300 });
    fx(`team-role${n}`, 'fade', { dur: 450, start: 'with', delay: d + 500 });
    fx(`team-link${n}`, 'fade', { dur: 450, start: 'with', delay: d + 600 });
  });
  fx('team-foot', 'fade', { dur: 500, delay: 100 });
  s.slide.addNotes(
    [
      'Two builders.',
      'Harsh Bhanushali (harshbhx): the auction engine, PayPal payments and settlement, voice, evidence and operations.',
      'Dhairya Patel (DhairyaPatel-Devloper): the web UI, accessibility, UX polish, the end-to-end scenario runner and deploys on Render.',
      `GitHub: ${LINKS.harsh} and ${LINKS.dhairya}`,
    ].join('\n\n'),
  );
}

// 14. Close
{
  const s = newSlide('dark', ['GAVEL', 'TRY IT'], 'morph');
  rings(s, 10.35, 3.85, [0, 45, 70]);
  s.slide.addImage({
    path: A.mark_dark.file,
    x: 9.05,
    y: 2.55,
    w: 2.6,
    h: 2.6,
    altText: 'GAVEL logo mark',
    objectName: '!!mark',
  });
  const sc = 0.62;
  disp(s, 'hero_l1', 0.6, 1.15, 'close-l1', sc);
  const l2 = disp(s, 'hero_l2a', 0.6, 2.25, 'close-l2a', sc);
  disp(s, 'hero_l2b', l2.x + l2.w + 0.42 * sc, 2.25, 'close-l2b', sc);
  disp(s, 'close_tag', 0.62, 3.45, 'close-tag');
  const rows = [
    [[['Judge panel', LINKS.try]], ': a live sandbox room, no login'],
    [[['Scripted demo', LINKS.scripted]], ': a recorded room, about one minute'],
    [
      [
        ['Docs', LINKS.docs],
        [' and ', null],
        ['API reference', LINKS.api],
      ],
      ': guides and a Try it panel',
    ],
    [[['Source code', LINKS.source]], ': open source, MIT licence'],
  ];
  rows.forEach(([parts, rest], i) => {
    const runs = parts.map(([t, url]) =>
      url
        ? { text: t, options: { hyperlink: { url, tooltip: t }, color: K.orange, bold: true } }
        : { text: t, options: { color: K.paper } },
    );
    runs.push({ text: rest, options: { color: K.paper } });
    text(
      s,
      `close-link${i + 1}`,
      runs,
      { x: 0.6, y: 4.25 + i * 0.47, w: 7.6, h: 0.42 },
      { fontSize: 17 },
    );
  });
  text(
    s,
    'close-guide',
    'Test steps, architecture, security, evidence and limits are in the GAVEL judge guide (PDF) that comes with this deck.',
    { x: 0.6, y: 6.2, w: 6.9, h: 0.6 },
    { fontSize: 13, color: K.mutedDark },
  );
  fx('close-l1', 'float', { dur: 600, delay: 200 });
  fx('close-l2a', 'float', { dur: 600, start: 'with', delay: 150 });
  fx('close-l2b', 'zoom', { from: 1.6, dur: 450 });
  fx('close-tag', 'fade', { dur: 450 });
  rows.forEach((_, i) =>
    fx(`close-link${i + 1}`, 'float', {
      dur: 450,
      rise: 0.03,
      start: i === 0 ? 'after' : 'with',
      delay: i * 150,
    }),
  );
  fx('close-guide', 'fade', { dur: 500, delay: 100 });
  s.slide.addNotes(
    [
      'Every bid is a hold. The hammer is the payment.',
      `Judge panel (a live sandbox room, no login): ${LINKS.try}`,
      `Scripted demo (recorded, about one minute): ${LINKS.scripted}`,
      `Docs: ${LINKS.docs}  API reference: ${LINKS.api}`,
      `Source, MIT licence: ${LINKS.source}`,
      'Hands-on test steps, the judge API key, architecture, security, evidence and limits are in the GAVEL judge guide (PDF). PayPal sandbox only: bids are held, not charged, and no real money moves.',
    ].join('\n\n'),
  );
}

await pres.writeFile({ fileName: join(out, 'deck-raw.pptx') });
writeFileSync(
  join(out, 'motion.json'),
  JSON.stringify(
    motion.map((m) => ({ transition: m.transition ?? null, anims: m.anims })),
    null,
    2,
  ) + '\n',
);
console.log(`${motion.length} slides -> ${join(out, 'deck-raw.pptx')}`);
