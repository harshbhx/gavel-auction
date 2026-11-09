# SPEC-web: GAVEL web application (packages/web)

Status: draft for build. Owner area: web (React + TypeScript + Vite). File: docs/specs/SPEC-web.md.
Key prefixes: requirements R-WEB-nnn, tests T-WEB-nnn, issues WEB-nn, open questions OQ-WEB-n.
Anything not verified in the PayPal sandbox is marked `UNVERIFIED (gate G1..G5)` with its fallback.

## 1. Purpose and scope

GAVEL is a live auction where every bid is backed by a PayPal authorization hold. The web app is the
only human-facing surface. It has four audiences on one codebase:

1. Bidder on a phone: registers, approves a hold (their ceiling), joins by QR, bids, sees own status, sees the receipt.
2. Auctioneer at a laptop: runs the room, watches the bid stream and the voice feed, confirms ambiguous bids, enters bids manually, controls the lot, can stop everything.
3. Audience and judges on a projector: public big-screen view, readable from 10 m.
4. Reviewer (organizer, judge): audit trail, PayPal authorization-state ladder, settlement receipts, replay of a recorded auction.

In scope: design system and tokens, app shell and routing, client state against the WebSocket protocol,
a mock server and scenario fixtures, every screen and its states, PayPal approval step (JS SDK v6 contract),
accessibility, responsive layouts, copy deck, component tests, visual regression approach, build and CSP.

Out of scope (owned elsewhere): engine rules and ledger (engine), wire schemas and server routes (realtime),
PayPal calls, saga, webhooks (payments), STT adapters and parser (voice), Playwright end-to-end scenarios (quality),
deploy workflows (infra). The web app consumes those through the contracts in section 5.

Non-goals: accounts or login for bidders, analytics or telemetry of any kind, i18n beyond one English catalog
(structure allows more later), native apps, offline-first bidding.

## 2. Definitions

- Room: one auction event, id = ULID. Lot: one item being sold in a room. Paddle: small integer shown to the room, unique per room.
- Ceiling: maximum amount a bidder can bid, equal to the amount of the PayPal authorization hold (integer cents, USD).
- Hold: PayPal authorization (Orders v2 intent=AUTHORIZE). "Held, not charged" is the product promise until CAPTURED.
- Hammer: auctioneer closes the lot; the engine picks the winner; payments capture the winning amount and release the rest.
- Settlement states (fixed): HELD, BIDDING, WINNER_SELECTED, CAPTURING, CAPTURED, VOIDING, SETTLED, FALLBACK_RUNNER_UP, FAILED_NEEDS_REVIEW.
- Ladder: the vertical visual of every hold and its settlement state (section 8.7). The hero visual.
- Transport: the interface the store uses to talk to a room. Implementations: WebSocketTransport (real), ScenarioTransport (in-browser scripted, no network), mock server (Node, real socket, scripted).
- Role: bidder, auctioneer, screen, reviewer. Auctioneer and reviewer routes need a signed token in the URL fragment.
- Sandbox banner: persistent strip "Sandbox: no real money moves" shown on every route.
- Provenance label: a small tag on a view stating LIVE, SCRIPTED or RECORDED so judges are never misled.

## 3. Requirements

Each requirement is testable by at least one T-WEB test (section 10). MUST = release blocker, SHOULD = fix if time.

### 3.1 Foundation

- R-WEB-001 The package MUST compile with TypeScript strict, `noUncheckedIndexedAccess`, and zero `any` in `src/` (lint rule, tests excluded).
- R-WEB-002 Every user-facing string MUST come from `src/copy/en.ts` by key. A test fails on a string literal in JSX text or in `aria-label` outside the catalog.
- R-WEB-003 The app MUST NOT include analytics, telemetry, tracking pixels, third-party fonts or third-party CDNs. The only third-party origin at runtime is the PayPal SDK origin, loaded only on the approval step.
- R-WEB-004 A Content-Security-Policy MUST be shipped (meta or header) restricting script-src to self and the PayPal SDK origin, connect-src to self, the room host and PayPal; no inline scripts.
- R-WEB-005 Money MUST be integer cents end to end. Display uses `formatUsd(cents)`; no floating point arithmetic on money; inputs are parsed by `parseUsdToCents` that rejects more than 2 decimals.
- R-WEB-006 Countdowns MUST use server epoch ms plus a measured offset (`serverNow = Date.now() + offsetMs`), never the local clock alone.
- R-WEB-007 All wire types MUST be imported from the single seam `src/wire/index.ts` (re-export of `@gavel/shared` once available). No other file defines a wire shape.
- R-WEB-008 The whole app MUST run with `ScenarioTransport` and zero network, selected by `?transport=scenario&scenario=<name>` or the demo launcher.
- R-WEB-009 Initial route JS MUST be at most 190 KB gzip; the PayPal SDK, the QR encoder and the replay player MUST be lazy chunks.
- R-WEB-010 Configuration MUST come from `VITE_*` variables validated at boot (`VITE_API_BASE`, `VITE_WS_BASE`, `VITE_PAYPAL_CLIENT_ID`, `VITE_SANDBOX=true`); the build MUST fail if `VITE_SANDBOX` is not `true`.

### 3.2 Design system

- R-WEB-011 All colour, type, space, radius, shadow, motion values MUST be CSS custom properties defined in `src/design/tokens.css`; components MUST NOT hard-code colours.
- R-WEB-012 Three themes MUST exist: `light`, `dark`, `projector` (dark, larger type scale, max contrast). Default follows `prefers-color-scheme`; `/r/:id/screen` forces `projector`.
- R-WEB-013 Text contrast MUST be at least 4.5:1 (3:1 for large text and UI borders) in all themes, verified by a token contrast test over every foreground/background pair declared in tokens.
- R-WEB-014 Type scale: 12/14/16/20/28/40 px base, projector multiplies by 2.0; body line-height 1.5; tabular figures for every money and paddle display.
- R-WEB-015 Interactive targets on the bid screen MUST be at least 48x48 CSS px; elsewhere at least 40x40.
- R-WEB-016 State MUST never be conveyed by colour alone: each ladder state and bid status has an icon and a text label as well.
- R-WEB-017 Motion tokens: 120 ms (micro), 240 ms (standard), 600 ms (hammer). Under `prefers-reduced-motion: reduce` all durations become 0 ms except opacity fades of 80 ms, and the hammer animation becomes a static stamp.
- R-WEB-018 Icons MUST be inline SVG from one local set; no icon font.

### 3.3 Connection and state

- R-WEB-020 The store MUST be a pure reducer `(state, event) => state` over wire messages plus local events, with no I/O inside the reducer.
- R-WEB-021 Every inbound message carries `seq` (per room, strictly increasing). The reducer MUST ignore `seq <= lastSeq` (duplicates) and, on a gap (`seq > lastSeq + 1`), mark the room `resyncing` and request a snapshot by re-sending `join` with `resumeFromSeq`.
- R-WEB-022 A `state` message is a full snapshot and MUST replace room state, set `lastSeq`, and clear `resyncing`.
- R-WEB-023 Reconnect MUST use backoff 500, 1000, 2000, 4000, 8000 ms (cap 8000) with plus or minus 20 percent jitter, indefinitely, and MUST resend `join` with the stored `resumeFromSeq` and bidder session token.
- R-WEB-024 After 2000 ms disconnected the app MUST show the offline banner and MUST disable bid, confirm and control buttons (not hide them).
- R-WEB-025 A submitted bid MUST show a pending state immediately and resolve to accepted or rejected from `bid_accepted` or `bid_rejected` matched by `clientBidId`; if neither arrives in 4000 ms it becomes `unknown` with a retry-safe notice (the same `clientBidId` is reused, so a duplicate cannot double count).
- R-WEB-026 The store MUST estimate `offsetMs` from `state.serverTime` and the round trip of join; skew over 2000 ms MUST show a non-blocking notice on the auctioneer console only.
- R-WEB-027 Rejection codes (from shared) MUST map to copy keys through one table; an unknown code MUST map to the generic message and be shown with its raw code in the details disclosure.
- R-WEB-028 Room state MUST be isolated per `roomId`; navigating to another room MUST reset all room state.
- R-WEB-029 Bidder identity (paddle, session token) MUST be kept in `sessionStorage` per room; the auctioneer token is read from the URL fragment and kept in memory only; both are wrapped in try/catch and the app MUST work if storage is unavailable.

### 3.4 App shell and routing

- R-WEB-030 Routes: `/` landing; `/demo` launcher; `/join/:roomId` QR landing; `/r/:roomId/register`; `/r/:roomId/bid`; `/r/:roomId/receipt`; `/r/:roomId/console`; `/r/:roomId/screen`; `/r/:roomId/audit`; `/replay/:recordingId`; `/gallery` (dev builds and preview builds only); `*` not found.
- R-WEB-031 Console and audit routes MUST refuse to render without a valid-looking token and show the "link expired or missing" screen with a way to request a new link from the launcher; token validity is decided by the server (an `error` with code from shared closes the view).
- R-WEB-032 A top-level error boundary MUST catch render errors and show the recovery screen (reload, go to landing) with the error id; the boundary MUST NOT log to any remote service.
- R-WEB-033 Each route MUST set `document.title` (route name + room name) and move focus to the main heading on navigation.
- R-WEB-034 The sandbox banner MUST be present on every route including 404 and the error boundary.

### 3.5 Landing and demo launcher

- R-WEB-035 Landing MUST state the product in one sentence, show the "held, not charged" promise, and offer two actions: "Start a demo auction" and "Join with a code".
- R-WEB-036 The launcher MUST create a room via the server demo endpoint, or, if `transport=scenario`, start a local scripted room, and show provenance labels (LIVE sandbox or SCRIPTED).
- R-WEB-037 The launcher MUST show the four role links for the new room (console, screen, bidder QR, audit) with copy buttons, and open the console in the current tab.
- R-WEB-038 Launcher failure (server down) MUST offer "Run scripted demo instead" which switches to ScenarioTransport.

