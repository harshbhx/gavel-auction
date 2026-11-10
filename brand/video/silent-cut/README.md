# GAVEL silent cut

One product video of GAVEL with no voice and no audio of any kind, 144 seconds, 1920x1080. Captions are burned in
and also given as an SRT, so a voice-over can be added later. Built for the PayPal Hackathon 2026 Devpost entry
(video limit: under 3 minutes). Rendered in CI from `main` after the UI merges.

| File                                                         | What it is                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| [`gavel-silent-cut.mp4`](gavel-silent-cut.mp4)               | H.264, 1920x1080, 24 fps, no audio track, 5.88 MB              |
| [`gavel-silent-cut.webm`](gavel-silent-cut.webm)             | VP9, same picture, no audio track, 9.30 MB                     |
| [`gavel-silent-cut-poster.png`](gavel-silent-cut-poster.png) | Poster, 1920x1080, the title card                              |
| [`gavel-silent-cut.en.srt`](gavel-silent-cut.en.srt)         | The captions with timecodes, for a later voice-over or YouTube |
| [`timeline.json`](timeline.json)                             | Scene and caption times in seconds, machine readable           |

No third-party audio is used, because the Devpost rules forbid copyrighted music. If you add narration, add it yourself
with your own voice or a licensed voice (see "Adding a voice-over").

## What it shows and what it does not

- The product flow is a **recording of the real web app** against a local server in CI (the judge-room API with
  **simulated holds**, fake payments). Every recorded scene carries the label "Recorded run. Simulated holds. No PayPal
  call." and the footer "PayPal sandbox only. No real money moves." No PayPal call is made, no money moves, and the
  hammer here does not capture anything at PayPal. It is not shown as live.
- The recorded screens are the web app as built in the CI run named below (the pull request merge commit of that
  run); later UI changes on `main` are not in this cut until it is rendered again.
- The numbers on the evidence and status cards are copied from `docs/GATES.md` (run 42558021614 server kill, run
  42575018866 live voice 24 of 24 synthetic clips, run 42563147792 latency, G3 and G5 status). Both latency targets were
  missed and the card says so.
- The Judge API card types the real calls and the real answers of a keyed local run; the key is a throwaway value that
  never appears, and tokens are cut.
- Not shown, on purpose: the hosted PayPal sandbox hold and capture (the sandbox buyer login must not be on screen),
  the voice replay, and the APIMatic SDK (not generated).

## Shot list and timecodes

| Start  | Length | Scene      | Source                                      | Shows                                                                                                                                             |
| ------ | ------ | ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00.0 | 5.0 s  | `title`    | Card                                        | Logo animation, then the promise: every bid is a hold, the hammer is the payment.                                                                 |
| 0:05.0 | 8.4 s  | `problem`  | Card                                        | Three lines: charge first and bidders hold back, leave bids unsecured and winners walk away, shout bids on paper and the record is hard to trust. |
| 0:13.4 | 5.3 s  | `try`      | Recorded run (local stack, simulated holds) | A judge opens `/try` and starts a sandbox room with one tap.                                                                                      |
| 0:18.7 | 5.5 s  | `hub`      | Recorded run (local stack, simulated holds) | The room hub: the join code and the join ticket QR.                                                                                               |
| 0:24.2 | 8.0 s  | `joinA`    | Recorded run (local stack, simulated holds) | Phone A types the room code on the landing page and joins as a bidder.                                                                            |
| 0:32.2 | 13.0 s | `holdA`    | Recorded run (local stack, simulated holds) | Phone A picks a ceiling and holds the approve button for 3 seconds. The hold is held, not charged.                                                |
| 0:45.2 | 7.0 s  | `joinB`    | Recorded run (local stack, simulated holds) | Phone B joins from the link the QR holds and gets its own hold.                                                                                   |
| 0:52.2 | 4.5 s  | `open`     | Recorded run (local stack, simulated holds) | The auctioneer console opens the lot.                                                                                                             |
| 0:56.7 | 10.0 s | `bids`     | Recorded run (local stack, simulated holds) | Bids arrive from both phones. Phones, big screen and console show the same price.                                                                 |
| 1:06.7 | 9.5 s  | `hammer`   | Recorded run (local stack, simulated holds) | The hammer is held for 3 seconds in the console, then the lot is sold.                                                                            |
| 1:16.2 | 3.2 s  | `sold`     | Recorded run (local stack, simulated holds) | The big screen names the winner.                                                                                                                  |
| 1:19.4 | 7.4 s  | `receipt`  | Recorded run (local stack, simulated holds) | A receipt for the winner (with share link and QR) and for the bidder whose hold was released.                                                     |
| 1:26.8 | 10.0 s | `verify`   | Recorded run (local stack, simulated holds) | The Verify page: a real ledger export of the room is pasted and the chain verifies; one entry is edited and the chain is marked broken.           |
| 1:36.8 | 12.5 s | `evidence` | Card, numbers from docs/GATES.md            | Kill survived, live voice 24 of 24, ledger verified, latency numbers with both misses stated.                                                     |
| 1:49.3 | 7.5 s  | `lab`      | Recorded run (local stack, simulated holds) | The ledger lab (AG Grid): a 30 day simulated ledger; one entry is edited and its row is marked.                                                   |
| 1:56.8 | 8.5 s  | `api`      | Card, real answers of a local run           | The Judge API: create a room, bid, read the ledger, typed from a real run (tokens cut).                                                           |
| 2:05.3 | 4.5 s  | `docs`     | Recorded public docs site                   | The docs page that explains each call.                                                                                                            |
| 2:09.8 | 8.2 s  | `status`   | Card, from docs/GATES.md                    | What is still open: G3 in progress, G5 partial, sandbox only.                                                                                     |
| 2:18.0 | 6.0 s  | `credits`  | Card                                        | Built by Harsh Bhanushali and Dhairya Patel, the three links, sandbox note.                                                                       |

