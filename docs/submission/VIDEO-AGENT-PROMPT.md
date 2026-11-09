# Prompt for the GAVEL video agent

Copy everything below the line into the video agent. It is self-contained: the agent needs only this text and read access to the public repository. Written 8 Nov 2026. If the repository and this prompt disagree, the repository wins, and `docs/GATES.md` wins over everything on what is proven.

---

You are making the 3-minute demo video for **GAVEL**, a project entered in the PayPal Hackathon 2026 on Devpost. The video is uploaded to YouTube and linked from the Devpost entry. Judges may watch only the video, so it has to explain the project, show it working, and be honest about what is and is not proven.

## 0. Source of truth

The repository is https://github.com/harshbhx/gavel-auction (public, MIT). Clone it and read it before you write or record anything. Do not rely on memory or on this prompt for facts that the repo states. Never invent a number, a result, a user, a testimonial or a logo.

Read these files in this order:

1. `README.md`: the promise, the status list, the judge entry points.
2. `docs/GATES.md`: the six PayPal sandbox gates and their exact status. Every claim in the video must match this file.
3. `docs/LIMITATIONS.md`: what is not done yet. The closing of the video states some of this.
4. `docs/JUDGES.md` and `docs/judges/TRUST-FAQ.md`: what judges can click and how to read the labels.
5. `brand/devpost/DESCRIPTION.md` and `FIELDS.md`: the Devpost story and fields, with the real-versus-simulated table.
6. `docs/submission/VIDEO-SCRIPT.md`: the earlier shot list that this prompt builds on (timings, source labels, the label sheet).
7. `docs/submission/ARCHITECTURE.md`: the package map and the settlement flow.
8. `docs/DEMO.md` and `docs/DESIGN.md`: the screens, the route names and the visual language.
9. `docs/judges/DEVPOST-TESTING.md` and `docs/judges/SANDBOX-BUYERS.md`: how a judge tests it, and the sandbox buyer rules.
10. `brand/README.md` and `brand/svg/`: the logo and how to use it.
11. `docs/submission/DEVPOST-CHECKLIST.md`: the Devpost rules, what is confirmed and what is not.
12. Docs site pages under `docsite/content/docs/(learn)/how-it-works/` (`money-flow.mdx`, `settlement-saga.mdx`, `engine-and-ledger.mdx`, `voice-and-confirm.mdx`) and `docsite/content/docs/(judges)/judges/real-vs-simulated.mdx`. Live: https://docs.gavel.dualmindlab.tech.

## 1. The project, end to end

**Problem.** At a live auction or fundraiser, two things go wrong. If a card is charged up front, bidders hesitate and bid less. If bids are unsecured, the winner can walk away after the hammer and the organiser chases the money. Shouted bids and paper sheets also make the record hard to trust. We do not quote a non-payment rate because we have no data we can stand behind. Do not say one.

**Idea.** Every bid is a PayPal hold. The hammer is the payment.

- A bidder registers and approves a ceiling (the most they may bid) as a PayPal AUTHORIZE hold. It is a promise, not a charge.
- A deterministic engine runs an ascending English auction with a minimum increment and a soft close. A bid above a bidder's ceiling is refused.
- At the hammer GAVEL captures only the winning price from the winner's hold. Every other hold is voided or released. Nothing is charged before the capture.
- Settlement is a journaled saga built to resume after a crash without a second capture. If PayPal's answer to a capture is unknown, it stops for review instead of guessing.
- Every accepted bid goes into a hash-chained ledger. Anyone holding the export can re-verify it. A receipt is minted after the hammer, with a share link, a QR code and a print layout.
- Bids can be typed, scanned from a QR code, or spoken. A spoken bid becomes a structured bid and always goes through a confirm prompt ("Did you mean 350 for paddle 12?"). The parser never decides a winner and never moves money.