### 3.6 Bidder registration and PayPal approval

- R-WEB-040 Registration fields: display name (1..24 chars, trimmed), paddle number (server-suggested, editable, 1..999, unique), ceiling choice.
- R-WEB-041 Ceiling presets MUST be 100, 250, 500, 1000 USD plus Custom; custom accepts whole dollars from the room minimum to the room maximum cap (`room.config.maxCeilingCents`); out-of-range shows inline error text, not a toast.
- R-WEB-042 The ceiling step MUST show the "held, not charged" block adjacent to the choice, with the chosen amount interpolated, before the approval button is enabled.
- R-WEB-043 The approval step MUST go through `PaymentApprovalPort`; the UI MUST NOT import PayPal types outside `src/payments/paypalV6Adapter.ts`.
- R-WEB-044 Approval states: `idle`, `preparing` (creating order), `awaiting_buyer` (SDK popup or redirect open), `confirming` (server authorizing), `held` (success), `cancelled`, `declined`, `error`. Each has its own copy and a recovery action.
- R-WEB-045 On `cancelled` the buyer MUST return to the ceiling step with the choice preserved and the message "No hold was created."
- R-WEB-046 On `held` the UI MUST show the hold id suffix (last 6 chars), the ceiling, and a "Continue to bidding" button; the full id is available in a disclosure.
- R-WEB-047 The approval step MUST be idempotent from the buyer's view: double-click or back-and-return MUST NOT create two holds (client sends one `clientRegistrationId` per attempt; server dedupes). Re-entering after `held` shows the existing hold.
- R-WEB-048 `FakeApprovalAdapter` MUST implement the same port, support fault modes (`decline`, `cancel`, `slow`, `error`) and be selected by `VITE_PAYMENTS=fake`.
- R-WEB-049 If registration is closed (room already BIDDING and config disallows late entry) the screen MUST say so and offer the watch-only link.

### 3.7 QR join

- R-WEB-050 The QR encodes `https://<host>/join/<roomId>?c=<shortCode>`; the join page resolves the room name and shows "Join <room name>" and the six-character short code as a fallback.
- R-WEB-051 The QR image MUST be rendered client-side (no remote QR service), with error correction level M, a 4-module quiet zone, and an accessible text alternative containing the URL.
- R-WEB-052 A returning bidder (valid session in storage) MUST skip registration and land on `/bid`.

### 3.8 Mobile bid screen

- R-WEB-053 Layout top to bottom: status strip (connection, sandbox), lot card (title, image slot), current price, own status chip, quick-bid buttons, custom amount, ceiling meter, last events.
- R-WEB-054 Own status chip values: `Leading`, `Outbid`, `Not bidding yet`, `Bid pending`, `At your ceiling`, `Won`, `Lost`, `Watching only`; each has icon + text.
- R-WEB-055 Quick-bid buttons: "Bid <next>" (current + min increment) and "+<increment>" steps chosen by server `price.nextMinCents`; buttons that exceed the ceiling are disabled with the reason "Above your ceiling" in text.
- R-WEB-056 Custom amount input uses `inputmode="numeric"`, validates against next minimum and ceiling on every keystroke (hint only; server is authoritative).
- R-WEB-057 A bid MUST require a deliberate action: tap the button (single tap) is allowed for quick-bid; custom amount needs Enter or "Place bid". Double-tap within 600 ms MUST send only one `bid`.
- R-WEB-058 The ceiling meter MUST show highest own accepted bid and the ceiling as text and as a bar (`role="meter"` with `aria-valuenow`, `-min`, `-max`).
- R-WEB-059 A `bid_rejected` MUST surface as an inline message under the buttons, persisting until the next price change or 6000 ms, using mapped copy (for example `over_ceiling`, `below_increment`, `closed`).
- R-WEB-060 When outbid, the screen MUST announce through the polite live region and MAY vibrate (`navigator.vibrate(60)`) if the buyer enabled "Vibrate when outbid" (default off).
- R-WEB-061 `confirm_request` addressed to this bidder MUST open a bottom sheet "Did you mean 350 for paddle 12?" with Yes and No; `confirm_response` is sent once; the sheet expires at the server `expiresAt`.
- R-WEB-062 When the lot is closed or the room is paused all bid controls MUST be disabled and a banner MUST explain why (`Paused by the auctioneer`, `Lot closed`, `Auction stopped`).

### 3.9 Auctioneer console

- R-WEB-063 Layout (desktop >= 1024 px): left column lot + price + controls; centre bid stream; right column voice feed and confirm queue; bottom strip ladder summary. Under 1024 px columns stack with a tab bar.
- R-WEB-064 Price header MUST show current price, leader paddle and name, bid count, time to soft-close end, and next minimum, updating from `price` messages without layout shift (fixed-width tabular numerals).
- R-WEB-065 The bid stream MUST list every bid event newest first with: server time, paddle, amount, source icon (voice, QR, manual), confidence for voice (percent), status (accepted, rejected + reason, pending confirm), and MUST be virtualized above 200 rows.
- R-WEB-066 The voice feed MUST show partial transcript in muted style and final transcript in normal style, the parsed result chip (`paddle 12, $350, 0.93`), and a "Not a bid" chip when the parser returned no bid; it MUST show mic state (off, requesting, live, error) with a level meter.
- R-WEB-067 The confirm queue MUST list pending `confirm_request` items oldest first with countdown; keyboard: `Y` confirm, `N` reject, `J/K` move selection; each action sends `confirm_response` once and removes the item on `bid_accepted`/`bid_rejected`.
- R-WEB-068 Manual entry: fields paddle and amount, Enter submits as a `bid` with `source: "manual"`; the same server validation applies and the rejection text is shown inline beside the field.
- R-WEB-069 Controls: Open lot, Pause, Resume, Extend (+30 s, configurable), Hammer. Each shows its disabled reason; each posts through `ControlPort`; each result is echoed in the stream as a control event from `audit_event`.
- R-WEB-070 Hammer MUST require a second deliberate action (press and hold 800 ms, or Enter on the focused confirm dialog) and MUST show the leader and price in the dialog.
- R-WEB-071 Kill switch: always visible top-right on the console, red, label "Stop auction". Activation opens a dialog requiring typing `STOP` and then a 1500 ms press-and-hold; the dialog states exactly what will happen (copy key `kill.consequence`). After activation the console shows the stopped state permanently for the room and every other view shows "Auction stopped".
- R-WEB-072 Keyboard shortcuts MUST be listed in a help dialog (`?`), MUST NOT fire while an input is focused, and destructive ones (hammer, stop) MUST NOT have single-key shortcuts.
- R-WEB-073 Console MUST show the connected bidder count and registered-with-hold count, and flag bidders whose hold is not `HELD` (for example declined) with a warning chip.
- R-WEB-074 The console MUST show a persistent provenance label (LIVE sandbox, SCRIPTED, RECORDED).

### 3.10 Public big screen

- R-WEB-075 The screen view MUST show lot title, current price (at least 160 px tall at 1920x1080), leader paddle, soft-close countdown, and a ticker of the last 5 accepted bids; no controls, no personal data beyond paddle and optional display name.
- R-WEB-076 Price changes MUST animate (count/flash 240 ms) and the new price MUST be exposed in an `aria-live="polite"` region (throttled to at most one announcement per 2000 ms).
- R-WEB-077 The screen MUST show the QR join code and short code in a corner at all times when the lot is not closed.
- R-WEB-078 On hammer the screen MUST show "SOLD to paddle N for $X" (or "Passed" when reserve not met) and, once settlement_update arrives, a compact ladder summary ("1 captured, 11 released").
- R-WEB-079 The screen MUST tolerate a 10 s disconnect by freezing the last known state with a small "Reconnecting" chip, never blank.

### 3.11 Audit trail

- R-WEB-080 Audit view columns: seq, server time, audio offset (mm:ss.mmm from lot start, if voice), transcript, bidder (paddle), parsed amount, confidence, confirmed (yes/no/auto), result (accepted/rejected), reason. Row detail drawer shows raw `audit_event` JSON.
- R-WEB-081 Filters: paddle, result, source, confidence below threshold, free text over transcript; filters are in the URL query so a view is linkable.
- R-WEB-082 Sorting by any column, default seq ascending; the table is a real `<table>` with `scope` headers and sortable headers with `aria-sort`.
- R-WEB-083 Export: CSV and JSON of the currently filtered rows and of the full trail. CSV escaping follows RFC 4180, amounts are exported as integer cents and as a formatted column, times as ISO 8601 UTC and epoch ms. Export is built in the browser (Blob), no upload.
- R-WEB-084 Export MUST include a header row/object with room id, lot id, export time, row count and a SHA-256 of the canonical row JSON so a reviewer can detect edits; the hash covers rows only.
- R-WEB-085 Audit view MUST work read-only for settled rooms and live (appending rows) for running ones, preserving scroll position unless the user is at the bottom.

### 3.12 PayPal authorization-state ladder

