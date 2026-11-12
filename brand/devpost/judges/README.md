# Judge materials

Two documents for the Devpost judge panel: the judge deck (the story and the pitch) and the judge guide (the hands-on test path and the technical detail).

## Judge deck

`GAVEL-judge-deck.pptx` is the presentation for the Devpost judge panel: the visual story and the pitch, 14 slides at 16:9. It is light on text and carries the motion. The hands-on test steps, the deep architecture, security, the evidence tables and the limits are in the separate judge guide (PDF); the deck points to it once, on the last slide.

Every number on the slides comes from the repository: [`docs/GATES.md`](../../../docs/GATES.md), the root [`README.md`](../../../README.md) ("What is proven"), [`brand/devpost/DESCRIPTION.md`](../DESCRIPTION.md) and [`docs/evidence/perf/PAGESPEED.md`](../../../docs/evidence/perf/PAGESPEED.md). The speaker notes of each slide say where its numbers come from and hold the full links.

### Slides

| #   | Slide              | What it shows                                                                                                                | Motion                                                              |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Cover              | Every bid is a hold. The hammer is the payment.                                                                              | Shock rings and the mark strike in, the headline rises, HOLD stamps |
| 2   | A charity night    | The hook: a $200 call, a paddle that goes back down, a $400 winner who never pays                                            | Morph from the cover; paddles rise, sink and leave                  |
| 3   | The problem        | Pay first or trust later: bidders hold back, winners walk away, no record                                                    | Icons, words and lines build in turn                                |
| 4   | The idea           | Hold, not charge: authorize $500, capture $350, release $150 (the G1 sandbox run)                                            | The held bar wipes in, then the capture fills it                    |
| 5   | How it works       | Hold, bid, hammer, receipt                                                                                                   | A packet travels the track and lights each step                     |
| 6   | How it feels       | The bidder: approve a hold, bid, lead or get outbid                                                                          | Two screen loops of the live app (GIF)                              |
| 7   | Voice bidding      | Say it, then confirm: transcript, parsed bid, confirm card                                                                   | The waveform plays in, the chips and the confirm card follow        |
| 8   | The hammer         | Press and hold to close; capture the winner, void the rest                                                                   | Live console screens (GIF); the hold ring draws, SOLD stamps        |
| 9   | Receipt and verify | Do not trust, verify: a hash-chained ledger anyone can re-check                                                              | Ledger entries link up one by one, then the chain verifies          |
| 10  | Under the hood     | One bid, four stops: browser, Cloudflare, Render, PayPal                                                                     | Cards rise, a packet runs the wire                                  |
| 11  | Proof              | 0 mismatches with PayPal after a server kill, voice 24/24, judge flow 17/17, 4,500+ tests; gates G0 to G5 with honest status | Tiles and numbers build, gate chips pop in                          |
| 12  | Performance        | PageSpeed 100/100/100/100 on mobile and desktop (landing page only, lab data, 10 Nov 2026)                                   | Four score rings draw to 100                                        |
| 13  | The team           | Harsh Bhanushali and Dhairya Patel                                                                                           | Cards rise, monogram rings draw                                     |
| 14  | Try it             | Links (judge panel, scripted demo, docs, API reference, source) and the pointer to the judge guide                           | Morph: the mark glides back to the centre                           |

### How it plays

- Every slide builds on its own after it appears; one click (or the arrow key) moves to the next slide. Builds take two to six seconds.
- Transitions follow the meaning of each section. Cover to 2 and 13 to 14 are Morph (the mark and the rings keep their names, so PowerPoint tweens them; slide 12 to 13 morphs the score rings into the monogram rings). Slides 3 and 5 push left (the story moves on), 9 pushes up, 6 pulls back to the screens, 10 covers (layers stack), 4 and 11 dip through black (the idea, the proof), 8 is a cut through black (the hammer), 7 and 12 fade. Each lasts 0.7 to 0.8 s. Morph needs PowerPoint 2019, 2021 or Microsoft 365; older PowerPoint, Keynote and Google Slides show a fade instead.
- Builds by role (slide 2 on): headlines wipe in from the left, cards fade and rise 0.15 s apart, numbers and chips pop with a small overshoot, lines and tracks wipe on in the direction of the flow, and the key numbers on slide 11 (0 mismatches, 24/24, 17/17, 4,500+) pulse once. Effects last 0.4 to 0.8 s, all start on their own, and every build ends on the complete slide, so a PDF export or print looks the same as the finished slide.
- The GIFs on slides 6 and 8 are short loops of screens of the current web app (limit slider and hold, bid screen leading and outbid, console with a live lot and the hold-to-close dialog). They are built by [`src/compose-screens.py`](src/compose-screens.py) from the stills in `src/screens/frames/`, which are the `desktop-light` PNGs of the `ui-screens` workflow cropped to 1440x900 and scaled to 960x600. To refresh them, run `ui-screens` on main, copy the new PNGs into `src/screens/frames/` under the same names and run the script. They loop in PowerPoint, Keynote and Google Slides.
- Display type (the large capitals) is the brand face, Big Shoulders Display, set as transparent PNG with the text as alt text, so it looks the same without the font installed. Body text is Arial.
- PDF exports and LibreOffice show each slide in its final state with the first frame of each GIF.

