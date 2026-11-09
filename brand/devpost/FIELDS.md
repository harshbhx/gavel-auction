# Devpost form fields: PayPal AI Hackathon

Paste order follows the Devpost form. The long text is in [`DESCRIPTION.md`](DESCRIPTION.md) (paste the whole file into "About the project"). Image URLs in it are raw GitHub URLs on `main` under `brand/devpost/description/` (numbered in the order they appear in the text; see [`../CURATION.md`](../CURATION.md)).

Rules source: https://paypalaihackathon.devpost.com/rules (Submission Period 1 Oct 2026 9:15 am PT to Thu 12 Nov 2026 12:00 pm PT).

## Project name

GAVEL

## Tagline (49 characters, limit 60)

Every bid is a PayPal hold. Only the winner pays.

## Elevator pitch (157 characters, limit 200)

A live auction where every bid is a PayPal hold. At the hammer GAVEL captures the winning price, voids the rest, and seals the result in a verifiable ledger.

## About the project

Paste the full content of `brand/devpost/DESCRIPTION.md`. Headings used, in Devpost's order: Inspiration, What it does, How we built it, Challenges we ran into, Accomplishments that we're proud of, What we learned, What's next for GAVEL. Extra H3 subsections: "Animated slides" (under What it does), and "Team", "Where the partners fit" and "AI in the product" (under How we built it). Every image has an italic caption line. The AI section answers the rules item "identify which tools (model or AI service) were used and how".

Markdown used: H2 and H3 headings, bold, bullet lists, inline code, links, images by URL. No tables, no HTML, no fenced code, no strikethrough (Devpost's Markdown tips list tables, fenced code and strikethrough as extended syntax that not every renderer supports).

## Built with (23 tags, limit 25)

typescript, node.js, react, vite, python, paypal, paypal-orders-api, paypal-payments-api, paypal-js-sdk, cloudflare-workers, render, ag-grid, hugging-face, deepgram, groq, websockets, openapi, apimatic, vitest, playwright, github-actions, next.js, fumadocs

Two spare slots. Add `paypal-webhooks` or `speech-to-text` if you like. Removed from the older list: `cloudflare-pages` (the web app is a Worker with static assets; not confirmed as Pages). `apimatic` stays (see flag 2).

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

Paste `docs/judges/DEVPOST-TESTING.md` and fill the two sandbox buyer logins on Devpost only. Never commit them. The rules require testing access to stay free and unrestricted until the Judging Period ends (1 to 15 Dec 2026, access live until 15 Dec 8:00 am PT), so keep the Render service, the Worker and the sandbox buyers alive until then.

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
| 7   | 07-open-data-and-gates.png | static PNG   | The evidence is open: five small datasets, each with a sha256 manifest and labelled for what it is. Gates G0, G1, G2 and G4 passed on the PayPal sandbox, G3 is a real probe in progress and G5 is partial on synthetic audio. |
| 8   | 08-ending.png              | static PNG   | Try it. Verify it. No login. Web app, docs and source links.                                                                                                                                                                   |

Slot reserved: the outro GIF with credits (being built by the 3D logo task). It is a GIF, so it goes in the description (under "Try it", next to the closing slide), not in the gallery. Add its file to `brand/devpost/outro/` and one image line in `DESCRIPTION.md` when it lands; it then replaces `description/16-ending.gif`, which stays as the fallback. Pending, owned by agent gfx-outro.

Devpost limits checked on 9 Nov: gallery files must be JPG, PNG or GIF, at most 5 MB each, ratio 3:2. All 8 gallery files are 1200x800 (3:2); the largest is `01-hero.gif` at 1.3 MB. The description images are not subject to the gallery limit; the largest, `16-ending.gif`, is 0.8 MB.

## Team members (Devpost field)

Devpost has its own team members field: add Harsh Bhanushali (harshbhx) and Dhairya Patel (DhairyaPatel-Devloper) there, as well as in the description "Team" subsection. Credits in the text follow `git log` (Dhairya's commits are mostly the web app, its accessibility and visual tests, and the end-to-end scenario runner), plus the manual Render deploys, which Harsh confirmed are Dhairya's.

## Flags: confirm with Harsh before posting

1. **AI tools used while building.** The rules require naming every AI tool and how it was used. The description now has this block under "AI in the product". It is Harsh's call, so confirm before posting. The repository's banned-word check rejects the assistant's product name and its vendor name, so the text says "an AI coding assistant (name added by hand on Devpost)". Replace that bracket with the real product and vendor name in the Devpost editor only; never commit it. Both versions:
   - With: "AI tools used while building: an AI coding assistant (name added by hand on Devpost), for coding assistance and documentation drafts." followed by the runtime AI paragraph (Deepgram nova-3, Groq whisper-large-v3-turbo).
   - Without: delete the "AI tools used while building" paragraph and keep only the runtime AI paragraph. The rules say every AI tool used, so leaving it out is a disclosure risk.
2. **APIMatic claim.** The text says the API portal and the TypeScript and Python SDKs are generated with APIMatic. `docs/API.md` still says nothing has been generated, and https://docs.gavel.dualmindlab.tech/portal answered 404 on 9 Nov 12:05 UTC (DOC-55 has not merged). Do not submit this sentence unless the portal and SDKs exist; if not, replace it with "the OpenAPI spec is linted in CI; portal and SDK generation is in progress". Add the portal to the try-it links when it is live.

## Rules check, in short

Open items for the submitter:

1. Confirm the About box on GitHub shows the MIT licence.
2. Fill the form extras the live form adds (category, developer account ID, country, tool feedback), and the reuse statement: the project started on 4 Nov 2026, after the 1 Oct start, so it counts as new.
3. Upload the video, the thumbnail (static) and the 8 gallery images, paste the testing instructions with buyer logins.
4. After G3 reports (about 12 Nov 06:17 UTC), the deadline is 12 Nov 12:00 pm PT (20:00 UTC, Fri 13 Nov 01:30 IST). Reword the G3 lines if the result lands before you submit.