- R-WEB-086 The ladder MUST render one lane per hold with state steps in fixed order: HELD, BIDDING, WINNER_SELECTED, CAPTURING, CAPTURED, then for non-winners VOIDING, SETTLED; FALLBACK_RUNNER_UP and FAILED_NEEDS_REVIEW appear as branches off WINNER_SELECTED/CAPTURING.
- R-WEB-087 The current state of each hold MUST be visually and textually distinct (filled rung, label, icon); completed steps show a check, pending steps are hollow, a branch not taken is hidden.
- R-WEB-088 Each hold row shows: paddle, name, ceiling, captured amount (winner), released amount, and a verification line: `Confirmed by PayPal webhook <eventType> at <time>` or `Confirmed by lookup at <time>` or `Awaiting confirmation`.
- R-WEB-089 Webhook ticks: each `settlement_update` carrying a new `verifiedBy` entry MUST animate one tick on its row and add a line to the ladder event log; ticks are idempotent per `eventId`.
- R-WEB-090 The ladder MUST be driven only by `settlement_update` (never inferred from `hammer`); between hammer and the first update it shows the `WINNER_SELECTED` skeleton with "Waiting for settlement".
- R-WEB-091 The ladder MUST show invariants live: `captured <= winning ceiling`, `captured + released = sum of holds` computed in integer cents; a violated invariant renders a red "Needs review" banner and never hides the discrepancy.
- R-WEB-092 `FALLBACK_RUNNER_UP` MUST show why (copy from `reason`: hold expired, voided, declined) and the new winner's lane highlighted; `FAILED_NEEDS_REVIEW` MUST show a persistent banner with the reason and a link to the audit view.
- R-WEB-093 A compact variant (summary bar, one dot per hold) MUST exist for the console bottom strip and the public screen.
- R-WEB-094 The wording "released" MUST appear for a hold only when the server reports its state as voided or released; the UI MUST NOT claim the uncaptured remainder of the winner's hold is released unless the server says so (G1 UNVERIFIED: auto-release of the remainder; fallback: server voids explicitly and the ladder shows the explicit void step "Remainder voided").

### 3.13 Settlement receipts

- R-WEB-095 Winner receipt: item, winning price, captured amount, capture id suffix, time, "Charged $X" appears only after state CAPTURED; before that "Capturing your payment" with a progress state.
- R-WEB-096 Non-winner receipt: "You did not win. Your hold of $X was released." shown only after that hold is voided/released; before that "Releasing your hold" with the ladder row.
- R-WEB-097 Fallback receipt (runner-up now winner): explains the sequence in plain words and shows the final charge.
- R-WEB-098 Failure receipt (`FAILED_NEEDS_REVIEW`): says "We could not complete this payment. Nothing more will be charged until the organizer reviews it." and shows the organizer contact slot and the reference id.
- R-WEB-099 Receipts MUST be printable (print stylesheet) and downloadable as a JSON file of the settlement view; no remote calls.

### 3.14 Replay mode

- R-WEB-100 `/replay/:recordingId` MUST load a recording bundle (`events.json` of wire messages with `t` offsets + optional `audio.opus/mp3`) and play it through `ScenarioTransport` so the real console and screen components render it.
- R-WEB-101 Controls: play/pause, speed 0.5/1/2/4, scrub bar with chapter markers (registrations, first bid, confirm moment, hammer, settlement), step to next event, jump to next chapter; keyboard `Space`, `Left/Right` (5 s), `.` (next event).
- R-WEB-102 Audio MUST stay within 150 ms of event time after seek (checked by comparing `audio.currentTime` to `t`); if audio fails to load, playback continues with captions only and a notice.
- R-WEB-103 A permanent `RECORDED` provenance badge MUST be visible; all write controls are disabled and say "Replay is read-only".
- R-WEB-104 Replay MUST be deterministic: the same bundle at the same offset yields byte-identical rendered state (reducer purity test).
- R-WEB-105 The view toggle MUST switch between console, screen and ladder views at the same time offset.

### 3.15 Error, empty, loading, offline

- R-WEB-106 Every data-bearing view MUST have defined empty, loading (skeleton, no spinner over 600 ms without text), error (message + retry) and offline states (section 8.12); a test enumerates routes against the states table.
- R-WEB-107 Network and PayPal errors MUST show a human message, a retry or alternative action, and a collapsible "Details" with the raw error code and correlation id.
- R-WEB-108 Error text MUST never include secrets, tokens or full PayPal ids.

### 3.16 Accessibility

- R-WEB-109 The app MUST meet WCAG 2.2 AA for the audited flows (register, bid, console, screen, audit, receipt); axe-core MUST report zero serious or critical violations in CI.
- R-WEB-110 One `Announcer` component owns two live regions (`polite`, `assertive`). Outbid and price changes use polite; kill switch, auction stopped, bid rejected on own action, and hold failure use assertive. Messages are deduped and rate limited (section 8.13).
- R-WEB-111 Focus: dialogs trap focus and restore it on close; route change focuses the `h1`; after a bid result focus stays on the bid button.
- R-WEB-112 Every control MUST be keyboard operable with a visible focus ring of at least 3:1 contrast and 2 px width; no keyboard trap.
- R-WEB-113 Press-and-hold controls (hammer, stop) MUST offer a keyboard alternative (focus then Enter opens a confirm dialog) and MUST NOT rely on hold alone.
- R-WEB-114 Reduced motion (R-WEB-017) and `forced-colors` MUST be tested; the ladder and status chips remain understandable in forced-colors mode.
- R-WEB-115 Text MUST reflow at 320 px width and with 200 percent zoom without horizontal scroll (except the audit table, which scrolls inside its own region).
- R-WEB-116 Form errors are associated by `aria-describedby`, announced on submit, and never rely on placeholder text.

### 3.17 Responsive and projector

- R-WEB-117 Breakpoints: 360 (phone), 768 (tablet), 1024 (laptop), 1920 (projector). Bidder screens are designed phone first; console desktop first; screen view targets 1920x1080 and 1280x720 and degrades by scaling with `clamp()`.
- R-WEB-118 Safe-area insets MUST be respected on bidder screens (`env(safe-area-inset-bottom)` for the quick-bid bar).
- R-WEB-119 Screen view MUST avoid text smaller than 28 px at 1920x1080 and avoid scrolling.

### 3.18 Copy

- R-WEB-120 The copy deck (section 11) is normative. The words "charged", "pay", "payment", "debited" MUST NOT appear in any string shown before a CAPTURED state, except in a negation ("not charged") or in the receipt keys marked `after_capture`.
- R-WEB-121 The phrase "Held, not charged" (exact capitalisation) MUST appear on the landing, the ceiling step, the approval step and the winner pre-capture state.
- R-WEB-122 A test MUST scan the catalog for the banned wording list in section 11.3.

### 3.19 Testing and tooling

- R-WEB-123 Every screen MUST have a component test per state in section 8, driven by a scenario fixture.
- R-WEB-124 Visual regression snapshots MUST exist for each screen at 390x844, 768x1024, 1440x900 and 1920x1080 in light and projector themes where applicable, with animations disabled and fixed fonts.
- R-WEB-125 Every interactive element used by end-to-end tests MUST carry `data-testid` from the contract in `src/testing/testids.ts`; ids are stable and documented.

## 4. Architecture

```
src/
  main.tsx  App.tsx  routes.tsx
  design/      tokens.css themes.css primitives/ (Button Chip Field Dialog Toast Banner Meter Sheet ...)
  copy/        en.ts  errors.ts (code -> key)  banned.ts
  wire/        index.ts (seam: re-export @gavel/shared types)  guards.ts
  net/         transport.ts  wsTransport.ts  scenarioTransport.ts  connection.ts  clock.ts
  store/       roomReducer.ts  roomStore.ts  selectors.ts  localEvents.ts
  payments/    port.ts  fakeAdapter.ts  paypalV6Adapter.ts  useApproval.ts
  screens/     landing/ demo/ join/ register/ bid/ console/ screen/ audit/ receipt/ replay/ gallery/ states/
  ladder/      Ladder.tsx LadderCompact.tsx ladderModel.ts
  a11y/        Announcer.tsx useFocus.ts
  audio/       micCapture.ts worklet.ts levelMeter.ts
  util/        money.ts time.ts csv.ts hash.ts
  testing/     testids.ts scenarios/ renderWithScenario.tsx
mock/          server.ts scenarios/*.json faults.ts
test/          unit/ component/ visual/
```

Data flow:

```
 WebSocketTransport / ScenarioTransport
        | Inbound (WireMessage + seq)             ^ Outbound (join, bid, confirm_response)
        v                                         |
   connection.ts (backoff, heartbeat, resume) ----+
        |
   roomReducer (pure) -> roomStore (useSyncExternalStore) -> selectors -> screens
        ^
   localEvents (pendingBid, tick, uiDismiss)
```

Library choices (all MIT/BSD/Apache, pinned by exact version in DEPS.md): react 18, react-router 6, vite 5, vitest, @testing-library/react, jest-axe or axe-core, @playwright/test (visual only), qrcode (client QR), no state library (store is ~80 lines over `useSyncExternalStore`), no CSS framework (tokens plus CSS modules), `@tanstack/react-virtual` for the bid stream.

## 5. Interfaces

### 5.1 Wire messages consumed (owner: realtime/shared; names fixed)

The web app depends only on these fields. If shared differs, shared wins and `src/wire/guards.ts` plus the drift test (T-WEB-002) fail loudly.