**How it is built.** A TypeScript monorepo (Node 22) with seven packages: engine (rules and ledger), payments (PayPal Orders v2 and Payments v2, hold service, settlement saga, webhook verification, a fake PayPal for tests), server, voice, web, shared, e2e. Hosted shape for the diagram: browser, then a Cloudflare Worker (web app), then the API on Render, then the PayPal sandbox (Orders, Payments, Webhooks), with the ledger and audit trail beside the API and a receipt at the end. The API custom domain https://api.gavel.dualmindlab.tech is planned and pending DNS: do not show it as live. The working API address is the Render one in `README.md`.

**The PayPal hold and capture story (say it plainly).** Authorize a ceiling, hold it while bidding, capture the winning price with `final_capture`, and the rest of the hold is released. Real sandbox evidence: authorize 500, capture 350 with final_capture, and the authorization then reads CAPTURED (gate G1). The release of the remainder is inferred from that state and from PayPal's answer to a later void (422 PREVIOUSLY_CAPTURED), not read from a buyer balance. Say "released" only with that honesty in the notes, or say "the authorization closes at the capture".

**Trust.** Hash-chained ledger and verification on replay, audit and receipt screens; idempotent handlers; six real PayPal webhooks verified; evidence files committed under `docs/evidence` with recorded checksums and tokens, emails and payer ids redacted.

**What the judges experience.** The judge panel at `/try` starts a short live sandbox room with no operator key, or plays a scripted recorded room at `/demo/scripted` with no login. The roles are the auctioneer console, the big screen, the bidder phone and the audit trail.

**Evidence and honest limits (these must appear in the video).**

| Item                                                                                 | Status you may state                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 connectivity, G1 partial capture, G2 wallet and guest-card authorize, G4 webhooks | PASS on the real PayPal sandbox                                                                                                                                                         |
| G3 honor period and reauthorize                                                      | a timed sandbox probe in progress, final reading about 12 Nov; no result is claimed                                                                                                     |
| G5 speech accuracy                                                                   | PARTIAL: synthetic, noise-free audio only, every spoken bid confirmed                                                                                                                   |
| Full multi-bidder settlement                                                         | not run end to end on the sandbox; shown on the fake PayPal                                                                                                                             |
| Crash recovery                                                                       | shown on the fake PayPal, plus one in-process crash on the sandbox                                                                                                                      |
| Latency                                                                              | both targets missed on run 42563147792 (n=49, INCOMPLETE): hammer to SETTLED p95 6.9 s against 6 s, hammer to CAPTURED p95 3.8 s against 2.5 s; an earlier n=20 run had 5.6 s and 3.0 s |
| APIMatic SDK                                                                         | not generated yet; only the OpenAPI spec is ready                                                                                                                                       |
| Money                                                                                | PayPal sandbox only. No real money moves.                                                                                                                                               |

**Sponsors and tools (name them only as the repo supports).**

- PayPal: Orders v2, Payments v2 (authorize, capture, void, reauthorize), Webhooks verify-webhook-signature, JS SDK v6, all in the sandbox.
- Render: hosts the API with a persistent disk (see the Render write-up in the docs site).
- AG Grid: used for the ledger, bids and holds tables. Check that the AG Grid ledger PR is merged and live before you show or name it; if it is not, do not mention it.
- APIMatic: only the OpenAPI spec is ready; the generated SDK is pending. Say that, or say nothing.
- Hugging Face: a collection of synthetic datasets and evidence, https://huggingface.co/collections/harshbhx/gavel-evidence-auction-holds-hammer-and-receipts-6af0afebebb37eb4c9184504 . Synthetic by design.

## 2. Length and structure (hard limit 3:00, target 2:50)

Confirm the maximum length on the Devpost rules page; assume 3:00. Do not run over.

| Time      | Beat                    | Content                                                                                                           |
| --------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 0:00-0:05 | Cold open               | Logo sting (3 s, shortened) then the hook line on screen                                                          |
| 0:05-0:25 | Problem                 | Two failures: charge up front, or bids that are never paid                                                        |
| 0:25-0:40 | Idea                    | "Every bid is a PayPal hold. The hammer is the payment." Lifecycle strip: hold, bid, hammer, receipt, verify      |
| 0:40-1:20 | Live demo, judge flow   | `/try`, start a room, console, big screen, bidder joins with a ceiling and the 3-second approve, bids             |
| 1:20-1:40 | Voice and confirm       | Recorded replay of a spoken bid and the confirm prompt, labelled Recorded                                         |
| 1:40-2:05 | The hammer moment       | Hammer, winner captured at the winning price, other holds released, ladder HELD to CAPTURED and RELEASED, receipt |
| 2:05-2:30 | Trust and audit         | Audit trail, ledger verify, evidence lines from `docs/GATES.md`                                                   |
| 2:30-2:50 | Honest status and close | G3 in progress, G5 partial, sandbox only; end card with repo and demo URLs                                        |