## Captions

The burned-in captions and the SRT are the same text. Every line stays on screen for 2.5 seconds or more.

| #   | Time             | Shown for | Text                                                                                                                                                      |
| --- | ---------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:01.2 to 0:05.0 | 3.8 s     | GAVEL. Every bid is a hold. The hammer is the payment.                                                                                                    |
| 2   | 0:05.7 to 0:08.3 | 2.6 s     | Charge a card up front, and bidders hold back.                                                                                                            |
| 3   | 0:08.3 to 0:10.9 | 2.6 s     | Leave bids unsecured, and winners walk away.                                                                                                              |
| 4   | 0:10.9 to 0:13.4 | 2.5 s     | Shout bids on paper sheets, and the record is hard to trust.                                                                                              |
| 5   | 0:13.8 to 0:18.4 | 4.6 s     | A judge opens /try. One tap starts a sandbox room.                                                                                                        |
| 6   | 0:19.0 to 0:23.9 | 4.9 s     | A join code and a ticket QR.                                                                                                                              |
| 7   | 0:24.5 to 0:31.9 | 7.4 s     | A bidder types the code. Or scans the ticket QR.                                                                                                          |
| 8   | 0:32.5 to 0:38.2 | 5.7 s     | Pick a ceiling. The most this bidder may bid.                                                                                                             |
| 9   | 0:38.2 to 0:42.0 | 3.8 s     | Hold the button 3 seconds.                                                                                                                                |
| 10  | 0:42.0 to 0:44.9 | 2.9 s     | Held, not charged.                                                                                                                                        |
| 11  | 0:45.5 to 0:51.9 | 6.4 s     | A second phone joins from the QR link.                                                                                                                    |
| 12  | 0:52.5 to 0:56.4 | 3.9 s     | The auctioneer opens the lot.                                                                                                                             |
| 13  | 0:56.7 to 0:60.0 | 3.2 s     | Bids arrive from the phones.                                                                                                                              |
| 14  | 0:60.0 to 1:03.1 | 3.1 s     | Prices only go up.                                                                                                                                        |
| 15  | 1:03.1 to 1:06.4 | 3.3 s     | Every screen agrees.                                                                                                                                      |
| 16  | 1:07.0 to 1:13.4 | 6.4 s     | Hold the hammer 3 seconds. No accidental sales.                                                                                                           |
| 17  | 1:13.4 to 1:15.9 | 2.5 s     | Sold.                                                                                                                                                     |
| 18  | 1:16.4 to 1:19.1 | 2.6 s     | The big screen names the winner.                                                                                                                          |
| 19  | 1:19.7 to 1:23.6 | 3.9 s     | A receipt for every bidder.                                                                                                                               |
| 20  | 1:23.8 to 1:26.5 | 2.6 s     | With a share link and a QR.                                                                                                                               |
| 21  | 1:27.1 to 1:30.8 | 3.7 s     | Paste a ledger export.                                                                                                                                    |
| 22  | 1:30.8 to 1:33.8 | 2.9 s     | Chain verified.                                                                                                                                           |
| 23  | 1:33.8 to 1:36.5 | 2.7 s     | Edit one entry. The chain marks it broken.                                                                                                                |
| 24  | 1:37.4 to 1:40.4 | 3.0 s     | Kill survived. A real server kill during settlement, on the PayPal sandbox: one capture, two holds voided, a ledger of 19 entries that verifies.          |
| 25  | 1:40.4 to 1:43.4 | 3.0 s     | Live voice 24 of 24. Both speech providers answered 24 of 24 synthetic clips through the live socket. No bid accepted without a confirm.                  |
| 26  | 1:43.4 to 1:46.4 | 3.0 s     | Ledger verified. Every bid joins a hash chain. Anyone can check it again, and an edited entry is marked.                                                  |
| 27  | 1:46.4 to 1:49.3 | 2.9 s     | Latency, honestly. Hammer to captured p95 3.8 s against a 2.5 s target. Hammer to settled p95 6.9 s against 6 s. Both missed.                             |
| 28  | 1:49.6 to 1:53.8 | 4.2 s     | The ledger lab. A 30 day simulated ledger in an AG Grid table.                                                                                            |
| 29  | 1:53.8 to 1:56.5 | 2.6 s     | Edit one entry and the chain marks it.                                                                                                                    |
| 30  | 1:57.3 to 2:05.3 | 8.0 s     | A key. HTTP. JSON. Create a room, bid and read the ledger from the Judge API.                                                                             |
| 31  | 2:05.6 to 2:09.5 | 3.8 s     | The docs list every call.                                                                                                                                 |
| 32  | 2:10.4 to 2:12.9 | 2.5 s     | G3 in progress. The honor-period probe is still timing. The final reading is about 12 Nov.                                                                |
| 33  | 2:12.9 to 2:15.4 | 2.5 s     | G5 partial. Speech is measured on synthetic, noise-free audio only.                                                                                       |
| 34  | 2:15.4 to 2:18.0 | 2.6 s     | Sandbox only. No real money moves.                                                                                                                        |
| 35  | 2:19.5 to 2:24.0 | 4.5 s     | Built by Harsh Bhanushali and Dhairya Patel. gavel.dualmindlab.tech. docs.gavel.dualmindlab.tech. github.com/harshbhx/gavel-auction. PayPal sandbox only. |