```ts
// All server -> client messages carry: { t: MessageName; seq: number; roomId: string; serverTime: number }
type MessageName =
  | 'join'
  | 'registered'
  | 'bid'
  | 'bid_accepted'
  | 'bid_rejected'
  | 'price'
  | 'state'
  | 'confirm_request'
  | 'confirm_response'
  | 'hammer'
  | 'settlement_update'
  | 'audit_event'
  | 'error';

interface RoomSnapshot {
  // t:'state'
  room: {
    id: string;
    name: string;
    status: 'LOBBY' | 'OPEN' | 'PAUSED' | 'CLOSING' | 'SETTLING' | 'DONE' | 'STOPPED';
    config: {
      minIncrementCents: number;
      reserveCents: number;
      softCloseMs: number;
      maxCeilingCents: number;
      minCeilingCents: number;
      lateEntry: boolean;
      mode: 'english' | 'proxy' | 'second_price';
    };
  };
  lot: { id: string; title: string; imageUrl?: string; closesAt?: number } | null;
  price: {
    currentCents: number | null;
    leaderPaddle: number | null;
    nextMinCents: number;
    bidCount: number;
  };
  bidders: Array<{
    paddle: number;
    name: string;
    holdState: SettlementState | 'NONE';
    ceilingCents?: number;
  }>;
  you?: { bidderId: string; paddle: number; ceilingCents: number; holdState: SettlementState };
  settlement?: SettlementView;
}

interface BidSend {
  t: 'bid';
  clientBidId: string;
  paddle: number;
  amountCents: number;
  source: 'qr' | 'manual' | 'voice';
}
interface BidRejected {
  t: 'bid_rejected';
  clientBidId: string;
  code: ErrorCode; // e.g. over_ceiling, below_increment, closed
  message: string;
  details?: Record<string, unknown>;
}
interface ConfirmRequest {
  t: 'confirm_request';
  confirmId: string;
  paddle: number;
  amountCents: number;
  transcript?: string;
  confidence?: number;
  expiresAt: number;
  addressee: 'bidder' | 'auctioneer' | 'both';
}
interface ConfirmResponse {
  t: 'confirm_response';
  confirmId: string;
  accept: boolean;
}
interface Hammer {
  t: 'hammer';
  lotId: string;
  winnerPaddle: number | null;
  priceCents: number | null;
  reserveMet: boolean;
}

interface HoldView {
  paddle: number;
  name: string;
  ceilingCents: number;
  state: SettlementState;
  capturedCents: number;
  releasedCents: number;
  reason?: string;
  verifiedBy: Array<{
    eventId: string;
    kind: 'webhook' | 'lookup';
    eventType?: string;
    at: number;
  }>;
  idSuffix: string;
} // last 6 chars only
interface SettlementView {
  lotId: string;
  phase: SettlementState;
  winnerPaddle: number | null;
  holds: HoldView[];
  invariants: { ok: boolean; violations: string[] };
}

type AuditKind =
  | 'bid'
  | 'confirm'
  | 'control'
  | 'stt_partial'
  | 'stt_final'
  | 'parse'
  | 'settlement'
  | 'kill';
interface AuditEvent {
  t: 'audit_event';
  id: string;
  kind: AuditKind;
  at: number;
  audioOffsetMs?: number;
  paddle?: number;
  transcript?: string;
  parsedCents?: number;
  confidence?: number;
  confirmed?: 'yes' | 'no' | 'auto';
  result?: 'accepted' | 'rejected';
  reason?: string;
  raw: unknown;
}
```

Requests to other areas (tracked as OQ-WEB-1..3): `seq` on every message, `clientBidId` echo, `stt_partial`/`stt_final`/`parse` audit kinds for the voice feed, `verifiedBy` on holds, control endpoint.

### 5.2 Transport

```ts
export interface Transport {
  connect(): void;
  send(msg: ClientMessage): void; // join | bid | confirm_response
  onMessage(cb: (m: ServerMessage) => void): Unsubscribe;
  onStatus(cb: (s: 'connecting' | 'open' | 'closed') => void): Unsubscribe;
  close(): void;
}
export interface ControlPort {
  // auctioneer only; HTTP POST /api/rooms/:id/control (OQ-WEB-2)
  open(lotId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  extend(ms: number): Promise<void>;
  hammer(lotId: string): Promise<void>;
  kill(confirm: 'STOP'): Promise<void>;
}
```

### 5.3 Payment approval port (PayPal JS SDK v6 contract)

```ts
export type ApprovalState =
  | 'idle'
  | 'preparing'
  | 'awaiting_buyer'
  | 'confirming'
  | 'held'
  | 'cancelled'
  | 'declined'
  | 'error';
export interface ApprovalRequest {
  roomId: string;
  bidderId: string;
  ceilingCents: number;
  clientRegistrationId: string;
}
export interface ApprovalResult {
  state: ApprovalState;
  holdIdSuffix?: string;
  errorCode?: string;
  correlationId?: string;
}
export interface PaymentApprovalPort {
  start(req: ApprovalRequest, on: (s: ApprovalState) => void): Promise<ApprovalResult>;
  cancel(): void;
}
```

Server contract the adapter relies on (owner: payments/realtime; confirm names there):

1. `POST /api/rooms/:id/orders` body `{ bidderId, ceilingCents, clientRegistrationId }` returns `{ orderId, clientToken? }`. The order is intent=AUTHORIZE, amount = ceiling.
2. Buyer approves in the PayPal UI opened by the SDK.
3. `POST /api/rooms/:id/holds` body `{ orderId, clientRegistrationId }` returns `{ holdIdSuffix, state:'HELD' }`; the server authorizes the order. The browser never calls PayPal APIs with secrets.

JS SDK v6 specifics: the exact v6 calls (instance creation, session type, button or popup presentation, `onApprove`, `onCancel`, `onError` payloads) are `UNVERIFIED (gate G2)`. The adapter isolates them in one file with a typed internal interface; the card/guest path authorizes in v6 (verified in G2). Fallback if v6 AUTHORIZE for card fails: PayPal-wallet buyers only, same port, redirect-style approval via the order's approve link and a return route `/r/:roomId/register?return=1&token=...` that calls step 3. Fallback if v6 itself fails: the redirect flow becomes the main path. The UI states in R-WEB-044 are identical in all three.

### 5.4 Clock and formatting

```ts
formatUsd(cents: number): string            // 35000 -> "$350.00"; whole dollars drop ".00" only on the big screen via formatUsdCompact
parseUsdToCents(input: string): number|null // "350" -> 35000; "350.5" -> 35050; "350.555" -> null; "-1" -> null
serverNow(offsetMs: number): number
formatCountdown(ms: number): string         // 61000 -> "1:01"; <=0 -> "0:00"
```

### 5.5 Mock server and scenario format

```ts
interface Scenario {
  name: string;
  description: string;
  roomConfig: RoomSnapshot['room']['config'];
  steps: Array<{
    at: number /*ms from start*/;
    emit?: ServerMessage;
    expectClient?: Partial<ClientMessage>;
    fault?: 'drop' | 'dup' | 'reorder' | 'disconnect' | 'delay:<ms>';
  }>;
}
```

Scenarios shipped: `happy`, `outbid_race`, `soft_close`, `ambiguous_confirm`, `rejections`, `winner_declined_fallback`, `failed_needs_review`, `kill_switch`, `reconnect_gap`, `late_entry_closed`, `big_room_200_bids`. Mock server: `npm run mock -w packages/web` serves ws on 8787 with `?scenario=` and `POST /__fault`.

## 6. State machines

### 6.1 Connection

```
        connect()                 open                    close/err
 IDLE ------------> CONNECTING ----------> OPEN ----------------------> CLOSED
                       ^   |                 |                             |
                       |   +-- close/err --> +                             |
                       +---------------- backoff timer <-------------------+
 OPEN: send join{resumeFromSeq}; on state msg -> SYNCED; gap -> RESYNCING (re-join) -> SYNCED
 UI: CLOSED for >2000 ms => offlineBanner=true; controls disabled; on SYNCED banner clears
```

### 6.2 Approval (bidder)

```
 idle -> preparing -> awaiting_buyer -> confirming -> held
            |              |   \            |
            v              v    \-> cancelled (back to ceiling step)
          error         declined / error  -> retry (new clientRegistrationId only if server says previous attempt is dead)
```

### 6.3 Pending bid

```
 (tap) -> PENDING --bid_accepted--> ACCEPTED
             |--bid_rejected--> REJECTED(code)
             |--4000 ms------> UNKNOWN (retry reuses clientBidId)
```

### 6.4 Ladder lane (per hold)

```
 HELD -> BIDDING -> WINNER_SELECTED -> CAPTURING -> CAPTURED -> (winner lane ends; remainder: VOIDING -> SETTLED)
 non-winner:  HELD/BIDDING -> VOIDING -> SETTLED
 branch:      WINNER_SELECTED|CAPTURING -> FALLBACK_RUNNER_UP (next lane becomes WINNER_SELECTED)
              any -> FAILED_NEEDS_REVIEW (terminal, banner)
```

The UI renders whatever `settlement_update` reports; it validates transitions only to warn in dev builds (an impossible transition is shown, not hidden).

### 6.5 Kill switch

```
 ARMED(visible) -> DIALOG(type STOP) -> HOLD(1500 ms) -> SENT -> STOPPED(all views)
        ^---- Esc / release early / wrong text ----+
```

## 7. Sequences

### 7.1 Register and hold

```
Bidder        Web                      Server              PayPal
  | scan QR     |                         |                    |
  |------------>| GET /join/:id           |                    |
  |             |-- join{room} ---------->|                    |
  | name,paddle,ceiling                   |                    |
  |------------>| POST /orders ---------->|-- create order --->|  (AUTHORIZE) verified G2
  |             |<-- orderId -------------|                    |
  |             |== SDK v6 approval UI ==============> buyer approves
  |             | POST /holds ----------->|-- authorize ----->|
  |             |<-- HELD, suffix --------|                    |
  |             |<-- registered, state ---|                    |
```

### 7.2 Voice bid with confirm

```
Mic -> voice -> server: stt_partial*, stt_final -> parse
server -> console: audit_event(stt_final), confirm_request{addressee:'auctioneer'|'both'}
console: Y  -> confirm_response{accept:true} -> server: validate -> bid_accepted + price
bidder phone: sheet "Did you mean 350 for paddle 12?" (if addressee includes bidder) - first response wins, server dedupes
```

### 7.3 Hammer to receipt

```
console: Hammer(hold 800ms) -> POST control hammer -> server: hammer{winner,price}
screen: "SOLD" ; ladder: WINNER_SELECTED skeleton ("Waiting for settlement")
server: settlement_update{phase:CAPTURING} -> ladder rung 4
server: settlement_update{phase:CAPTURED, holds[winner].verifiedBy+=webhook} -> tick, "Charged $350.00" appears on winner receipt
server: settlement_update{phase:VOIDING..SETTLED} -> others show "Released" ticks
```

