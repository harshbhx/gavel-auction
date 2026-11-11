# Devpost form fields: PayPal AI Hackathon

Single source for the Devpost entry: this file plus `DESCRIPTION.md`. (`docs/submission/DEVPOST.md` is only a pointer here.) Paste order follows the Devpost form. The long text is in [`DESCRIPTION.md`](DESCRIPTION.md) (paste the whole file into "About the project"). Image URLs in it are raw GitHub URLs on `main` under `brand/devpost/description/` (numbered in the order they appear in the text; see [`../CURATION.md`](../CURATION.md)).

Rules source: https://paypalaihackathon.devpost.com/rules (Submission Period 1 Oct 2026 9:15 am PT to Thu 12 Nov 2026 12:00 pm PT).

## Project name

GAVEL

## Tagline (47 characters, limit 60)

Every bid is a hold. The hammer is the payment.

## Elevator pitch (172 characters, limit 200)

A live auction on PayPal holds: bidders hold a ceiling, the hammer captures only the winning price and voids the rest, and a hash-chained ledger anyone can verify seals it.

## About the project

Paste the full content of `brand/devpost/DESCRIPTION.md`. Headings used, in Devpost's order: Inspiration, What it does, How we built it, Challenges we ran into, Accomplishments that we're proud of, What we learned, What's next for GAVEL. Extra subsections: "Try it in 60 seconds" (under What it does), "Evidence before claims" and "AI in the product" (under How we built it), then "Team" and "Try it" at the end. Every image has an italic caption line. The AI section answers the rules item "identify which tools (model or AI service) were used and how".

