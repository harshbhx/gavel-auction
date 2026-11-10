# GAVEL launch film: storyboard

A 2:44 launch film of GAVEL for the PayPal AI Hackathon 2026 judges (the brief: 2:30 to 3:00). Version 2 after
Harsh's review of v1 (more motion, brand-only palette, Stripe/Apple minimalism, rules check, sponsors). 1920x1080, 60 fps,
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

| #   | Start  | Len    | Id        | World | Source                                  | Picture (v2)                                                                                                                                                                                                                                                   | On screen (fewer words, one idea)                                                                                                                                     |
| --- | ------ | ------ | --------- | ----- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:00.0 | 4.5 s  | cold      | I     | card                                    | A mono line types itself, a second replaces it; the mallet G strikes in the dark and two rings leave the strike.                                                                                                                                               | A bid is a promise. / Most bids cost nothing. / (mono) A film by Harsh Bhanushali and Dhairya Patel                                                                   |
| 2   | 0:04.5 | 7.5 s  | title     | I     | card                                    | The lockup strikes, letters rise; the hairline draws out of the ring; two display lines rise with their tracking tightening as they land.                                                                                                                      | GAVEL / Every bid is a **hold.** / The hammer is the payment.                                                                                                         |
| 3   | 0:12.0 | 7.5 s  | problem   | I     | card                                    | Three short rows, 2.3 s apart, each enacted: a price counts to $200 and the row sinks; the second line slides off the edge; the hairline tears. A slow push on the whole block.                                                                                | 01 Charge first, bidders **hold back.** / 02 No hold, winners **walk away.** / 03 Paper sheets, **no proof.**                                                         |
| 4   | 0:19.5 | 10.5 s | idea      | I->P  | card                                    | Wipe to paper. The mechanism drawn live: a ceiling bar fills; bids tick up under it ($10, $15, $20); the hammer line; the winning part turns orange (capture), the rest lifts away (released).                                                                 | A **ceiling.** / Bids **under** it. / Capture the **winner.** / Release the rest.                                                                                     |
| 5   | 0:30.0 | 9.0 s  | open      | P     | shot `try`, `hub`                       | Chapter 01. The judge page on a plate, dolly onto "Start a sandbox room"; hard cut to the hub, macro on the join code and QR. Chapter counter rolls.                                                                                                           | 01 Open / Open **/try.** One tap. One sandbox room. / A **code.** A QR.                                                                                               |
| 6   | 0:39.0 | 7.5 s  | join      | P     | shot `joinA`                            | Chapter 02. Phone A in a device frame, the hub beside it; the code is typed; slow push on the phone.                                                                                                                                                           | 02 Join / Type the **code.** Or scan the QR.                                                                                                                          |
| 7   | 0:46.5 | 13.5 s | hold      | P     | shot `holdA` + **HoldCard** component   | Chapter 03. Left: the hold as an animated brand card: the ceiling rolls $10 -> $50 when the chip is picked, a 3 s press bar fills while the button is held, the HELD stamp lands. Right: phone A, macro on the chips, dolly onto the button with the ring.     | 03 Hold / Pick a **ceiling.** / Hold **3 seconds.** / **Held,** not charged.                                                                                          |
| 8   | 1:00.0 | 15.0 s | bid       | P     | shot `open`, `bids` + **BigScreen**     | Chapter 04. Console opens the lot (dolly on the button). Then phones A and B beside the **big screen rebuilt in the brand**: the price rolls $10 -> $15 -> $20 with a pulse, the ladder stacks, the leading paddle flips. Two hold tiles. No raw navy capture. | 04 Bid / **Open** the lot. / **Bids** arrive. / Only **up.** / Every screen **agrees.**                                                                               |
| 9   | 1:15.0 | 7.5 s  | voice     | I     | card                                    | A waveform draws, the transcript types, two parse chips rise, the confirm card lands and fills.                                                                                                                                                                | Or **say** it. / "three fifty for paddle twelve" / amount 350.00, paddle 12 / Confirm. / (mono) Illustration. 24 synthetic clips only. G5 partial.                    |
| 10  | 1:22.5 | 12.0 s | hammer    | P     | shot `hammer` + **BigScreen**           | Chapter 05. Console, dolly onto the hammer dialog, the 3 s ring; on release: Sold. Cut to the brand big screen: the price turns orange, the ink band rises, SOLD stamp lands, the winner is named.                                                             | 05 Hammer / Hold the **hammer.** 3 seconds. No accidents. / **Sold.** / The screen names the **winner.**                                                              |
| 11  | 1:34.5 | 9.0 s  | settle    | I     | card                                    | The two hold tiles: Asha's sweeps orange and rolls to CAPTURE $20.00, Ben's dims to RELEASED; journal lines type.                                                                                                                                              | Capture only the **winning price.** / Release every other hold. / (mono) Drawn, not recorded. Sandbox capture and void proven in G1 and G4.                           |
| 12  | 1:43.5 | 7.5 s  | receipt   | P     | shot `receipt`                          | Chapter 06. Two phones, the winner's and the released bidder's receipts; dolly onto the share QR.                                                                                                                                                              | 06 Receipt / A **receipt** for everyone. / Share link. **QR.**                                                                                                        |
| 13  | 1:51.0 | 10.5 s | verify    | P     | shot `verify`                           | Chapter 07. Paste the real export, check: macro on Chain verified; edit one entry: Chain broken, the word splits.                                                                                                                                              | 07 Verify / Paste the **export.** / Chain **verified.** / Chain **broken.**                                                                                           |
| 14  | 2:01.5 | 10.5 s | proof     | I     | card, numbers from docs/GATES.md        | Four rows with rolling counters and run ids; both latency misses in the same type size. Slow push.                                                                                                                                                             | Kill survived / Live voice 24 of 24 / Webhooks 6 of 6 / Latency, honestly: 3.8 s vs 2.5 s, 6.9 s vs 6 s, both missed                                                  |
| 15  | 2:12.0 | 10.5 s | judges    | I+P   | shot `key`, `docs`; card (real answers) | Terminal types the real calls (key in $KEY, tokens cut); the paper panel shows the /try key field as dots, Unlock, then the docs Try-it page.                                                                                                                  | For **judges.** / One shared key in the Devpost testing instructions. No key needed for /try. / URLs                                                                  |
| 16  | 2:22.5 | 7.5 s  | builtWith | P     | card, partner marks                     | Built with: the PayPal mark and wordmark (official files, cream background, clear space) with "Payments in the PayPal sandbox. Built for the PayPal AI Hackathon 2026"; Render in type, "API hosted on Render"; a mono line of the other tools.                | Built **with.** / PayPal: payments, sandbox. / Render: API hosting. / (mono) Cloudflare Workers, AG Grid, Deepgram, Groq. Names only, no endorsement implied.         |
| 17  | 2:30.0 | 6.0 s  | openItems | I     | card, from docs/GATES.md                | Three rows.                                                                                                                                                                                                                                                    | What is still open / G3 in progress / G5 partial / Sandbox only                                                                                                       |
| 18  | 2:36.0 | 7.5 s  | outro     | I     | card                                    | The lockup strikes, the names rise, three link rows draw, the sandbox line. Held frame at the end.                                                                                                                                                             | Built by **Harsh Bhanushali** and **Dhairya Patel.** / gavel.dualmindlab.tech / docs.gavel.dualmindlab.tech / github.com/harshbhx/gavel-auction / PayPal sandbox only |