## 8. Screens (states and wireframes)

Conventions in wireframes: `[ ]` button, `( )` chip, `{ }` input, `~~~` skeleton, `!!!` warning.

### 8.1 Landing `/`

```
+--------------------------------------------------+
| SANDBOX: no real money moves                     |
+--------------------------------------------------+
|  GAVEL                                           |
|  Every bid is a PayPal hold.                     |
|  Held, not charged until the hammer falls.       |
|                                                  |
|  [ Start a demo auction ]   [ Join with a code ] |
|  (SCRIPTED) (LIVE sandbox)  how it works v       |
|  Footer: source, license, no tracking            |
+--------------------------------------------------+
```

States: default; launcher-busy (button shows "Creating room"); server-down (inline notice + "Run scripted demo instead"); join-code invalid ("No room with that code").

### 8.2 Demo launcher `/demo`

```
 Pick a scenario:  (o) Live sandbox room   ( ) Scripted: happy path   ( ) Scripted: winner declined
 Provenance: LIVE = real sandbox holds; SCRIPTED = recorded events, no PayPal calls.
 [ Create room ]   -> after: Console [Open] Big screen [Open] Bidder QR [Show] Audit [Open]  (copy buttons)
```

States: idle, creating, created, failed (retry or scripted fallback).

### 8.3 Registration `/r/:id/register` (phone)

```
+------------------------+   Step 1 of 3  Name & paddle      Step 2 of 3  Ceiling       Step 3 of 3  Approve hold
| Spring Gala Auction    |   {Name______}                    ( ) $100 ( ) $250          Held, not charged.
| Step 2 of 3            |   {Paddle 12_}  (suggested)       (o) $500 ( ) $1000         PayPal holds $500 while the
| Choose your ceiling    |   [ Continue ]                    ( ) Custom {____}          auction runs. You are charged
| ( ) $100   ( ) $250    |                                   +--Held, not charged--+    only if you win, and only the
| (o) $500   ( ) $1000   |                                   | up to $500 held;     |   winning price.
| ( ) Custom             |                                   | charged only on win  |   [ Approve with PayPal ]
| Held, not charged ...  |                                   +----------------------+   [ Back ]
| [ Continue ]           |
+------------------------+
```

States: form-invalid (inline errors); paddle-taken (server says; suggests next free); ceiling-out-of-range; registration-closed; preparing; awaiting_buyer (screen dims, "Finish in the PayPal window", [Cancel]); confirming ("Creating your hold"); held (success card with suffix, [Continue to bidding]); cancelled ("No hold was created."); declined ("PayPal did not approve this hold." + retry or lower ceiling); error (details disclosure); offline.

### 8.4 QR join `/join/:id`

```
 Join Spring Gala Auction        (QR on the big screen; this page is where it lands)
 Code: K7M2QX   {enter code instead}
 [ Join as bidder ]   [ Just watch ]
```

States: resolving (skeleton), found, not found, room stopped/done ("This auction has ended" + receipt link if session), already registered (redirect).

### 8.5 Bid screen `/r/:id/bid` (phone, 390x844)

```
+------------------------------+
| SANDBOX  (o) connected       |
| Lot 3 of 8                   |
| [image]  Signed print        |
|                              |
|        $350.00               |   current price (tabular, 40px)
|   Leading: paddle 12 (you)   |
|   ( Leading )                |   status chip
|                              |
|  Ceiling  $350 of $500  [===----]   role=meter
|  inline rejection text here  |
+------------------------------+
| [ Bid $375 ]  [ +$25 ] [+$50]|   sticky bar, safe-area padded, 48px
| {Custom $____} [Place bid]   |
+------------------------------+
```

States: not-yet-bid, leading, outbid (chip + assertive-light polite announce), pending, rejected (inline), at ceiling (buttons disabled, "Above your ceiling"), paused, closed, stopped, won (links to receipt), lost, watching only (no controls), confirm sheet open, offline (buttons disabled + banner), resyncing ("Updating" chip), no lot yet ("Waiting for the first lot").

### 8.6 Console `/r/:id/console` (1440x900)

```
+---------------------------------------------------------------------------------------+
| SANDBOX | LIVE | Spring Gala | 18 bidders, 17 holds ok | (o)connected      [ STOP AUCTION ] |
+------------------------+-----------------------------------+--------------------------+
| LOT 3  Signed print    | BID STREAM                        | VOICE FEED  (mic: live)  |
| $350.00  next $375     | 14:02:11 #12 $350 voice 93% OK    | "three fifty paddle 12"  |
| leader #12 Priya       | 14:02:09 #7  $325 qr        OK    | (paddle 12, $350, .93)   |
| soft close 0:42        | 14:02:04 #9  $340 voice 61% ?     | partial: "three for..."  |
| bids 23                | 14:01:58 #3  $300 manual    REJ   | CONFIRM QUEUE            |
|                        |            below_increment        | > #9 $340? "three forty" |
| [Open][Pause][+30s]    |                                   |   0:07  [Y]es  [N]o      |
| [ Hammer (hold) ]      | Manual: {paddle} {amount} [Enter] | ...                      |
+------------------------+-----------------------------------+--------------------------+
| LADDER SUMMARY: o o o o o o o o o o o o o o o o o (17 held)         ? shortcuts          |
+---------------------------------------------------------------------------------------+
```

States: lobby (no lot; Open lot enabled), open, paused, closing (soft close running), settling (ladder summary live), done, stopped (red banner, controls disabled permanently), mic-off/denied/error, no confirms (empty "Nothing to confirm"), offline (controls disabled), clock-skew notice, resyncing, zero bids (empty "No bids yet"), 200+ bids (virtualized).
Hammer dialog: "Hammer at $350.00 to paddle 12 (Priya)? [Hold to hammer 0.8 s] [Cancel]".
Kill dialog: text per copy `kill.*`; input `{type STOP}`; [Hold 1.5 s to stop] disabled until text matches.

### 8.7 Ladder `/r/:id/audit#ladder`, console strip, receipts

```
 SETTLEMENT  Lot 3  winner #12 Priya  $350.00           invariants: ok (captured 35000 + released 215000 = holds 250000)
 Paddle  Name    Ceiling   HELD  BIDDING  WINNER  CAPTURING  CAPTURED  VOIDING  SETTLED   Verification
 #12   Priya    $500.00    [v]    [v]      [v]      [v]        [*]       .        .       Confirmed by PayPal webhook PAYMENT.CAPTURE.COMPLETED 14:03:02   captured $350.00
 #7    Sam      $250.00    [v]    [v]       .        .          .        [v]      [*]      Confirmed by lookup 14:03:05                                        released $250.00
 #9    Ana      $100.00    [v]    [v]       .        .          .        [v]      [ ]      Awaiting confirmation
 [v] done  [*] current  [ ] pending  (icons differ, not just colour)
 Event log: 14:03:02 webhook ... / 14:03:05 lookup ...
```

Narrow (phone) layout: one card per hold with a vertical stepper. Branch rows: "Winner declined: hold expired. Runner-up #7 selected" (fallback) and a red `FAILED_NEEDS_REVIEW` banner. Webhook event type strings shown are copied verbatim from the server; names are UNVERIFIED (G4) until real sandbox events are captured, so the UI renders any string.
States: no settlement yet (skeleton, "Waiting for settlement"), in progress, complete, fallback, failed, invariant violation, replay-driven.

### 8.8 Public screen `/r/:id/screen` (1920x1080)

```
+----------------------------------------------------------------------------+
|  Spring Gala Auction                              [QR]  Join: K7M2QX       |
|  LOT 3  Signed print                                                       |
|                                                                            |
|                       $350                                                 |
|                 Leading: paddle 12                                         |
|                    soft close 0:42                                         |
|  Latest: #12 $350   #7 $325   #9 $300   #12 $275   #3 $250                 |
+----------------------------------------------------------------------------+
```

States: lobby ("Starting soon"), open, closing, hammer ("SOLD to paddle 12 for $350" or "Passed"), settled (ladder summary bar), stopped ("Auction stopped"), reconnecting chip, no bids ("Opening bid $X").

### 8.9 Audit `/r/:id/audit`

```
 Filters: paddle {__} result (all) source (all) confidence < {__}  search {________}   [Export CSV][Export JSON]
 seq  time      audio     transcript            paddle $amt  conf  confirmed result    reason
 41   14:02:11  00:12.480 "three fifty 12"      12     350   .93   auto      accepted
 40   14:02:04  00:05.100 "three forty"         9      340   .61   yes       accepted
 39   14:01:58  -         (manual)              3      300   -     -         rejected  below_increment
 [row click -> drawer: raw event JSON, hold ids suffix, related confirm]
```

States: loading skeleton, empty ("No events yet"), filtered-empty ("No rows match" + clear filters), error, live (append), settled (read-only), large (virtualized).

### 8.10 Receipt `/r/:id/receipt`

Winner: item, "Capturing your payment" then "Charged $350.00", capture suffix, time, [Download JSON] [Print]. Non-winner: "Releasing your hold" then "You did not win. Your $250.00 hold was released.", a single ladder row. Fallback and failure per R-WEB-097/098. States: pending, final, fallback, failed, not registered ("No receipt for this session"), stopped.

### 8.11 Replay `/replay/:id`

```
 RECORDED  Spring Gala demo (3:12)   view: (console)(screen)(ladder)        Replay is read-only
 [ render of chosen view at offset ]
 |<  [>] 1x  >|   0:00 ---o----------------------------- 3:12   chapters: reg | first bid | confirm | hammer | settle
 captions: "three fifty paddle twelve"                     audio: loaded / captions only
```

States: loading bundle, bundle invalid (version/shape error message), audio failed (captions only), playing, paused, ended (restart), seeking.

### 8.12 State coverage table (R-WEB-106)