If you run over, cut in this order: the voice beat, then the evidence lines, then the second bidder.

## 3. Shot list with exact URLs

Record at 1920x1080, 30 fps, browser zoom 100 to 125 percent, a clean profile with no bookmarks bar, one monitor. Production web: https://gavel.dualmindlab.tech (it answered 200 on 8 Nov 2026 for `/`, `/try` and `/demo/scripted`). If a route or flow behaves differently from this list, trust the app and the repo, and report the difference. The older address https://gavel-web.creharsh.workers.dev serves the same app. Route names below come from `packages/web/src/routes.tsx`.

| #   | Time      | What to record                                                                                                                   | URL                                                                                                                          | Notes                                                                                                 |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | 0:00-0:05 | Logo sting                                                                                                                       | file `gavel-sting-1080p.mp4`                                                                                                 | See assets                                                                                            |
| 2   | 0:05-0:25 | Title cards: "Charge first: bidders hold back", "Bid unsecured: winners walk"                                                    | made from graphics                                                                                                           | No UI needed                                                                                          |
| 3   | 0:25-0:40 | Landing page, heading and the promise, then the lifecycle strip graphic                                                          | https://gavel.dualmindlab.tech/                                                                                              | Point at the sandbox banner                                                                           |
| 4   | 0:40-0:50 | Judge panel, press "Start a demo auction"                                                                                        | https://gavel.dualmindlab.tech/try                                                                                           | If the page says live rooms are off or busy, use shot 4b                                              |
| 4b  | fallback  | Scripted demo, labelled "Scripted demo: recorded events, no PayPal calls"                                                        | https://gavel.dualmindlab.tech/demo/scripted                                                                                 | No login; say it is a recording                                                                       |
| 5   | 0:50-1:00 | Auctioneer console showing the lot and controls                                                                                  | `/r/<roomId>/console` (opened from the room links)                                                                           | The route needs the auctioneer session, so open it from the page that created the room                |
| 6   | 1:00-1:10 | Big screen on a second window                                                                                                    | `/r/<roomId>/screen`                                                                                                         | Show the QR code and the price                                                                        |
| 7   | 1:10-1:20 | Bidder phone view: join, pick a ceiling, press and hold approve for 3 seconds, PayPal sandbox login, hold shows HELD, then a bid | `/join/<roomId>`, `/r/<roomId>/register`, `/r/<roomId>/bid`                                                                  | Use the sandbox buyer from the Devpost testing field; never show the password on screen (blur or cut) |
| 8   | 1:20-1:40 | Spoken bid and confirm prompt                                                                                                    | recorded replay, https://gavel.dualmindlab.tech/replay/<recordingId> if one is hosted, else the repo's recorded audio replay | Label Recorded; synthetic clips only                                                                  |
| 9   | 1:40-2:05 | Press hammer in the console; capture of the winning price; other holds released; receipt                                         | `/r/<roomId>/console`, `/r/<roomId>/receipt`                                                                                 | If the live room fails, show the scripted demo hammer and say it is recorded                          |
| 10  | 2:05-2:20 | Audit trail with the hash-chained ledger, then the verify result                                                                 | `/r/<roomId>/audit` (needs the reviewer link from the room)                                                                  | The ledger table is a grid                                                                            |
| 11  | 2:20-2:30 | Terminal or repo page: `docs/GATES.md` status table and an evidence line, e.g. capture 350 of a 500 hold                         | https://github.com/harshbhx/gavel-auction/blob/main/docs/GATES.md                                                            | Label: Real sandbox evidence                                                                          |
| 12  | 2:30-2:50 | End card with repo, demo and docs URLs and the honest status line                                                                | graphic                                                                                                                      | See assets                                                                                            |