Total 2:43.5 (163.5 s), inside 2:30 to 3:00. Nothing holds still for more than about 1.5 s: every scene has a rolling
counter, a camera push, a stagger or a stamp in flight; the type lines tighten their tracking as they land.

## v2 changes after Harsh's review of v1

- More real motion: brand-built animated components (HoldCard, BigScreen with rolling prices and a stacking ladder,
  stamps), rolling counters, a slow push on every card, tracking that tightens as display lines land, chapter
  counters, the hammer ring, the hold tiles that carry into the settle diagram.
- Brand only: the room's dark projection screen is never shown raw; it is rebuilt as the BigScreen component in
  cream / ink / orange and driven by the recorded bid events. Every other recorded surface (judge page, hub, phones,
  console, verify, docs) is already in the brand palette.
- Minimal: one idea a scene, at most four short display lines, more whitespace, the body copy cut by about half.
- Rules: the Devpost checklist below; sponsors named with official marks where permitted (see "Partner marks").

## Devpost and hackathon rules checklist (paypalaihackathon.devpost.com/rules, read 10 Nov 2026)

| Rule (quoted)                                                                                                                               | This film                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "should be less than three (3) minutes. Judges are not required to watch beyond three minutes"                                              | 2:43.5. The proof, judge and credit beats all sit before 2:40.                                                                                                                                                                                                         |
| "should include footage that shows the Project functioning on the device for which it was built"                                            | Seven chapters are a recording of the real web app on desktop and phone viewports (judge page, hub, phones, console, verify, docs), labelled as a recorded run.                                                                                                        |
| "must be uploaded to and made publicly visible on YouTube and a link ... provided on the submission form"                                   | The MP4 is the YouTube upload; the SRT goes up as captions. Harsh uploads and links it.                                                                                                                                                                                |
| "must not include third party trademarks, or copyrighted music or other material unless the Entrant has permission"                         | No music, no audio track. PayPal's mark is used as the payment acceptance mark of a PayPal integration (official file, unaltered); Render is named in type only, no logo. All other tools are named in type. Switch `SPONSOR_LOGOS=none` to drop the PayPal files too. |
| "All Submission materials must be in English"                                                                                               | English captions throughout.                                                                                                                                                                                                                                           |
| "must function as depicted in the video"                                                                                                    | Only recorded behaviour and `docs/GATES.md` numbers are shown; simulations and illustrations are labelled in frame.                                                                                                                                                    |
| Judging: "Does the video clearly demonstrate the project working end-to-end? ... what problem is solved, who it's for, and why it matters?" | Problem (0:12), idea (0:19), the room end to end (0:30 to 2:01: open, join, hold, bid, hammer, settle, receipt, verify), proof, judges, built with, open items.                                                                                                        |
| Judging: "How thoroughly ... does the project use PayPal Developer Platform and AI tool(s)?"                                                | Orders v2 AUTHORIZE, Payments v2 capture with final_capture and void, webhooks (idea, settle, proof); the voice beat names the speech providers and its limits.                                                                                                        |
| Deadline "Nov 12, 2026 @ 12:00pm PST" (13 Nov 01:30 IST)                                                                                    | Final render on 10 Nov.                                                                                                                                                                                                                                                |