| Route    | empty                | loading                 | error                    | offline                           |
| -------- | -------------------- | ----------------------- | ------------------------ | --------------------------------- |
| landing  | n/a                  | n/a                     | launcher failure notice  | banner, scripted demo still works |
| register | n/a                  | room resolving skeleton | approval error + details | disabled approve + banner         |
| join     | not found            | skeleton                | server error + retry     | banner                            |
| bid      | no lot               | skeleton                | error panel              | disabled buttons + banner         |
| console  | no bids, no confirms | skeleton                | error panel              | disabled controls + banner        |
| screen   | starting soon        | skeleton                | frozen last state + chip | frozen + chip                     |
| audit    | no events            | skeleton                | retry                    | cached rows + banner              |
| receipt  | no receipt           | pending states          | failure receipt          | cached receipt + banner           |
| replay   | n/a                  | bundle loading          | invalid bundle           | works (local file or cached)      |

### 8.13 Live-region policy

- One `Announcer`, two regions. Polite queue max length 3, drops oldest, merges "price" messages (announce latest only), 2000 ms minimum gap.
- Assertive: stop, bid rejected (own action), hold failure, offline longer than 5 s. Never announce partial transcripts.
- Messages: `Price is now $350. Paddle 12 is leading.` / `You have been outbid. Current price $350.` / `Auction stopped.`
- Screen view and ladder ticks announce only summarised sentences.

## 9. Error and edge cases

- Duplicate, reordered or missing messages: ignore by seq, resync by snapshot (T-WEB-010..012).
- Bid taps during resync or offline: disabled; a bid sent just before disconnect resolves from the snapshot (`you.lastBid`) or becomes `unknown`.
- Two devices for one bidder: second join is allowed; both show the same state; confirm_response is first-wins on the server and the loser sees "Already answered".
- Price changes while the confirm sheet is open: the sheet stays but shows "Price changed to $360"; Yes sends the response, the server revalidates.
- Ceiling smaller than next minimum: bid buttons disabled with text; status `At your ceiling`.
- Soft close extends while countdown shown: countdown jumps; announce once ("Extended by 30 seconds").
- Clock skew > 2 s: countdown still follows server time via offset; notice on console only.
- Mic permission denied or no device: console voice feed shows the error and the manual entry stays primary; QR flow unaffected.
- Browser without `crypto.subtle`: audit export hash row says "hash unavailable" (still exports).
- Hold approval popup blocked: message with "Open PayPal in this tab" (redirect fallback).
- Returning from PayPal redirect with a stale token: show "Approval expired. Start again." and keep the ceiling choice.
- Storage blocked (private mode): app works; returning-bidder shortcut is lost; a notice appears on the receipt page only.
- Very long display names: truncate with ellipsis at 24 chars, full name in `title` and in the audit row.
- Paddle numbers above 999 or non-integer: rejected inline.
- Lot list empty or room DONE: bid screen shows the receipt link when applicable.
- Settlement with 0 non-winner holds: ladder shows only the winner lane and "No other holds".
- No winner (reserve not met): screen shows "Passed"; ladder shows all lanes going to VOIDING/SETTLED, no capture, invariants `captured 0`.
- Webhook arrives before the capture API response: ladder shows the verification line first; state stays whatever the server reports.
- Unknown settlement state string: render as raw text chip and a dev warning; never crash.

## 10. Non-functional

- Latency: pending bid indicator within 50 ms of tap; price update to paint within 100 ms of message receipt (p95 on the projector profile, measured in a Playwright trace); reducer step under 1 ms for a 200-bidder snapshot (benchmark test).
- Rendering: bid stream virtualized above 200 rows; console remains at 60 fps with 5 bids/s; no layout shift on price change (CLS 0 in the visual test).
- Determinism: reducer and ladder model are pure and have property tests; replay is deterministic (R-WEB-104).
- Security: no secrets in the bundle (CI grep for key patterns), CSP (R-WEB-004), tokens kept out of logs and out of `localStorage`, auctioneer token only in fragment and memory, strict input validation by guards before reducing, no `dangerouslySetInnerHTML`, transcript text always rendered as text.
- Privacy: no analytics, no third-party requests except PayPal SDK on approval; display names visible to the room are shown on registration with a notice.
- Bundle: initial route at most 190 KB gzip (R-WEB-009), checked in CI by a size script.
- Browser support: last 2 versions of Chrome, Safari iOS 16+, Firefox, Edge. Web Speech try-it mode only where available.

## 11. Copy deck

### 11.1 Rules

1. Sentence case, no exclamation marks, no emoji, no jargon (say "hold" not "authorization" in primary copy; "authorization" appears only in details disclosures and the ladder tooltip).
2. Before CAPTURED, money is "held". After CAPTURED, money is "charged".
3. Every amount is shown with currency symbol and two decimals except the big screen (whole dollars when cents are zero).
4. The sandbox banner text is constant: `Sandbox: no real money moves`.

### 11.2 Strings (key: text)

Global

- `app.name`: GAVEL
- `banner.sandbox`: Sandbox: no real money moves
- `prov.live`: Live sandbox room
- `prov.scripted`: Scripted demo: recorded events, no PayPal calls
- `prov.recorded`: Recorded: this is a replay
- `net.offline`: You are offline. Reconnecting.
- `net.reconnecting`: Reconnecting
- `net.resyncing`: Updating
- `net.back`: Back online
- `generic.error`: Something went wrong. Try again.
- `generic.details`: Details
- `generic.retry`: Try again
- `generic.back`: Back
- `generic.close`: Close
- `generic.copy`: Copy
- `generic.copied`: Copied

Landing and launcher

- `landing.title`: Every bid is a PayPal hold.
- `landing.promise`: Held, not charged until the hammer falls.
- `landing.explain`: Bidders approve a hold as their ceiling. The winner is charged the winning price. Every other hold is released.
- `landing.start`: Start a demo auction
- `landing.join`: Join with a code
- `landing.codeInvalid`: No room with that code.
- `demo.creating`: Creating room
- `demo.failed`: We could not reach the server.
- `demo.scriptedInstead`: Run scripted demo instead
- `demo.roleConsole`: Auctioneer console
- `demo.roleScreen`: Big screen
- `demo.roleBidder`: Bidder QR
- `demo.roleAudit`: Audit trail

Registration

- `reg.step1`: Your name and paddle
- `reg.name`: Display name
- `reg.nameHint`: Shown to the room.
- `reg.paddle`: Paddle number
- `reg.paddleTaken`: Paddle {n} is taken. Try {m}.
- `reg.step2`: Choose your ceiling
- `reg.custom`: Custom amount
- `reg.customRange`: Enter a whole dollar amount from {min} to {max}.
- `reg.heldNotCharged`: Held, not charged.
- `reg.heldExplain`: PayPal holds up to {amount} while the auction runs. You are charged only if you win, and only the winning price. The rest is released.
- `reg.holdIsNotPayment`: A hold is an authorization, not a payment.
- `reg.approve`: Approve hold with PayPal
- `reg.awaiting`: Finish in the PayPal window.
- `reg.confirming`: Creating your hold
- `reg.held`: Your hold of {amount} is in place.
- `reg.heldRef`: Reference ending {suffix}
- `reg.continue`: Continue to bidding
- `reg.cancelled`: No hold was created.
- `reg.declined`: PayPal did not approve this hold. Try again or choose a lower ceiling.
- `reg.popupBlocked`: The PayPal window was blocked. Open PayPal in this tab.
- `reg.expired`: Approval expired. Start again.
- `reg.closed`: Registration is closed for this auction. You can watch.
- `reg.watch`: Watch only

Join

- `join.title`: Join {room}
- `join.code`: Code {code}
- `join.enterCode`: Enter a code instead
- `join.asBidder`: Join as bidder
- `join.watch`: Just watch
- `join.ended`: This auction has ended.
- `join.notFound`: We could not find this auction.

Bid screen

- `bid.waitingLot`: Waiting for the first lot
- `bid.price`: Current price
- `bid.leader`: Leading: paddle {n}
- `bid.leaderYou`: Leading: paddle {n} (you)
- `bid.status.leading`: Leading
- `bid.status.outbid`: Outbid
- `bid.status.none`: Not bidding yet
- `bid.status.pending`: Bid pending
- `bid.status.atCeiling`: At your ceiling
- `bid.status.won`: Won
- `bid.status.lost`: Lost
- `bid.status.watching`: Watching only
- `bid.quick`: Bid {amount}
- `bid.plus`: +{amount}
- `bid.custom`: Your amount
- `bid.place`: Place bid
- `bid.aboveCeiling`: Above your ceiling
- `bid.ceilingMeter`: Ceiling {used} of {max}
- `bid.rej.over_ceiling`: That is above your ceiling of {max}.
- `bid.rej.below_increment`: The next bid must be at least {min}.
- `bid.rej.closed`: This lot is closed.
- `bid.rej.already_leading`: You are already leading.
- `bid.rej.below_reserve`: Below the reserve price.
- `bid.rej.unregistered`: You need a hold to bid.
- `bid.rej.generic`: Bid not accepted.
- `bid.unknown`: We have not heard back. Your bid is safe to resend.
- `bid.paused`: Paused by the auctioneer
- `bid.closedBanner`: Lot closed
- `bid.stoppedBanner`: Auction stopped
- `bid.announce.price`: Price is now {amount}. Paddle {n} is leading.
- `bid.announce.outbid`: You have been outbid. Current price {amount}.
- `bid.vibrate`: Vibrate when outbid
- `confirm.title`: Did you mean {amount} for paddle {n}?
- `confirm.yes`: Yes, that is my bid
- `confirm.no`: No
- `confirm.changed`: Price changed to {amount}
- `confirm.answered`: Already answered
- `confirm.expired`: This question expired. Say your bid again.
- `confirm.secondsLeft`: {s} s left
- `confirm.sent`: Your answer was sent.
- `confirm.refused`: Your answer could not be sent.