Routes that exist but are not in the main flow: `/demo` (room launcher), `/demo/scripted/join`, `/demo/scripted/bid`, `/r/<roomId>/hub`, `/ops`. Do not show `/ops`.

Recording rules: start one fresh room per take and keep the tab; rooms last about thirty minutes, so record the whole live flow in one sitting. The hosted API can take about 30 seconds to wake after idle: open the site once before recording. Record the live sandbox path first; record the scripted demo as the backup for every live shot.

## 4. Voice-over script with timing

Plain spoken English, a calm confident voice, about 130 words a minute or slower. About 340 words, roughly 2:30 of speech with pauses. Do not add a number unless the repo states it.

| Time      | Voice-over                                                                                                                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:05-0:25 | "At a live auction, bidders hold back when a card is charged first. And when bids are unsecured, winners can walk away. Paper sheets and shouted bids make the record hard to trust."                                                                                                                          |
| 0:25-0:40 | "GAVEL makes every bid a PayPal authorization hold. Every bid is a hold. The hammer is the payment."                                                                                                                                                                                                           |
| 0:40-1:20 | "A judge opens the demo and starts an auction. The auctioneer has a console. The room has a big screen with a QR code. A bidder joins from a phone and approves a ceiling: the most they may bid. It is held, not charged. Bids above the ceiling are refused."                                                |
| 1:20-1:40 | "Bids can also be spoken. A spoken bid becomes a structured bid, and GAVEL asks first when it is ambiguous. This clip is a recording on synthetic audio."                                                                                                                                                      |
| 1:40-2:05 | "Now the hammer. Only the winning price is captured, from the winner's hold. The other holds are released. The receipt shows what happened. If the server stops in the middle of settlement, it resumes with one capture, not two. We show that on our fake PayPal, plus one in-process crash on the sandbox." |
| 2:05-2:30 | "Every accepted bid sits in a hash-chained ledger that anyone can re-verify. These are real sandbox runs: authorize 500, capture 350, and six real webhooks verified."                                                                                                                                         |
| 2:30-2:50 | "GAVEL: PayPal sandbox only, open source, MIT. Two gates are still open, and we say so: the honor-period probe is still running, and voice is measured on synthetic audio only. The code is on GitHub."                                                                                                        |

Check every spoken number against `docs/GATES.md` at recording time; if a gate has changed, change the line.

## 5. On-screen text

Use the app fonts and brand colours (see assets). Lower-thirds are short: one line, minimum 32 px at 1080p, high contrast.

- Persistent corner tag: "PayPal sandbox only. No real money moves."
- Source label on every shot, one of: "Live sandbox", "Scripted demo: recorded events, no PayPal calls", "Recorded: this is a replay", "Fake PayPal, test run", "Real sandbox evidence".
- Step labels in the demo: "1 Hold", "2 Bid", "3 Hammer", "4 Receipt", "5 Verify".
- Final card: "G3 in progress. G5 partial: synthetic speech only." plus https://github.com/harshbhx/gavel-auction and https://gavel.dualmindlab.tech.

## 6. Music and sound

No music is needed; the cut works with none. If you add a track it must be royalty free with a licence you can show, with no Content ID claims. Keep it under the voice, about minus 24 LUFS under a minus 16 LUFS voice. Optional sound: the gavel hit at the hammer (the big screen already plays one after a first click on the page), a soft tick for each hold. Do not use brand audio from PayPal or any third party.

## 7. Assets to use

Do not redraw the logo. Use the files from the repo and the Actions artifacts.