## Partner marks

`brand/partners/README.md` lists the files, sources and the rules followed: PayPal's own SVGs (the ones its JS SDK
serves) on a plain cream background, unaltered, clear space at least the mark's height, a fade and a settle only, and
wording limited to "Payments in the PayPal sandbox. Built for the PayPal AI Hackathon 2026". Render has no public
brand-asset page (render.com/brand is a 404), so Render appears in type as "API hosted on Render". This is Harsh's
call: the composer's `SPONSOR_LOGOS=none` switch renders both names in type.

## References applied (study only; everything is built original in the GAVEL brand)

Studied on 10 Nov 2026: Stripe (stripe.com product pages, Sessions openers, the Field.io motion system), Apple
(product pages and keynote films, "Don't Blink"), Linear (linear.app and its feature films), Vercel (Ship and Next.js
Conf openers, the Basement Studio breakdown), Arc (The Browser Company launch film), Awwwards site-of-the-day winners,
and the Motion One / Lottie easing libraries. Concrete takeaways and where each one lands in this film:

| Reference                            | Takeaway                                                                                                                                                                              | Applied                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple product pages, keynote films   | One idea a frame; huge type on a flat ground; a number or product fills the frame and everything else disappears; type lands with a decelerating ease, never a bounce.                | Display lines at 74 to 210 px, one orange word, `cubic-bezier(0.16, 1, 0.3, 1)` on every entrance; no overshoot anywhere; the problem rows and proof rows are one line each.                          |
| Apple "Don't Blink"                  | Words at reading speed with a hard stop; motion that enacts the word ("hold back" sinks, "walk away" slides off, "no proof" tears the rule); one move into depth and back.            | Problem scene enactments; the single dolly into the hold button at 0:53; the film ends on a held frame, no fade.                                                                                      |
| Stripe product pages                 | UI shown as composed components, not screenshots: cards that build line by line, numbers that roll, a pale plate under live content; tracking tightens as headlines settle.           | HoldCard, BigScreen and the settle tiles are built as animated brand components; prices roll with tabular figures; `Rise` tightens letter-spacing from 0.054 em to 0.004 em as a line lands.          |
| Stripe Sessions openers / Field.io   | One accent colour used only for the live state; a signature element (the wave) that leads, supports or disappears per scene.                                                          | Orange only on the live thing (the held ceiling, the leading bid, the capture, the ring); the mallet strike leads the cold open, supports the title and outro, and is absent in the product chapters. |
| Linear feature films                 | Real UI on a flat plane with slow dolly-ins (about 4 to 8 % over a scene) and macro crops on the control that matters; captions in a fixed column beside the UI; cuts, not dissolves. | Camera pushes of 1.05 to 1.14 on every recorded scene, macro crops on the ceiling chips, the approve button, the hammer dialog and the chain badge; the right-hand caption column; hard cuts only.    |
| Vercel Ship (Basement breakdown)     | Storyboard, animatic, preview renders, then re-cut: preview renders change the story; animate on a visible beat.                                                                      | Three CI renders reviewed from contact sheets before this v2; 40 bpm grid, cuts and stamps on the beat.                                                                                               |
| Arc launch film                      | Say the one idea several ways and spend most of the time on use, not on a feature list.                                                                                               | "Every bid is a hold" in the title, idea, hold and settle scenes; 1:31 of the film is the room in use.                                                                                                |
| Awwwards winners (2025 to 2026)      | Staggered line masks (60 to 100 ms), hairlines that draw themselves, counters, generous whitespace, grain-free flat colour, a chapter index that ticks.                               | Mask reveals everywhere with 70 to 100 ms staggers, `Rule` draws, rolling counters, the chapter tick "03 / 07", flat paper and ink with no gradients or blur.                                         |
| Motion One / Lottie easing libraries | Two curves per project: an ease-out for entrances and an ease-in-out for moves; springs only for interactive UI, never for a timeline.                                                | ENTER `cubic-bezier(0.16, 1, 0.3, 1)`, EXIT `cubic-bezier(0.7, 0, 0.84, 0)`, CAM `cubic-bezier(0.65, 0, 0.35, 1)`; no springs; durations in multiples of 0.4 s.                                       |

Nothing from these references is reused as an asset: no logos, fonts, footage, sounds or layouts are copied; the
brand fonts, colours and the mallet mark are GAVEL's own.

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