Console

- `console.bidders`: {n} bidders, {m} holds in place
- `console.holdWarn`: Hold needs attention
- `console.stream`: Bid stream
- `console.noBids`: No bids yet
- `console.voice`: Voice feed
- `console.mic.off`: Microphone off
- `console.mic.requesting`: Asking for microphone access
- `console.mic.live`: Listening
- `console.mic.denied`: Microphone blocked. Use manual entry.
- `console.notBid`: Not a bid
- `console.confirmQueue`: Confirm queue
- `console.noConfirm`: Nothing to confirm
- `console.manual`: Manual entry
- `console.open`: Open lot
- `console.pause`: Pause
- `console.resume`: Resume
- `console.extend`: Extend {s} s
- `console.hammer`: Hammer
- `console.hammerHold`: Hold to hammer
- `console.hammerConfirm`: Hammer at {amount} to paddle {n} ({name})?
- `console.hammerNoBids`: Close with no sale?
- `console.skew`: This device clock differs from the server by {s} s. Countdowns use server time.
- `console.shortcuts`: Keyboard shortcuts
- `kill.button`: Stop auction
- `kill.title`: Stop the auction?
- `kill.consequence`: Bidding ends for everyone now. No winner is chosen. All holds are released. This cannot be undone.
- `kill.type`: Type STOP to continue
- `kill.hold`: Hold to stop
- `kill.stopped`: Auction stopped

Big screen

- `screen.lobby`: Starting soon
- `screen.opening`: Opening bid {amount}
- `screen.latest`: Latest
- `screen.sold`: SOLD to paddle {n} for {amount}
- `screen.passed`: Passed
- `screen.join`: Join: {code}
- `screen.settleSummary`: {c} captured, {r} released
- `screen.stopped`: Auction stopped

Audit

- `audit.title`: Audit trail
- `audit.export.csv`: Export CSV
- `audit.export.json`: Export JSON
- `audit.empty`: No events yet
- `audit.noMatch`: No rows match these filters.
- `audit.clear`: Clear filters
- `audit.confirmed.auto`: Not needed
- `audit.hash`: Row checksum (SHA-256)

Ladder

- `ladder.title`: PayPal hold status
- `ladder.waiting`: Waiting for settlement
- `ladder.state.HELD`: Held
- `ladder.state.BIDDING`: In the auction
- `ladder.state.WINNER_SELECTED`: Winner selected
- `ladder.state.CAPTURING`: Charging winning price
- `ladder.state.CAPTURED`: Charged
- `ladder.state.VOIDING`: Releasing hold
- `ladder.state.SETTLED`: Released
- `ladder.state.FALLBACK_RUNNER_UP`: Runner-up selected
- `ladder.state.FAILED_NEEDS_REVIEW`: Needs review
- `ladder.verify.webhook`: Confirmed by PayPal webhook {type} at {time}
- `ladder.verify.lookup`: Confirmed by lookup at {time}
- `ladder.verify.pending`: Awaiting confirmation
- `ladder.remainderVoided`: Remainder voided
- `ladder.invariants.ok`: Totals check out: charged {c} + released {r} = holds {h}
- `ladder.invariants.bad`: Needs review: totals do not match
- `ladder.fallback`: Winner could not be charged ({reason}). Runner-up paddle {n} selected.
- `ladder.failed`: Settlement stopped for review. See the audit trail.

Receipts (keys marked after_capture are exempt from R-WEB-120)

- `receipt.capturing`: Capturing your payment
- `receipt.charged` (after_capture): Charged {amount}
- `receipt.releasing`: Releasing your hold
- `receipt.released`: You did not win. Your {amount} hold was released.
- `receipt.fallback` (after_capture): Another bidder could not be charged, so you are the winner. Charged {amount}.
- `receipt.failed`: We could not complete this payment. Nothing more will be charged until the organizer reviews it.
- `receipt.none`: No receipt for this session.
- `receipt.download`: Download JSON
- `receipt.print`: Print

Replay

- `replay.readonly`: Replay is read-only
- `replay.captionsOnly`: Audio could not load. Showing captions only.
- `replay.invalid`: This recording could not be read.
- `replay.speed`: Speed {x}
- `replay.chapter.reg`: Registrations
- `replay.chapter.bid`: First bid
- `replay.chapter.confirm`: Confirmation
- `replay.chapter.hammer`: Hammer
- `replay.chapter.settle`: Settlement

Errors and states

- `err.notFound`: Page not found
- `err.boundary`: This screen hit a problem.
- `err.reload`: Reload
- `err.tokenMissing`: This link is missing or expired.
- `err.newLink`: Create a new room
- `err.details`: Details: code {code}, reference {ref}

### 11.3 Banned wording check (R-WEB-122)

Before CAPTURED (every key except those marked after_capture): `charged` (unless preceded by "not " or "only if"), `pay `, `payment`, `debit`, `billed`, `deducted`, `fee`. Also banned everywhere: any claim of what PayPal does with funds beyond our own state (for example "your bank will show", "balance reduced"), and any marketing superlative ("first", "best", "revolutionary"). The catalog test also asserts every key is referenced from source and every `{param}` used exists.

## 12. Test specification

Tooling: Vitest + React Testing Library + jest-dom for unit and component tests; axe-core in component tests; Playwright (in GitHub Actions only) for visual and keyboard checks. All run in CI, none on the 2-CPU VM. Fixtures live in `src/testing/scenarios`.

### 12.1 Unit and property

- T-WEB-001 (R-WEB-005) `parseUsdToCents`: inputs `"350"->35000`, `"350.5"->35050`, `"350.55"->35055`, `"350.555"->null`, `""->null`, `"-1"->null`, `"1e3"->null`, `"0"->null`; property: for integer cents c in [1, 10^9], `parseUsdToCents(formatUsd(c)) === c`.
- T-WEB-002 (R-WEB-007) Wire drift: type-level test asserts every `MessageName` handled by `guards.ts` equals the shared union; guard accepts every fixture message and rejects 20 mutated messages (missing seq, wrong types).
- T-WEB-003 (R-WEB-006) Clock: with offset +5000 and local time frozen, `formatCountdown` for `closesAt = serverNow+61000` is `1:01`; negative remaining shows `0:00`.
- T-WEB-004 (R-WEB-014) `formatUsd`: 0 -> "$0.00", 5 -> "$0.05", 123456789 -> "$1,234,567.89"; compact variant drops `.00` only.
- T-WEB-005 (R-WEB-083) CSV: fields with comma, quote, newline, leading `=`/`+`/`-`/`@` (prefixed with a single quote to block spreadsheet formula injection) round-trip through an RFC 4180 parser; snapshot of header.
- T-WEB-006 (R-WEB-084) Hash: SHA-256 of canonical JSON of fixture rows equals a known hex; reordering keys does not change it; changing one amount does.
- T-WEB-007 (R-WEB-027) Error table: every code exported by shared maps to a copy key; unknown code maps to generic and keeps raw code.
- T-WEB-008 (R-WEB-002, R-WEB-120..122) Copy: no JSX literal strings (AST scan); banned wording scan; unused-key and missing-param checks; `Held, not charged` present in required keys.
- T-WEB-009 (R-WEB-013) Contrast: every declared fg/bg token pair in all three themes >= 4.5 (3.0 for pairs tagged `large` or `ui`).

### 12.2 Store and connection

- T-WEB-010 (R-WEB-021) Replay of seq `[1,2,2,3]` leaves state equal to `[1,2,3]`.
- T-WEB-011 (R-WEB-021, R-WEB-022) Gap `[1,2,5]` sets `resyncing`, emits one `join{resumeFromSeq:2}`, then a `state` snapshot at seq 9 clears it and later seq 10 applies.
- T-WEB-012 (R-WEB-020) Property: for 200 random shuffles of a valid sequence with duplicates, the final state after snapshot recovery equals the in-order state (fast-check, 100 runs).
- T-WEB-013 (R-WEB-023) Backoff with fake timers: delays within jitter of 500,1000,2000,4000,8000,8000; success resets to 500.
- T-WEB-014 (R-WEB-024) Disconnect for 1900 ms: no banner; 2100 ms: banner and bid button `aria-disabled`.
- T-WEB-015 (R-WEB-025) Pending bid: accepted case, rejected `over_ceiling` case, silent case reaching `unknown` at 4000 ms and resending with the same `clientBidId`.
- T-WEB-016 (R-WEB-028) Navigating room A to room B resets store (no leaked leader paddle).
- T-WEB-017 (R-WEB-029) Storage throws on every call: registration and bidding still work.
- T-WEB-018 (R-WEB-026) Skew 2500 ms: notice on console, none on bidder screen.

### 12.3 Payments port

- T-WEB-020 (R-WEB-044, R-WEB-048) Fake adapter in modes `ok`, `cancel`, `decline`, `slow` (3 s), `error`: state sequence matches section 6.2 exactly for each.
- T-WEB-021 (R-WEB-047) Double click on Approve and back/forward: exactly one `POST /orders` (mock fetch counts); re-entering after held shows existing hold.
- T-WEB-022 (R-WEB-043) Import boundary: lint/depcheck test fails if any file outside `paypalV6Adapter.ts` imports the PayPal SDK module.
- T-WEB-023 (R-WEB-045) Cancelled keeps the ceiling choice and shows `reg.cancelled`.
- T-WEB-024 (G2 UNVERIFIED) Contract test of `paypalV6Adapter` against a stubbed SDK object implementing the typed internal interface; real-SDK run is a manual gate checklist recorded in docs/GATES.md.

### 12.4 Screens