### Rebuild

The sources are in [`src/`](src): `assets.py` renders the display type, the mark, the icons and the bars; `build-deck.mjs` lays out the slides with pptxgenjs 3.12.0; `finalize.py` writes the theme colours, the transitions and the build animations.

```bash
python3 brand/devpost/judges/src/assets.py brand/devpost/judges/.build
DECK_DEPS=/path/to/folder-with-pptxgenjs node brand/devpost/judges/src/build-deck.mjs brand/devpost/judges/.build
python3 brand/devpost/judges/src/finalize.py brand/devpost/judges/.build brand/devpost/judges/GAVEL-judge-deck.pptx
```

`DECK_DEPS` is a folder whose `node_modules` holds `pptxgenjs@3.12.0`; Python needs Pillow with libraqm. The [`judge-deck`](../../../.github/workflows/judge-deck.yml) workflow rebuilds the deck from source and renders the committed file to a PDF and one PNG per slide (artifact `judge-deck-preview`).

## Judge guide (PDF for the Devpost judge panel)

`GAVEL-judge-guide.pdf` is the confidential guide uploaded for the judges in the Devpost judge panel. It is the hands-on and technical companion to the judge deck: the deck tells the story, this guide covers the five-minute test path, the architecture, security and ledger verification, the evidence, the APIMatic SDKs, the known limits and the contact.

The committed and CI-built guide has **no placeholders** and no secrets. It has a dedicated **Credentials** page that, as committed, says the judge key and the sandbox buyer logins are in the Devpost Testing instructions. The curl examples read the key from the `$JUDGE_KEY` environment variable. The contact email, the SDK release link and the G3 wording are written in as final text.

The final copy that goes privately to judges can have the Credentials page filled by a person at the last moment (see "Fill the Credentials page"). Nothing in the repository or in CI ever holds a real key or password.

| File                    | What it is                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `judge-guide.html`      | The content, finished text only                                    |
| `judge-guide.css`       | Print styles (A4), brand colours and type from `brand/tokens.json` |
| `build.py`              | Builds the PDF with WeasyPrint and can draw one PNG per page       |
| `GAVEL-judge-guide.pdf` | The built guide, uploaded to Devpost as it is                      |

### Build

```bash
pip install weasyprint brotli
python3 brand/devpost/judges/build.py                  # writes GAVEL-judge-guide.pdf here
python3 brand/devpost/judges/build.py --png /tmp/pages  # plus one PNG per page (needs pdftoppm)
```

The fonts are the brand variable fonts in `packages/web/src/design/fonts`; `build.py` cuts static instances of the weights it needs into a temporary folder for each build. Never add a key, a password or a sandbox login to this folder.

### Fill the Credentials page

`build.py --fill FILE.json --out FILE.pdf` replaces the text between the `CREDENTIALS` markers on the Credentials page with the judge key and a Role / Email / Password table (JSON keys `JUDGE_KEY`, `BUYER_A_EMAIL`, `BUYER_A_PASSWORD`, and the same for B, C and D). It refuses to write the PDF inside the repository. The `judge-deck` workflow runs it with dummy values to prove the fill works. On the VM a person runs `~/scripts/fill-judge-guide.sh`, which keeps the values out of the repository and out of the shell history, and writes `~/judge-guide-FINAL.pdf` with mode 600. Never commit that file.