Markdown used: H2 and H3 headings, bold, bullet lists, inline code, links, images by URL. No tables, no HTML, no fenced code, no strikethrough (Devpost's Markdown tips list tables, fenced code and strikethrough as extended syntax that not every renderer supports).

## Built with (22 tags, limit 25)

typescript, node.js, react, vite, python, paypal, paypal-orders-api, paypal-payments-api, paypal-js-sdk, cloudflare-workers, render, ag-grid, hugging-face, deepgram, groq, websockets, openapi, vitest, playwright, github-actions, next.js, fumadocs

Three spare slots. Add `paypal-webhooks` or `speech-to-text` if you like. Removed from the older list: `cloudflare-pages` (the web app is a Worker with static assets; not confirmed as Pages). `apimatic` is dropped: the portal and SDKs do not exist (see flag 2), so the tag would claim something we do not ship.

## Try it out links

| Label                            | URL                                                            |
| -------------------------------- | -------------------------------------------------------------- |
| Live app: judge panel            | https://gavel.dualmindlab.tech/try                             |
| Scripted demo (about 1 minute)   | https://gavel.dualmindlab.tech/demo/scripted                   |
| Docs                             | https://docs.gavel.dualmindlab.tech                            |
| API reference                    | https://docs.gavel.dualmindlab.tech/api-reference              |
| Call the API as a judge          | https://docs.gavel.dualmindlab.tech/docs/judges/call-the-api   |
| Evidence Explorer (Hugging Face) | https://huggingface.co/spaces/harshbhx/gavel-evidence-explorer |
| GitHub repository                | https://github.com/harshbhx/gavel-auction                      |

The APIMatic developer portal is not listed because https://docs.gavel.dualmindlab.tech/portal returned 404 on 9 Nov. Add it when it is live.

## Code repository URL

https://github.com/harshbhx/gavel-auction (public, MIT `LICENSE` at the root; check the About box shows "MIT license", the rules ask for it to be visible).

## Testing instructions

Paste `docs/judges/DEVPOST-TESTING.md` and fill the two sandbox buyer logins and, optionally, the one shared judge key on Devpost only. Never commit them. The text leads with the keyless path (the scripted demo, then a keyless judge room on /try); the key is optional and only for the HTTP path. Per-judge keys expire on 30 Nov 2026, before judging (1 to 15 Dec), so the shared non-expiring key is the one to paste. The rules require testing access to stay free and unrestricted until the Judging Period ends (1 to 15 Dec 2026, access live until 15 Dec 8:00 am PT), so keep the Render service, the Worker and the sandbox buyers alive until then.

## Demo video (under 3 minutes)

- Rules: under 3 minutes (judges need not watch longer), shows the project working on the device it was built for, public on YouTube, no third-party trademarks or copyrighted music without permission.
- Plan: target 2:50. Script in `docs/submission/VIDEO-SCRIPT.md`. Open with the pitch at the start, show hold, bid, hammer, receipt, then verify the ledger.
- Keep sandbox buyer logins and any key off the screen. Say "PayPal sandbox" aloud once.
- Use no music unless it is yours or licensed. PayPal logos and the sponsor names are third-party marks; keep them to plain text mentions.
- Upload early; YouTube processing can take hours. Add captions.

## Image gallery (upload in this order, JPG/PNG/GIF, 5 MB max, 3:2)

Rule: at most one animated GIF in the gallery (the hero). Every other slide is a static PNG. The description uses animation only where motion adds meaning: banner (intro), how it works, architecture, ledger verify, results (kill survived, voice 24 of 24, chain verifies) and the closing slide (outro). Every other image there is a static PNG. Files are in `brand/devpost/description/`; superseded animated variants are in `brand/archive/devpost-story/`.

All files are in `brand/devpost/gallery/` (1200x800, 3:2, largest 1.4 MB). Thumbnail: `brand/devpost/thumbnail.png` (static).

| #   | File                       | Type         | Caption                                                                                                                                                                                                                        |
| --- | -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 01-hero.gif                | animated GIF | GAVEL is a live auction where every bid is a PayPal authorization hold and only the winner is charged, at the hammer. PayPal sandbox only, no real money. (`01-hero.png` is the static fallback if the GIF is refused.)        |
| 2   | 02-how-it-works.png        | static PNG   | Four moves. A bidder approves a ceiling as a hold, bids in an ascending auction, the auctioneer hammers, and only the winning price is captured while every other hold is released.                                            |
| 3   | 03-architecture.png        | static PNG   | One bid, four hops. The browser reaches a Cloudflare Worker, which reaches the auction API on Render. The API holds and captures with PayPal sandbox and appends every accepted bid to a hash-chained ledger.                  |
| 4   | 04-judge-flow.png          | static PNG   | Try it in two minutes, no login. Open /try, start a room, bid, hammer and read the receipt. /demo/scripted plays a recorded room in your tab in about a minute.                                                                |
| 5   | 05-audit-and-verify.png    | static PNG   | Do not trust, verify. Every accepted bid goes into a hash-chained ledger, and anyone can re-check the public export. The hashes shown are shortened examples.                                                                  |
| 6   | 06-partners.png            | static PNG   | PayPal runs the holds, Cloudflare serves the web app and the docs, Render hosts the API, AG Grid draws the ledger, bids and holds tables, Hugging Face hosts the open evidence.                                                |
| 7   | 07-open-data-and-gates.png | static PNG   | The evidence is open: five small datasets, each with a sha256 manifest and labelled for what it is. Gates G0, G1, G2 and G4 passed on the PayPal sandbox, G3 is a real probe running (final reading 12 Nov) and G5 is tested with synthetic voice clips. |
| 8   | 08-ending.png              | static PNG   | Try it. Verify it. No login. Web app, docs and source links.                                                                                                                                                                   |

The credits outro GIF (`brand/devpost/outro/09-outro-credits.gif`, 1200x800, 0.8 MB, 7 s loop) goes in the description under "Try it", not in the gallery (the gallery takes one GIF, the hero). The older `16-ending.gif` is kept in `brand/archive/devpost-description/` as the fallback.

### Where each GIF goes

`brand/` is the single source: every file below is under `brand/devpost/`, raw URLs are in `DESCRIPTION.md`. Full used and unused list: [`INDEX.md`](INDEX.md).

| Place on the page          | GIF                                   | Role                                 |
| -------------------------- | ------------------------------------- | ------------------------------------ |
| Gallery slot 1             | `gallery/01-hero.gif`                 | Intro (the only gallery GIF)         |
| Description, first line    | `description/01-banner.gif`           | Intro banner                         |
| What it does               | `description/04-how-it-works.gif`     | Hold, bid, hammer, receipt           |
| How we built it            | `description/05-architecture.gif`     | Architecture: one bid, four hops     |
| Ledger verify (judge flow) | `description/07-audit-and-verify.gif` | Do not trust, verify                 |
| Accomplishments            | `description/13-results.gif`          | Kill survived, voice 24 of 24, chain |
| Try it (last image)        | `outro/09-outro-credits.gif`          | Outro with credits                   |

Compulsory three: intro (`01-banner`, `01-hero`), architecture (`05-architecture`), outro (`09-outro-credits`). Everything else in the description and gallery is a static PNG.

Devpost limits checked on 9 Nov: gallery files must be JPG, PNG or GIF, at most 5 MB each, ratio 3:2. All 8 gallery files are 1200x800 (3:2); the largest is `01-hero.gif` at 1.3 MB. The description images are not subject to the gallery limit; the largest, `outro/09-outro-credits.gif`, is 0.8 MB.

## Team members (Devpost field)

Devpost has its own team members field: add Harsh Bhanushali (harshbhx) and Dhairya Patel (DhairyaPatel-Devloper) there, as well as in the description "Team" subsection. Credits in the text follow `git log` (Dhairya's commits are mostly the web app, its accessibility and visual tests, and the end-to-end scenario runner), plus the manual Render deploys, which Harsh confirmed are Dhairya's.

## Flags: confirm with Harsh before posting

1. **AI tools used while building.** The rules require naming every AI tool and how it was used. The description now has this block under "AI in the product". It is Harsh's call, so confirm before posting. The repository's banned-word check rejects the assistant's product name and its vendor name, so the text says "an AI coding assistant (name added by hand on Devpost)". Replace that bracket with the real product and vendor name in the Devpost editor only; never commit it. Both versions:
   - With: "AI tools used while building: an AI coding assistant (name added by hand on Devpost), for coding assistance and documentation drafts." followed by the runtime AI paragraph (Deepgram nova-3, Groq whisper-large-v3-turbo).
   - Without: delete the "AI tools used while building" paragraph and keep only the runtime AI paragraph. The rules say every AI tool used, so leaving it out is a disclosure risk.
2. **APIMatic: not claimed.** `DESCRIPTION.md` says the APIMatic portal and SDKs are not live, so it does not claim them, and the `apimatic` Built-with tag is not used. https://docs.gavel.dualmindlab.tech/portal still answered 404 on 9 Nov, and `docs/API.md` says nothing has been generated. If the portal goes live before submission, add the portal to the try-it links, restore the tag and reword the "A judge API" bullet and the last "What's next" bullet in `DESCRIPTION.md`.

## Rules check, in short

Open items for the submitter:

1. Confirm the About box on GitHub shows the MIT licence.
2. Fill the form extras the live form adds (category, developer account ID, country, tool feedback), and the reuse statement: the project started on 4 Nov 2026, after the 1 Oct start, so it counts as new.
3. Upload the video, the thumbnail (static) and the 8 gallery images, paste the testing instructions with buyer logins.
4. After G3 reports (about 12 Nov 06:17 UTC), the deadline is 12 Nov 12:00 pm PT (20:00 UTC, Fri 13 Nov 01:30 IST). Reword the G3 lines if the result lands before you submit.

## What is real versus simulated (reference, not pasted)

Reference table for answering questions about what is real. It is not part of the paste text (Devpost may not render tables).

| Part                          | Real                                                                                                                                                      | Simulated or recorded                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Authorize, capture, remainder | Authorization reads CAPTURED after a 350 of 500 final capture on the sandbox for two PayPal-account buyers (G1); the release of the remainder is inferred | Saga tests against the project's fake PayPal                                                                     |
| Card and guest holds          | Wallet and guest card AUTHORIZE in SDK v6 on the sandbox (G2)                                                                                             | n/a                                                                                                              |
| Webhooks                      | Six real sandbox events verified through PayPal's endpoint (G4)                                                                                           | Tampered-event rejection and the retry schedule are tested against the fake only                                 |
| Honor period                  | A real probe is running (G3, final reading about 12 Nov 06:17 UTC)                                                                                        | 30 days of auctions on a fake clock ([SIM-MULTIDAY](../evidence/SIM/SIM-MULTIDAY.md)); not a sandbox result      |
| Settlement and crash          | 20 and 49 settlements of 6 holds measured on the sandbox; in-process crash resume in the nightly runs; one real process kill on a CI runner               | Many crash points and kills run against the fake PayPal; the kill was not on the deployed host                   |
| Speech                        | Live socket run with real providers on synthetic clips (24 of 24 answered)                                                                                | All audio is synthetic; the text parser is measured on 169 transcripts; confirm prompt on every bid (G5 tested with synthetic clips) |
| Hosted demo                   | Web at gavel.dualmindlab.tech and API at api.gavel.dualmindlab.tech, sandbox mode, one Render service with a 1 GB disk                                    | Demo holds can be simulated, and `/demo/scripted` is a recorded room in the browser                              |
| Money                         | No real money moves anywhere; all PayPal calls are sandbox                                                                                                |                                                                                                                  |
