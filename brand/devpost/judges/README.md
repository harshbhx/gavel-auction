# Judge deck

`GAVEL-judge-deck.pptx` is the presentation for the Devpost judge panel: the visual story and the pitch, 14 slides at 16:9. It is light on text and carries the motion. The hands-on test steps, the deep architecture, security, the evidence tables and the limits are in the separate judge guide (PDF); the deck points to it once, on the last slide.

Every number on the slides comes from the repository: [`docs/GATES.md`](../../../docs/GATES.md), the root [`README.md`](../../../README.md) ("What is proven"), [`brand/devpost/DESCRIPTION.md`](../DESCRIPTION.md) and [`docs/evidence/perf/PAGESPEED.md`](../../../docs/evidence/perf/PAGESPEED.md). The speaker notes of each slide say where its numbers come from and hold the full links.

## Slides

| #   | Slide              | What it shows                                                                                               | Motion                                                              |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Cover              | Every bid is a hold. The hammer is the payment.                                                             | Shock rings and the mark strike in, the headline rises, HOLD stamps |
| 2   | A charity night    | The hook: a $200 call, a paddle that goes back down, a $400 winner who never pays                           | Morph from the cover; paddles rise, sink and leave                  |
| 3   | The problem        | Pay first or trust later: bidders hold back, winners walk away, no record                                   | Icons, words and lines build in turn                                |
| 4   | The idea           | Hold, not charge: authorize $500, capture $350, release $150 (the G1 sandbox run)                           | The held bar wipes in, then the capture fills it                    |
| 5   | How it works       | Hold, bid, hammer, receipt                                                                                  | A packet travels the track and lights each step                     |
| 6   | How it feels       | The bidder: approve a hold, bid, lead or get outbid                                                         | Two screen recordings of the live app (GIF)                         |
| 7   | Voice bidding      | Say it, then confirm: transcript, parsed bid, confirm card                                                  | The waveform plays in, the chips and the confirm card follow        |
| 8   | The hammer         | Press and hold to close; capture the winner, void the rest                                                  | Live console recording (GIF); the hold ring draws, SOLD stamps      |
| 9   | Receipt and verify | Do not trust, verify: a hash-chained ledger anyone can re-check                                             | Ledger entries link up one by one, then the chain verifies          |
| 10  | Under the hood     | One bid, four stops: browser, Cloudflare, Render, PayPal                                                    | Cards rise, a packet runs the wire                                  |
| 11  | Proof              | 0 diffs after a server kill, voice 24/24, judge flow 17/17, 4,500+ tests; gates G0 to G5 with honest status | Tiles and numbers build, gate chips pop in                          |
| 12  | Performance        | PageSpeed 100/100/100/100 on mobile and desktop (landing page only, lab data, 10 Nov 2026)                  | Four score rings draw to 100                                        |
| 13  | The team           | Harsh Bhanushali and Dhairya Patel                                                                          | Cards rise, monogram rings draw                                     |
| 14  | Try it             | Links (judge panel, scripted demo, docs, API reference, source) and the pointer to the judge guide          | Morph: the mark glides back to the centre                           |

## How it plays

- Every slide builds on its own after it appears; one click (or the arrow key) moves to the next slide. Builds take two to six seconds.
- Transitions are Fade, and Morph from the cover to slide 2 and from slide 13 to the close. Morph needs PowerPoint 2019, 2021 or Microsoft 365; older PowerPoint, Keynote and Google Slides show a fade instead.
- The GIFs on slides 6 and 8 are the screen recordings of the live app from [`brand/archive/see-it-run/`](../../archive/see-it-run); they loop in PowerPoint, Keynote and Google Slides.
- Display type (the large capitals) is the brand face, Big Shoulders Display, set as transparent PNG with the text as alt text, so it looks the same without the font installed. Body text is Arial.
- PDF exports and LibreOffice show each slide in its final state with the first frame of each GIF.

## Rebuild

The sources are in [`src/`](src): `assets.py` renders the display type, the mark, the icons and the bars; `build-deck.mjs` lays out the slides with pptxgenjs 3.12.0; `finalize.py` writes the theme colours, the transitions and the build animations.

```bash
python3 brand/devpost/judges/src/assets.py brand/devpost/judges/.build
DECK_DEPS=/path/to/folder-with-pptxgenjs node brand/devpost/judges/src/build-deck.mjs brand/devpost/judges/.build
python3 brand/devpost/judges/src/finalize.py brand/devpost/judges/.build brand/devpost/judges/GAVEL-judge-deck.pptx
```

`DECK_DEPS` is a folder whose `node_modules` holds `pptxgenjs@3.12.0`; Python needs Pillow with libraqm. The [`judge-deck`](../../../.github/workflows/judge-deck.yml) workflow rebuilds the deck from source and renders the committed file to a PDF and one PNG per slide (artifact `judge-deck-preview`).