| Asset                                                                                         | Where                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo SVGs (mark, wordmark, lockups; `color` on paper, `reversed` on ink, `plate` on anything) | `brand/svg/` in the repo; usage in `brand/README.md`                                                                                                                         |
| Logo sting, 3 s 1080p30 (`gavel-sting-1080p.mp4`, `.webm`, alpha `.webm` and `.mov`)          | GitHub Actions artifact `brand-sting` of the `brand-assets.yml` workflow (not committed); source `brand/svg/sting.svg`                                                       |
| Brand rasters (favicon, og.png)                                                               | artifact `brand-raster` of the same workflow                                                                                                                                 |
| End card 1920x1080, lower-third, YouTube thumbnail 1280x720                                   | `docs/assets/social/` (pending PR GFX-04; check the folder, and the artifact `graphics-social` of `graphics.yml` if it is not merged)                                        |
| Lifecycle strip, architecture diagram and GIF, hero                                           | `docs/assets/readme/` (pending PR GFX-02)                                                                                                                                    |
| Devpost gallery images                                                                        | `docs/assets/devpost/` and `docs/submission/DEVPOST-IMAGES.md` (pending PR GFX-03)                                                                                           |
| Palette                                                                                       | paper `#efe6d3`, ink `#1d1712`, signal orange `#ff6a1f`; fonts Big Shoulders Display, Public Sans, JetBrains Mono; hard offset shadows and hairlines, no gradients, no glass |

If an asset is missing, say so in your report and use the brand SVGs on a plain paper or ink background. Do not substitute a stock logo.

## 8. Captions and accessibility

- English captions, exactly matching the voice-over. Deliver an `.srt` and upload it to YouTube. Do not rely on auto-captions.
- Burned-in text is a supplement, never the only place a fact appears.
- Contrast AA or better for all overlays. No flashing faster than 3 times a second. The sting must have a still end frame.
- Describe the video in the YouTube description in plain text, with the links below.

## 9. Honesty rules (hard)

Never say or show:

- "fully tested", "production ready", "passed" or "proven" for anything marked partial or in progress in `docs/GATES.md` (G3, G5, whole-auction settlement on the sandbox, latency to captured).
- A live charge, real money, a real customer, a user count, revenue, a testimonial or a metric the repo does not contain.
- Fake PayPal behaviour as if it were the real sandbox. Label it "Fake PayPal, test run".
- A recording as if it were live. Label it.
- The API domain `api.gavel.dualmindlab.tech` as live (pending DNS).
- A generated APIMatic SDK (not generated yet).
- Sandbox buyer passwords, tokens, API keys or emails on screen. Blur or cut. Never put them in the video description.
- PayPal, AG Grid, Render or APIMatic logos as decoration. Name the sponsors in voice or text only where the repo supports the claim.

Positive, confident wording is fine. The honest status line at the end is a strength, not an apology.

## 10. Output formats

Deliver all of these:

1. Master: MP4 (H.264, AAC), 1920x1080, 30 fps, 12 to 20 Mbps, under 3:00 (target 2:50), loudness about -16 LUFS integrated.
2. Captions: `gavel-demo.en.srt` (and a `.vtt`).
3. Thumbnail: 1280x720 PNG or JPG under 2 MB, from `docs/assets/social/`.
4. YouTube title: "GAVEL: every bid is a PayPal hold, the hammer is the payment (sandbox demo)".
5. YouTube description: two plain sentences, the honest status, the links (repo, demo, docs, Devpost), the chapter timestamps for the beats in section 2. No emoji-heavy text.
6. Visibility: public, English, not made for kids, no paid promotion. Check it in a signed-out window.
7. A short report: the links, the length, which shots were live and which were the scripted or recorded fallbacks, any claim you changed because the repo changed, and anything not done.

## 11. Final checklist

- [ ] Read all the files in section 0; the repo is the source of truth.
- [ ] Every claim and number matches `docs/GATES.md` on the day you record.
- [ ] Length is under 3:00.
- [ ] Every shot carries its source label; recordings and the fake PayPal are labelled.
- [ ] "PayPal sandbox only. No real money moves." is visible throughout.
- [ ] G3 and G5 are stated honestly in the close.
- [ ] No secrets, buyer passwords or personal emails on screen or in text.
- [ ] No unlicensed music, no third-party logos.
- [ ] Captions match the voice and are uploaded.
- [ ] Logo is from `brand/`, not redrawn.
- [ ] Thumbnail and end card are from `docs/assets/social/`.
- [ ] The YouTube link is public and opens signed out.
- [ ] Report sent with the link and the list of anything not done.