## How it is made

Everything runs in GitHub Actions (nothing is rendered on a laptop):

1. [`silent-video.yml`](../../../.github/workflows/silent-video.yml) builds the web app against a local server
   (judge rooms on, simulated holds, fake payments, memory store, no secrets) and starts a second keyed server for the
   API card.
2. [`graphics/motion-silent/record.mjs`](../../../graphics/motion-silent/record.mjs) drives six browsers (host, two
   phones, console, big screen, docs) with Playwright, records each with a Chrome screencast on one shared clock, and
   draws an eased cursor in the page. It writes `meta.json` with the named moments (press, release, verify, ...).
3. [`graphics/motion-silent/compose.mjs`](../../../graphics/motion-silent/compose.mjs) turns the screencasts into
   24 fps streams, renders the type cards on the shared motion runtime (`graphics/motion-devpost/runtime.js`), lays
   panes on a printed-broadside plate, animates the captions, and encodes with ffmpeg.
   [`story.mjs`](../../../graphics/motion-silent/story.mjs) holds the scene order, panes and caption text;
   [`cards.mjs`](../../../graphics/motion-silent/cards.mjs) the cards.

To re-render: run the `silent-video` workflow (Actions tab, "Run workflow", branch `main` once the workflow is merged).
Leave `raw_run` empty to record again, or give the run id of an earlier run to only compose from its `silent-raw`
artifact (use this after a caption or card change). The `silent-video` artifact holds the MP4, WebM, poster, SRT,
`timeline.json`, `report.txt` (warnings, caption times) and contact sheets every 3 seconds (`contact-*.png`).
The run that produced these files: https://github.com/harshbhx/gavel-auction/actions/runs/42688324630

## Adding a voice-over later

1. Read `gavel-silent-cut.en.srt`; each caption is already a short line. The cards carry their own text, so the voice
   can follow the SRT line by line.
2. Record your own narration (about 130 words a minute or slower). Do not use music or third-party audio.
3. Mux it without re-encoding the picture: `ffmpeg -i gavel-silent-cut.mp4 -i voice.wav -map 0:v -map 1:a -c:v copy -c:a aac -shortest out.mp4`.
4. Upload the SRT to YouTube so the captions are real captions, not only burned in.
