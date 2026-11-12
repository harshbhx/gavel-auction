# Changelog

What changed in GAVEL, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): each entry groups changes under Added, Changed and Fixed. Dates are UTC and come from the merged pull requests on `main`. Every pull request link is the full GitHub address.

The same text is shown on the docs site as [Changelog](https://docs.gavel.dualmindlab.tech/docs/roadmap/changelog). That page is generated from this file by `docsite/scripts/gen-changelog.mjs`, so the two never differ. For what is proven and what comes next, read [docs/LIMITATIONS.md](docs/LIMITATIONS.md) and [docs/GATES.md](docs/GATES.md).

## Unreleased

Work in flight and evidence being collected. The gate record in [docs/GATES.md](docs/GATES.md) stays the source of truth.

### Added

- Open data is live on Hugging Face: five datasets (gavel-gates, gavel-latency, gavel-sim-30d, gavel-stt-bids, gavel-audit-demo) and the Evidence Explorer Space, grouped in one collection: https://huggingface.co/collections/harshbhx/gavel-evidence-auction-holds-hammer-and-receipts-6af0afebebb37eb4c9184504
- The API has its own domain, https://api.gavel.dualmindlab.tech (its `/healthz` answers 200), alongside the Render address; the docs are at https://docs.gavel.dualmindlab.tech and the web app at https://gavel.dualmindlab.tech.
- Docs: a glossary with definitions on hover, focus and tap, and a ten-step guided tour with a process diagram.
- A timed sandbox probe for gate G3 (honor period, validity and reauthorize). It started on 7 Nov 03:06 UTC. Day 0 is recorded: an immediate reauthorize was refused with `REAUTHORIZATION_TOO_SOON`, as it should be, and three fresh authorizations were approved to be read at day 3.5, day 4 and day 5. Scheduled checks are set for every 6 hours (GitHub starts them roughly every 6 to 8) and the final reading was due on 12 Nov (it passed, see Changed). Run: https://github.com/harshbhx/gavel-auction/actions/runs/42332377547
- An early G3 reading on two older G2 authorizations. The wallet one was probed on 8 Nov 17:36 UTC at age 3.24 days: a partial capture of 1.00 was accepted (HTTP 201) and the authorization then read `PARTIALLY_CAPTURED`; the reauthorize call answered 422 `UNPROCESSABLE_ENTITY` with the issue `PAYER_CANNOT_PAY`. The guest card one was probed on 9 Nov 00:09 UTC at age 3.5075 days: still CREATED, a partial capture of 1.00 was accepted (HTTP 201), then `PARTIALLY_CAPTURED`; reauthorize answered 422 `PAYER_CANNOT_PAY`. A `final_capture` and a void on a guest card authorization were not run. Redacted copies of the readings are in `docs/evidence/G3-early/`. Runs: https://github.com/harshbhx/gavel-auction/actions/runs/42505780514 and https://github.com/harshbhx/gavel-auction/actions/runs/42538613566
- This changelog and a "Limits and next steps" page ([docs/LIMITATIONS.md](docs/LIMITATIONS.md)), with matching pages on the docs site.
- A marketing landing page with real product screens, sellers and an FAQ (merged on 8 Nov): https://github.com/harshbhx/gavel-auction/pull/2030

### Changed

- Gate G3 is recorded as PASS (final checkpoint 12 Nov, [run 43174780092](https://github.com/harshbhx/gavel-auction/actions/runs/43174780092)): the authorization stayed capturable at 3.5, 4 and 5 days, a partial capture of 1.00 was accepted each time (HTTP 201), reauthorize was accepted each time (HTTP 201), and an immediate reauthorize was refused with `REAUTHORIZATION_TOO_SOON`. Scope: sandbox, wallet buyer, 1.00 partial capture only. The README, `docs/GATES.md`, the limits and the docs site now say so. The 29-day validity, a card order and a full-amount capture were not probed.
- The README, judge and demo guides, Devpost text, web copy and docs site no longer show the tags PARTIAL, UNVERIFIED, NOT RUN or IN PROGRESS. G3 then read running with its final reading date (12 Nov; it has since passed), G5 reads tested with synthetic voice clips with a confirm step on every bid, and the security rows read checked with a named residual. VERIFIED and PASS are unchanged, and `docs/GATES.md` keeps its own status words and every verdict.
- Status wording across the README, the judge and demo guides and the docs site now leads with what is built and measured, and names the next step for each open item. The gate table is unchanged: G0, G1, G2 and G4 PASS, G5 PARTIAL, G3 in progress at the time (it has since passed).

## 2026-11-11 - Judge deck and guide, SDK release wording

The judge deck and the confidential judge guide were regenerated with the plain status wording, and the SDK text now matches the release.

### Added

- An animated judge deck for the Devpost panel (DOC-66): https://github.com/harshbhx/gavel-auction/pull/2572
- A judge guide PDF and its build (the guide itself stays confidential): https://github.com/harshbhx/gavel-auction/pull/2569

### Changed

- The judge deck and guide were rebuilt with the new status wording (DOC-95): https://github.com/harshbhx/gavel-auction/pull/2612
- The APIMatic SDKs (TypeScript, Python and C#) are described as a GitHub release, `sdk-v0.0.5`, not on npm, PyPI or NuGet; the hosted APIMatic portal is not live: https://github.com/harshbhx/gavel-auction/pull/2631

## 2026-11-10 - SDK release, PageSpeed 100, launch film

### Added

- Release `sdk-v0.0.5` with the TypeScript, Python and C# SDKs generated by APIMatic: https://github.com/harshbhx/gavel-auction/releases/tag/sdk-v0.0.5
- PageSpeed 100 on the landing page, mobile and desktop, one lab run (landing page only): https://github.com/harshbhx/gavel-auction/pull/2495
- The GAVEL launch film, public on YouTube: https://youtu.be/S5TrcJO-E9o
- Quality evidence: load, mutation, a quality page and baselines (FIX-162): https://github.com/harshbhx/gavel-auction/pull/2492

## 2026-11-09 - Evidence runs on the hosted app

### Added

- A real server process kill on a CI runner settled with one capture (run 42558021614): https://github.com/harshbhx/gavel-auction/actions/runs/42558021614
- A live `/audio` socket run with both speech providers on synthetic clips (run 42575018866): https://github.com/harshbhx/gavel-auction/actions/runs/42575018866
- A traffic simulation run against the hosted app that ended with verdict aborted, request budget spent, no room settled (run 42582589995): https://github.com/harshbhx/gavel-auction/actions/runs/42582589995
- A judge smoke run through the hosted app: 17 steps passed, with simulated holds.

### Changed

- The proxy hop count is 2, settled by the source probe in run 42578306983: https://github.com/harshbhx/gavel-auction/actions/runs/42578306983

## 2026-11-08 - Judge rooms open up: join as a bidder, a slower guided demo

Late evening. A judge can now go from `/try` to a room, join as a bidder with the code, bid, hammer and read the receipt, and the scripted demo plays at a readable pace.

### Added

- Judge room demo hold with no PayPal login (SRV-34): https://github.com/harshbhx/gavel-auction/pull/2024
- A paced, readable scripted demo with player controls (UIX-26): https://github.com/harshbhx/gavel-auction/pull/2021
- A "For judges" section in the docs, with judge promotion taken off the public landing page: https://github.com/harshbhx/gavel-auction/pull/2023

### Changed

- Wide-screen layouts, so pages no longer sit half empty on large displays (UIX-27): https://github.com/harshbhx/gavel-auction/pull/2026

### Fixed

- Joining as a bidder with the room code now works from the hub, and the hub join link carries the code (UIX-25): https://github.com/harshbhx/gavel-auction/pull/2022
- Judge rooms, links, codes and error bodies hardened on the server: https://github.com/harshbhx/gavel-auction/pull/2027
- Fonts, images and animations settle before visual snapshots are taken (QA-03): https://github.com/harshbhx/gavel-auction/pull/2037

## 2026-11-08 - Judge hub, join by code and a trust FAQ

Afternoon. The judge entry points arrive: one-screen hub, `/try` panel, guided join and a FAQ that says what happens to a login, money and data.

### Added

- Open join by code for judge rooms: https://github.com/harshbhx/gavel-auction/pull/2009
- One-screen judge hub with a live preview and a join ticket (UIX-15): https://github.com/harshbhx/gavel-auction/pull/2010
- Judge panel at `/try` with a guided path, a screen map and sandbox buyer notes (UIX-18): https://github.com/harshbhx/gavel-auction/pull/2011
- Guided three-step join with clear error states (UIX-22): https://github.com/harshbhx/gavel-auction/pull/2018
- Judge console status guide (UIX-19): https://github.com/harshbhx/gavel-auction/pull/2019
- Judge trust FAQ, sandbox buyer steps and a Devpost testing draft (UIX-23): https://github.com/harshbhx/gavel-auction/pull/2016
- Hold, hammer and receipt story strip on the projection screen (UIX-16): https://github.com/harshbhx/gavel-auction/pull/2017
- Demo launcher with judge links and a room code dialog: https://github.com/harshbhx/gavel-auction/pull/2020

### Changed

- The auctioneer console follows the server pause flag (SRV-31): https://github.com/harshbhx/gavel-auction/pull/2008

## 2026-11-08 - One look: Newsprint and Signal

Morning. A new landing page, a restyled docs site and a single visual identity across every route.

### Added

- Marketing landing page in the Newsprint style (UIX-08): https://github.com/harshbhx/gavel-auction/pull/2001
- Judge room hub, token help and a QR for the scripted demo (UIX-12): https://github.com/harshbhx/gavel-auction/pull/2006

### Changed

- Newsprint is the default palette on every route (UIX-07): https://github.com/harshbhx/gavel-auction/pull/2000
- Landing polish with local effects (UIX-09): https://github.com/harshbhx/gavel-auction/pull/2003
- Docs site restyled in Newsprint and Signal (UIX-10): https://github.com/harshbhx/gavel-auction/pull/2004
- Docs home, article chrome and mobile layout polished (UIX-11): https://github.com/harshbhx/gavel-auction/pull/2005
- Newsprint and Signal is the only look (UIX-13): https://github.com/harshbhx/gavel-auction/pull/2007
- The web build takes its API origin from the `API_ORIGIN` repository variable: https://github.com/harshbhx/gavel-auction/pull/2002

## 2026-11-08 - Hold explainer, thermometer and share links

First hours of the day. The bidder and projector screens gain the pieces that explain a hold and show money raised.

### Added

- Hold explainer sheet and a first-visit guided tour (UX-01): https://github.com/harshbhx/gavel-auction/pull/1992
- Fundraiser thermometer on the projector screen (UX-02): https://github.com/harshbhx/gavel-auction/pull/1993
- Shareable receipt link with a QR code and a print layout (UX-05): https://github.com/harshbhx/gavel-auction/pull/1996
- An in-app scripted demo route and a palette switch (UIX-06): https://github.com/harshbhx/gavel-auction/pull/1999

### Changed

- README and guides updated for the Scoreboard interface and current status: https://github.com/harshbhx/gavel-auction/pull/1998

## Earlier

Work before 8 Nov, including the sandbox gates G0 to G5, the settlement saga and the voice evaluation, is in the git history of `main` and in [docs/GATES.md](docs/GATES.md).