- T-WEB-030 (R-WEB-035..038) Landing and launcher states table: default, busy, server-down shows scripted fallback, invalid code message.
- T-WEB-031 (R-WEB-040..042) Registration validation: name `""`, 25 chars; paddle 0, 1000, taken (server error); custom ceiling 99, 100, 1000, 1001 with cap 1000; Continue enabled only when valid; held-not-charged block present with amount interpolated before the approve button is enabled.
- T-WEB-032 (R-WEB-050..052) QR: renders offline (no network request), alt text contains URL, decoding the rendered canvas with a decoder library in the test returns the URL; returning bidder redirects to `/bid`.
- T-WEB-033 (R-WEB-053..059) Bid screen with `happy` scenario: initial price, leading chip after accepted bid, outbid chip and polite announcement on a rival bid, above-ceiling button disabled with text, double tap sends one `bid`, rejection `below_increment` text and auto-clear after 6000 ms.
- T-WEB-034 (R-WEB-061) Confirm sheet: opens on request addressed to bidder; Yes sends one response; second tap ignored; expires at `expiresAt`; price-changed note.
- T-WEB-035 (R-WEB-062) States paused/closed/stopped disable controls and show banners.
- T-WEB-036 (R-WEB-063..066) Console renders lot, price header, stream rows with source icon and confidence, voice partial vs final styling, parse chip, "Not a bid" chip; 250-row fixture renders under 50 DOM rows (virtualized).
- T-WEB-037 (R-WEB-067) Confirm queue keyboard: `J/K` selection, `Y` sends accept for the selected, `N` reject; shortcuts ignored while the manual input has focus.
- T-WEB-038 (R-WEB-068) Manual entry: paddle 12, amount 350 -> one `bid` with `source:"manual"`; rejection text beside field.
- T-WEB-039 (R-WEB-069..070) Controls: disabled reasons per state; hammer needs 800 ms hold (fake timers: 799 ms no send, 800 ms send once) and Enter-on-dialog alternative.
- T-WEB-040 (R-WEB-071, R-WEB-113) Kill: Stop button disabled until `STOP` typed (case-sensitive), hold 1499 ms no send, 1500 ms one send, Esc cancels, all views show stopped on `STOPPED` status; assertive announcement fires once.
- T-WEB-041 (R-WEB-075..079) Screen view: price element font-size >= 160 px at 1920x1080 (computed style in Playwright), ticker shows exactly last 5 accepted bids, QR visible until lot closed, "SOLD" and "Passed" texts, freeze on disconnect (not blank).
- T-WEB-042 (R-WEB-080..085) Audit: column set, filters combine (paddle 12 AND result rejected), filters round-trip through URL, sort toggles `aria-sort`, live append keeps scroll unless at bottom, row drawer shows raw JSON.
- T-WEB-043 (R-WEB-083) Export: file names `gavel-<room>-<lot>-audit.csv/json`, row counts equal filtered vs full, header block includes hash.
- T-WEB-044 (R-WEB-086..094) Ladder: render each scenario (`happy`, `winner_declined_fallback`, `failed_needs_review`); assert order of rungs, check icons vs hollow, verification line text variants, tick idempotent for duplicate `eventId`, invariant violation banner when fixture sums mismatch (captured 35000 + released 200000 vs holds 250000), "released" text absent until server state voided.
- T-WEB-045 (R-WEB-095..099) Receipts: before CAPTURED the text `Charged` is absent (assert against DOM); after CAPTURED present; non-winner text appears only after voided; failure receipt text; print stylesheet hides buttons (Playwright print emulation); JSON download content equals the settlement view.
- T-WEB-046 (R-WEB-100..105) Replay: load fixture bundle; scrub to chapter `hammer` renders console state identical to live reducer at same `t` (deep equal); speed 4x advances 4x with fake timers; audio drift test within 150 ms using a stub media element; audio load failure shows captions-only; write controls disabled; `RECORDED` badge present in every view.
- T-WEB-047 (R-WEB-104) Property: reduce(bundle events up to t) is pure: same input twice yields equal output and no mutation (deep freeze inputs).

### 12.5 States, accessibility, responsive, visual

- T-WEB-050 (R-WEB-106..108) State coverage: parameterised over section 8.12 table; each cell renders without throwing and contains its expected copy key; error details never contain token-like strings (regex scan).
- T-WEB-051 (R-WEB-109) axe-core on every screen in every state fixture: zero serious or critical.
- T-WEB-052 (R-WEB-110) Announcer: 10 price updates in 1 s produce at most 1 polite announcement; stop produces assertive immediately; partial transcripts never announced.
- T-WEB-053 (R-WEB-111..112) Keyboard walk (Playwright): register -> approve (fake) -> bid using only keyboard; dialogs trap and restore focus; focus ring contrast >= 3:1 measured from computed outline colour.
- T-WEB-054 (R-WEB-114) `prefers-reduced-motion`: computed `animation-duration` of hammer and tick elements is 0s; forced-colors screenshot of ladder keeps visible state markers (visual test).
- T-WEB-055 (R-WEB-115, R-WEB-117..119) Reflow at 320 px and 200 percent zoom: `document.scrollingElement.scrollWidth <= innerWidth` on bidder routes; safe-area padding present on quick-bid bar; screen view has no vertical scroll at 1920x1080 and 1280x720.
- T-WEB-056 (R-WEB-124) Visual regression: matrix of screens x viewports x themes, `maxDiffPixelRatio 0.002`, animations disabled, fonts self-hosted, clock frozen; baseline update through workflow_dispatch producing an artifact, reviewed in the PR.
- T-WEB-057 (R-WEB-009) Bundle size gate: initial route gzip <= 190 KB; PayPal SDK, QR, replay chunks not in initial graph.
- T-WEB-058 (R-WEB-003, R-WEB-004) Network audit: Playwright records all requests during the demo flow; only self, room host and (on approval step) PayPal origins; CSP header or meta present with no `unsafe-inline` for scripts.
- T-WEB-059 (R-WEB-125) Test id contract: every id in `testids.ts` exists in at least one rendered state; no duplicate ids on a page.
- T-WEB-060 (R-WEB-030..034) Routing: each route sets title and focuses `h1`; console without token shows `err.tokenMissing`; 404 and error boundary include the sandbox banner.
- T-WEB-061 (R-WEB-010) Config: missing `VITE_API_BASE` fails at boot with a readable message; build fails when `VITE_SANDBOX` is not `true`.
- T-WEB-062 (R-WEB-065, performance) 200-bidder snapshot reduces in under 1 ms median (benchmark, threshold relaxed 5x on CI); 5 bids/s for 60 s in the console fixture drops no frames above 50 ms long-task budget (Playwright trace, advisory not blocking).
- T-WEB-063 (Mock server) Fault injection matrix: `drop`, `dup`, `reorder`, `disconnect`, `delay:1500` on the `happy` scenario each ends in the same final store state as the clean run.
- T-WEB-064 (R-WEB-092) Fallback scenario: ladder shows reason text and highlights runner-up lane; receipts for both bidders match R-WEB-097.

Visual matrix (T-WEB-056): landing, register steps 1-3 and each approval state, bid (leading, outbid, paused, closed), console (open, hammer dialog, kill dialog, stopped), screen (open, sold, passed, stopped), audit (filled, empty, filtered), ladder (in progress, complete, fallback, failed, narrow), receipts (4), replay. Viewports 390x844, 768x1024, 1440x900, 1920x1080 as relevant to the role.

## 13. Demo path (what the video and judges see)

1. `/demo` creates a LIVE sandbox room (or SCRIPTED fallback) with provenance label visible.
2. Two bidders register on phones, approve holds, "Held, not charged" visible at the ceiling step.
3. Big screen on the projector; QR joins a third bidder.
4. Voice bid on the console shows partial -> final -> chip; ambiguous bid hits the confirm queue and the bidder sheet.
5. Hammer: SOLD banner; ladder animates CAPTURING -> CAPTURED with webhook ticks; others VOIDING -> SETTLED.
6. Crash and resume scene: the connection manager shows Reconnecting, then the ladder resumes from the server snapshot.
7. Audit trail export and replay mode of the recording, with RECORDED badge.

## 14. Open questions

| Id       | Question                                                                                                                                                | Decision owner           | Default if undecided                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| OQ-WEB-1 | Per-room `seq` on every server message, `clientBidId` echo on accepted/rejected, `verifiedBy` on holds, `stt_partial`, `stt_final`, `parse` audit kinds | realtime (REALTIME lead) | Web adds a local adapter that synthesizes seq per connection and treats gaps as impossible; voice feed shows finals only |
| OQ-WEB-2 | Auctioneer controls and kill: HTTP endpoint or a control message over the socket; does kill void all holds                                              | realtime + payments      | HTTP `POST /control`; kill freezes bidding and voids all holds (copy `kill.consequence` as written)                      |
| OQ-WEB-3 | What the PayPal JS SDK v6 approval UI looks like for guest/card buyers with intent AUTHORIZE (G2)                                                       | payments                 | PayPal-wallet buyers via the SDK or redirect link; card path hidden behind `VITE_CARD_PATH=false`                        |
| OQ-WEB-4 | Does the remainder of a partially captured hold release automatically (G1)                                                                              | payments                 | Ladder shows explicit "Remainder voided" step; wording per R-WEB-094                                                     |
| OQ-WEB-5 | Recording bundle format for replay (events.json version, audio codec)                                                                                   | quality (video) + voice  | `events.json` v1 = array of `{t, msg}` plus `audio.mp3`; bundle validated by a zod schema in web                         |
| OQ-WEB-6 | Hosting of the web app (Render static vs Cloudflare Pages) affects CSP headers vs meta                                                                  | infra                    | CSP via meta tag plus header when available                                                                              |
| OQ-WEB-7 | Show bidder display names on the big screen or paddle only                                                                                              | Project owner            | Paddle only; names only on console and audit                                                                             |
| OQ-WEB-8 | Image source for lots (uploaded, URL, none)                                                                                                             | Project owner            | Static demo images bundled in the repo; optional `imageUrl`                                                              |
