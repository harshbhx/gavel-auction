# GAVEL launch film: storyboard

A 2:45 launch film of GAVEL for the PayPal Hackathon 2026 judges (the brief: 2:30 to 3:00). 1920x1080, 60 fps,
no voice and no audio track; every line is on screen. It is rendered in GitHub Actions from a recording of the real web app
(`launch-film.yml`, see "Production"). Built by Harsh Bhanushali and Dhairya Patel, who are credited in the
intro, at the hook and in the outro.

## What the research said, and what we take from it

Sources: a 2026 study of 149 tech product films (advids.co), Basement Studio on the Vercel Ship film,
Motionographer on Apple "Don't Blink", Offmenu on the Arc launch film, Field.io on the Stripe motion system.
No breakdown of a Linear film exists in public, so Linear's films were studied directly for their language
(flat planes of real UI, slow dolly-ins, mono captions, one accent).

| Finding                                                                                                                                                         | What the film does                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Median product film is 1:11; the product appears at ~16 % and the "result shot" at ~48 %. 58 % open on a title or type, 66 % end on a logo.                     | At 2:45 the film needs chapters: 17 scenes of 4.5 to 15 s, each with one idea. The first real UI is at 0:31 (19 %), the "Held, not charged" reveal at 0:58 (35 %), the strongest proof at 2:07 (77 %). Opens on type, ends on the lockup. |
| Vercel Ship: storyboard, animatic, preview renders; shots were added or trimmed after seeing the renders.                                                       | Three review checkpoints: this storyboard, the first CI render (contact sheets), the final cut.                                                                                                                                           |
| Arc: repetition of the one idea in different words; 90 % use-case demo, not a feature list.                                                                     | One sentence, "Every bid is a hold, the hammer is the payment", is said four ways (title, idea, reveal, settle). Everything else is the real room being used.                                                                             |
| "Don't Blink": short words, one at a time, held at reading speed; motion that enacts the meaning; one move into depth, then flat again; a hard stop at the end. | Display type is one or two words a line; "hold" presses down, "up" rises, "broken" splits. One depth move only (the dolly into the hold button). The film ends on a held frame, not a fade.                                               |
| Silent films need captions that interpret the screen, 0.35 s a word plus a 1 s hold, and a rhythm the eye can feel.                                             | Every caption stays 2.5 s or longer. An invisible metronome at 40 bpm (1.5 s) sets scene lengths and the moment each cut lands.                                                                                                           |
| Camera: zoom to a readable crop, move the cursor slowly, do not show a whole dashboard where the key field is unreadable.                                       | Recorded panes are put on a flat plane and the camera dollies in 4 to 8 % over a scene; the key moments (ceiling, hold button, hammer, chain badge) get a macro crop. Device frames only on the phones, to say "this is a phone".         |
| Proof: real field names, real ids, timestamps; caveats stated flatly where the claim is made, not hidden in the end card.                                       | The evidence scene uses the numbers of `docs/GATES.md` with the run ids; misses are on the same card; the voice beat and the settle diagram carry their "simulated" and "synthetic" labels in frame.                                      |
| One accent, warm grade, grain only if it unifies; no gradients, stock 3D, particles, blur transitions or a third typeface.                                      | Paper `#efe6d3`, ink `#1d1712`, orange `#ff6a1f` only; Big Shoulders Display, Public Sans, JetBrains Mono (the app's fonts). Cuts and wipes along hairlines; no dissolves.                                                                |

## Visual system

- Two worlds. **Ink** (dark) for the argument: cold open, title, problem, voice, settle, proof, judges, open
  items, outro. **Paper** (light) for the product: every recorded chapter. Each change of world is a wipe along
  a hairline or a mallet strike with its rings; the strike is the film's beat, the only recurring motion.
- The GAVEL motion language of the brand kit (mallet G strike, letters rise, rings leave the strike, hairlines
  that draw themselves, type that rises out of a clipped line). No gears, cogs, particles or glows.
- Captions: display type at 74 to 210 px in a fixed column, one orange word per line at most; a mono eyebrow
  (chapter number and name) and a mono source line ("Recorded run. Simulated holds. No PayPal call.") on
  every recorded scene; the sandbox footer on every frame.
- Camera over the recording: panes are JPEG frames of the real app on one shared clock (the `silent-video`
  recorder). The composer places them on a plane, eases a slow dolly-in, and cuts to macro crops on named
  events (`holdA.press`, `bids.first`, `hammer.released`, `verify.broken`). Phone panes sit in a thin ink
  device frame with rounded corners; desktop panes sit on a hairline plate with a label.
- Graphic overlays tied to recorded events: a 3 s ring that fills while the hold or hammer button is pressed; a
  bid ladder that climbs with each accepted bid; hold tiles (name, ceiling) that persist from the hold chapter
  into the settle diagram, where they become CAPTURE and VOID.
- Rhythm: 40 bpm. Scenes are multiples of 1.5 s; the main caption of a scene lands on a beat; hard cuts
  everywhere except the two wipes and the strikes.

## Scene list

Timecodes are the plan; the composer prints the real ones to `timeline.json` and `report.txt`. World: I = ink,
P = paper. Source: card = type and graphics only; shot = the recorded app (local CI stack, judge room, simulated
holds, no PayPal call), always labelled.

| #   | Start  | Len    | Id      | World | Source                                      | Picture                                                                                                                                                                                                                                                                                                                                                    | On screen                                                                                                                                                                                                                                                                              |
| --- | ------ | ------ | ------- | ----- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:00.0 | 4.5 s  | cold    | I     | card                                        | Ink. One mono line types itself with a blinking cursor; a second replaces it. At 3.3 s the mallet G strikes in the dark and two orange rings leave the strike.                                                                                                                                                                                             | A bid is a promise. / Most bids cost nothing. / (mono, bottom) A film by Harsh Bhanushali and Dhairya Patel                                                                                                                                                                            |
| 2   | 0:04.5 | 7.5 s  | title   | I     | card                                        | The lockup, reversed on ink, at 1.6x: the G ring draws, the mallet swings and strikes, G A V E L rise one by one, rings spread. A hairline draws; two display lines rise.                                                                                                                                                                                  | GAVEL / Every bid is a **hold.** / The hammer is the payment. / (mono) PayPal Hackathon 2026. Sandbox only.                                                                                                                                                                            |
| 3   | 0:12.0 | 9.0 s  | problem | I     | card                                        | Three numbered lines, 3 s each, each with one enacted motion: a price $200 counts up then the line sinks ("hold back"); a bid row slides off the right edge ("walk away"); a hairline tears in two ("hard to trust").                                                                                                                                      | 01 Charge a card up front, and bidders **hold back.** / 02 Leave bids unsecured, and winners **walk away.** / 03 Shout bids on paper, and the record is **hard to trust.**                                                                                                             |
| 4   | 0:21.0 | 10.5 s | idea    | I→P   | card                                        | Wipe to paper along a hairline. The mechanism drawn live: a ceiling bar HOLD $50 fills; three bids rise under it as ticks ($10, $15, $20); the hammer tick; the bar splits into CAPTURE $20.00 (orange) and the rest falls away as RELEASED.                                                                                                               | Authorize a **ceiling.** / Bid **under** it. / Capture only the **winner.** / Release the rest. / (mono) Orders v2 intent AUTHORIZE. Payments v2 capture with final_capture, void.                                                                                                     |
| 5   | 0:31.5 | 9.0 s  | open    | P     | shot `try`, `hub`                           | Chapter 01 Open. The judge page `/try` on a plate, a slow dolly onto "Start a sandbox room" as the cursor presses it. Hard cut to the room hub; macro on the join code flaps and the ticket QR.                                                                                                                                                            | 01 Open / A judge opens **/try.** / One tap, one sandbox room. / A **join code** and a ticket QR.                                                                                                                                                                                      |
| 6   | 0:40.5 | 9.0 s  | join    | P     | shot `joinA`                                | Chapter 02 Join. Phone A in a device frame, the hub beside it at half size. The code is typed; the phone lands on the join page and the name field.                                                                                                                                                                                                        | 02 Join / A bidder types the **code.** / Or scans the ticket QR.                                                                                                                                                                                                                       |
| 7   | 0:49.5 | 13.5 s | hold    | P     | shot `holdA`                                | Chapter 03 Hold. Phone A large; macro on the ceiling choices, then the dolly (the film's one depth move) onto the approve button. A 3 s orange ring fills around the button while it is pressed (`holdA.press` to `holdA.released`). On release the type presses down: Held, not charged. A hold tile "ASHA. HOLD $50" slides to the right rail and stays. | 03 Hold / Pick a **ceiling.** / Hold the button **3 seconds.** / **Held,** not charged. / (mono) Simulated hold in this recording. Real sandbox holds proven in G1 and G2.                                                                                                             |
| 8   | 1:03.0 | 15.0 s | bid     | P     | shot `open`, `bids`                         | Chapter 04 Bid. The console opens the lot (3 s, dolly on "Open lot"), the second tile "BEN. HOLD $50" joins the rail (Ben joined from the QR link). Then phone A, phone B and the big screen; the bid ladder on the right climbs with each accepted bid (`bids.first`, `.second`, `.third`): $10 → $15 → $20, leading paddle named.                        | 04 Bid / The auctioneer **opens the lot.** / **Bids** arrive from the phones. / Prices only go **up.** / Every screen **agrees.**                                                                                                                                                      |
| 9   | 1:18.0 | 9.0 s  | voice   | I     | card                                        | A waveform draws across the ink (illustration, labelled), the transcript types under it, the parser lifts amount and paddle, the confirm card appears. Nothing is accepted before the confirm.                                                                                                                                                             | Or **say** it. / "three fifty for paddle twelve" / amount 350.00 · paddle 12 / Did you mean $350 for paddle 12? Confirm. / (mono) Illustration. Speech measured on 24 synthetic clips only. G5 partial. No bid without a confirm.                                                      |
| 10  | 1:27.0 | 12.0 s | hammer  | P     | shot `hammer`, `sold`                       | Chapter 05 Hammer. Console on a plate, dolly on the hammer dialog; the 3 s ring fills while "Hold to hammer" is pressed; on `hammer.released` the type lands: Sold. Hard cut to the big screen naming the winner.                                                                                                                                          | 05 Hammer / Hold the **hammer** 3 seconds. / No accidental sales. / **Sold.** / The big screen names the winner.                                                                                                                                                                       |
| 11  | 1:39.0 | 9.0 s  | settle  | I     | card                                        | The two hold tiles return on ink. Asha's becomes CAPTURE $20.00 of a $50 hold (orange sweep, final_capture); Ben's becomes RELEASED. A journal line writes under each.                                                                                                                                                                                     | Capture only the **winning price.** / Release every other hold. / (mono) Simulated in this recording. Real sandbox capture, remainder release and void proven in G1 and G4, docs/GATES.md.                                                                                             |
| 12  | 1:48.0 | 7.5 s  | receipt | P     | shot `receipt`                              | Chapter 06 Receipt. Two phones side by side, the winner's receipt and the released bidder's; macro on the share QR.                                                                                                                                                                                                                                        | 06 Receipt / A **receipt** for every bidder. / With a share link and a QR.                                                                                                                                                                                                             |
| 13  | 1:55.5 | 12.0 s | verify  | P     | shot `verify`                               | Chapter 07 Verify. The Verify page; the real ledger export of this room is pasted; "Check the chain"; macro on the badge: Chain verified. One entry is edited; the badge turns: Chain broken, and the display word splits in two.                                                                                                                          | 07 Verify / Paste a ledger **export.** / Chain **verified.** / Edit one entry. / Chain **broken.**                                                                                                                                                                                     |
| 14  | 2:07.5 | 12.0 s | proof   | I     | card, numbers from docs/GATES.md            | Four rows, counters tick up with tabular figures, run ids in mono. The fourth row states both latency misses in the same type size as the wins.                                                                                                                                                                                                            | Kill survived: 1 capture, 2 voids, 19 entries verify (run 42558021614) / Live voice 24 of 24 synthetic clips (run 42575018866) / Webhooks 6 of 6 verified on the sandbox (run 41947655945) / Latency, honestly: p95 3.8 s vs 2.5 s target, 6.9 s vs 6 s. Both missed (run 42563147792) |
| 15  | 2:19.5 | 12.0 s | judges  | I+P   | shot `key`, `docs`; card (real API answers) | For judges. Left, ink: the terminal types the real calls of a keyed local run (`x-judge-key: $KEY`, tokens cut). Right, paper: the `/try` key field takes a key as dots (password field), Unlock, "Judge key accepted"; then the docs page with the Try-it panel. The key never appears.                                                                   | For **judges.** / One shared key, in the Devpost testing instructions. / No key needed for /try. / gavel.dualmindlab.tech/try · docs.gavel.dualmindlab.tech                                                                                                                            |
| 16  | 2:31.5 | 6.0 s  | open    | I     | card, from docs/GATES.md                    | Three short rows.                                                                                                                                                                                                                                                                                                                                          | What is still open / G3 in progress: the honor-period probe reads about 12 Nov. / G5 partial: synthetic, noise-free audio only. / Sandbox only. No real money moves.                                                                                                                   |
| 17  | 2:37.5 | 7.5 s  | outro   | I     | card                                        | The lockup strikes once more, the names rise, three link rows draw, the sandbox line. The last 1.5 s are a held frame; the film stops, it does not fade.                                                                                                                                                                                                   | Built by **Harsh Bhanushali** and **Dhairya Patel.** / gavel.dualmindlab.tech / docs.gavel.dualmindlab.tech / github.com/harshbhx/gavel-auction / PayPal sandbox only. G3 in progress, G5 partial.                                                                                     |

Total 2:45.0 (165 s), inside the 2:30 to 3:00 window; the composer warns outside it. The joinB and ledger-lab scenes of the
silent cut are folded away (Ben's hold appears as a tile; the verify page covers the chain).

## Honesty rules of the cut

- Every recorded scene carries "Recorded run. Simulated holds. No PayPal call." and the sandbox footer. The
  recording is the web app at the merge commit of the CI run, against a local server (judge rooms, simulated
  holds, fake payments, memory store, no secrets).
- The voice scene is an illustration and says so in frame; the only voice numbers are the 24 synthetic clips of
  `docs/GATES.md` (G5 PARTIAL).
- The settle diagram is drawn, not recorded, and says in frame that capture, remainder release and void are
  proven on the sandbox in G1 and G4, while this recording's holds are simulated.
- Proof numbers and run ids are copied from `docs/GATES.md`; both latency misses are stated. G3 reads IN
  PROGRESS until its final reading (about 12 Nov); if the film is re-rendered after it closes, the row changes.
- The judge beat shows the key field as a password field (dots) and the terminal uses `$KEY`; the throwaway
  key of the CI run is generated in the job, masked in the log and destroyed with the runner. The shared judging
  key lives only in the Devpost testing instructions and is never in the repository or the film.
- Not shown: a PayPal login, the hosted sandbox capture, the APIMatic SDK.

## Tooling

Chosen after a search of skills.sh, GitHub and npm for motion-design and video tooling (installed and read in the agent's
scratch directory, nothing heavy on the VM):

- **Remotion** (`remotion`, `@remotion/cli`, `@remotion/fonts`) renders the film: every frame is a pure function of the
  frame number, so the cut is deterministic and the renderer waits for every recorded JPEG before it captures a frame;
  it renders scenes on several threads and encodes H.264 itself. The official agent skill `remotion-dev/skills`
  (remotion-best-practices: markup, fonts, images, calculateMetadata, transitions, rendering) was read and followed.
  Remotion is free for individuals and companies of up to three people; GAVEL is two people. It is installed as its own
  package under `graphics/motion-film/` (own lockfile, installed only in the workflow), so the monorepo and its other
  CI jobs are untouched.
- **Motion craft skills** read and applied: iart-ai `motion-art-direction` (one motion language: easing family, base
  unit, transition family, hierarchy, restraint), `animation-principles` (ease-out entrances, ease-in exits, the 1/3
  rules), `kinetic-typography` (line masks, stagger 60 to 100 ms, cap reveals near 0.8 s), `shot-composition` (one
  camera move per beat, 12-column grid, thirds, safe areas), `logo-animation` (one technique, settle on the beat),
  HeyGen `hyperframes/motion-graphics` and `thelobbi/text-animations` for type rhythm. GSAP and Lottie were considered
  and not used: GSAP is a realtime web timeline and Lottie needs After Effects sources; both would sit on top of the
  same frame-exact render anyway.

Motion language of this film (the spec every scene obeys): personality Corporate/Premium (fintech: deliberate, no
overshoot); entrance easing `cubic-bezier(0.16, 1, 0.3, 1)`, exit `cubic-bezier(0.7, 0, 0.84, 0)`, camera
`cubic-bezier(0.65, 0, 0.35, 1)`; base unit 0.4 s (micro 0.2, enter 0.4, big move 0.8, camera 1.2 to 1.6); one
transition family (hard cut, plus two hairline wipes and the mallet strike); stagger 80 ms top to bottom; hold at least
0.3 s after every landing; one hero per frame.

## Production

- Recording: `graphics/motion-silent/record.mjs`, shared with the silent cut, plus one new shot `key` (the `/try` key
  field) recorded before `try`, and element rectangles (`meta.rects`) for the camera targets. The recorder's output
  (`silent-raw` artifact: JPEG frames per actor with wall-clock timestamps, `meta.json` with shot marks, events and
  rects, `api.json` with the real answers of the keyed run) is reused by both films; `launch-film.yml` takes a
  `raw_run` input to compose from an earlier recording.
- Composition: `graphics/motion-film/` is a Remotion project. `compose.mjs` (Node) reads the recording, resolves the
  scene timings (speeds, camera targets, event times, captions) into `props.json`, links the recording, fonts and brand
  SVGs into `public/`, renders the `Film` composition with `npx remotion render`, then writes the poster, SRT,
  `timeline.json`, contact sheets and `report.txt`, and re-encodes with a bitrate cap if the MP4 passes 48 MB. Outputs:
  MP4 (under 50 MB), poster PNG, SRT, timeline, contact sheets, report; WebM on request.
- Workflow: `.github/workflows/launch-film.yml`, `workflow_dispatch` only, inputs `raw_run`, `fps` (60, or 30 for a
  quick pass), `record_only`, `webm`. The recording steps live in the composite action `.github/actions/record-ui`,
  shared with `silent-video.yml`.
- Review checkpoints: (1) this storyboard, (2) the first CI render with contact sheets, (3) the final cut committed to
  `brand/video/launch-film/`.
