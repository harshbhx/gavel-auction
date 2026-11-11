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
| 6   | How it feels       | The bidder: approve a hold, bid, lead or get outbid                                                                          | Two screen recordings of the live app (GIF)                         |
| 7   | Voice bidding      | Say it, then confirm: transcript, parsed bid, confirm card                                                                   | The waveform plays in, the chips and the confirm card follow        |
| 8   | The hammer         | Press and hold to close; capture the winner, void the rest                                                                   | Live console recording (GIF); the hold ring draws, SOLD stamps      |
| 9   | Receipt and verify | Do not trust, verify: a hash-chained ledger anyone can re-check                                                              | Ledger entries link up one by one, then the chain verifies          |
| 10  | Under the hood     | One bid, four stops: browser, Cloudflare, Render, PayPal                                                                     | Cards rise, a packet runs the wire                                  |
| 11  | Proof              | 0 mismatches with PayPal after a server kill, voice 24/24, judge flow 17/17, 4,500+ tests; gates G0 to G5 with honest status | Tiles and numbers build, gate chips pop in                          |
| 12  | Performance        | PageSpeed 100/100/100/100 on mobile and desktop (landing page only, lab data, 10 Nov 2026)                                   | Four score rings draw to 100                                        |
| 13  | The team           | Harsh Bhanushali and Dhairya Patel                                                                                           | Cards rise, monogram rings draw                                     |
| 14  | Try it             | Links (judge panel, scripted demo, docs, API reference, source) and the pointer to the judge guide                           | Morph: the mark glides back to the centre                           |

### How it plays

- Every slide builds on its own after it appears; one click (or the arrow key) moves to the next slide. Builds take two to six seconds.
- Transitions are Fade, and Morph from the cover to slide 2 and from slide 13 to the close. Morph needs PowerPoint 2019, 2021 or Microsoft 365; older PowerPoint, Keynote and Google Slides show a fade instead.
- The GIFs on slides 6 and 8 are the screen recordings of the live app from [`brand/archive/see-it-run/`](../../archive/see-it-run); they loop in PowerPoint, Keynote and Google Slides.
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

The committed PDF has **placeholders only**. Every spot where a judge key, a sandbox login or a late fact belongs shows a dashed orange box such as `[JUDGE KEY: Harsh pastes here]`. The filled copy that goes to Devpost is built outside the repository and never committed.

| File                       | What it is                                                                   |
| -------------------------- | ---------------------------------------------------------------------------- |
| `judge-guide.html`         | The content. Placeholders are `<span class="ph" data-key="KEY">` elements    |
| `judge-guide.css`          | Print styles (A4), brand colours and type from `brand/tokens.json`           |
| `build.py`                 | Builds the PDF with WeasyPrint, optionally fills placeholders and draws PNGs |
| `judge-fill.template.json` | The placeholder keys, to copy outside the repository and fill                |
| `GAVEL-judge-guide.pdf`    | The built guide with placeholders (safe to commit)                           |

### Build

```bash
pip install weasyprint brotli
python3 brand/devpost/judges/build.py                  # placeholder version, written here
python3 brand/devpost/judges/build.py --png /tmp/pages  # plus one PNG per page (needs pdftoppm)
```

The fonts are the brand variable fonts in `packages/web/src/design/fonts`; `build.py` cuts static instances of the weights it needs into a temporary folder for each build.

### Fill the placeholders for Devpost

1. Copy `judge-fill.template.json` to a private folder outside the repository, for example `~/secure/judge-fill.json`, and fill the values there.
2. Build the filled copy outside the repository:

   ```bash
   python3 brand/devpost/judges/build.py --fill ~/secure/judge-fill.json --out ~/hackathon/judge-guide/GAVEL-judge-guide-filled.pdf
   ```

   The script refuses to write a filled PDF inside the repository. Any key left empty stays a visible placeholder and is listed in the output.

3. Open the filled PDF, check every page, and upload it in the Devpost judge panel.

| Key                | What goes there                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `JUDGE_KEY`        | The shared, non-expiring judge key (`gvl_judge_...`). Check it first: `POST /api/judge/key`               |
| `BUYER_A_EMAIL`    | Sandbox buyer A (wallet, the winning bidder)                                                              |
| `BUYER_A_PASSWORD` | Its sandbox password                                                                                      |
| `BUYER_B_EMAIL`    | Sandbox buyer B (wallet, spare or runner-up)                                                              |
| `BUYER_B_PASSWORD` | Its sandbox password                                                                                      |
| `BUYER_C_EMAIL`    | Sandbox buyer C (wallet paying from a sandbox test card)                                                  |
| `BUYER_C_PASSWORD` | Its sandbox password                                                                                      |
| `BUYER_D_EMAIL`    | Sandbox buyer D (wallet, the losing bidder whose hold is voided)                                          |
| `BUYER_D_PASSWORD` | Its sandbox password                                                                                      |
| `CONTACT_EMAIL`    | The email judges can write to                                                                             |
| `G3_RESULT`        | The final G3 reading (about 12 Nov 06:17 UTC); leave empty and edit the HTML to drop the line if not used |
| `SDK_RELEASE`      | Link to the `sdk-v0.0.5` GitHub release once it exists; same note as above                                |

Rules: never commit a filled PDF or a filled JSON file, never paste the values into an issue, pull request or chat, and keep the filled PDF only where the Devpost upload needs it.
