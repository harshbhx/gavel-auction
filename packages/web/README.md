# @gavel/web

The browser client for the auction: React 18, Vite and strict TypeScript. It renders the
bidder, auctioneer console, public screen, audit and replay views from the wire types in
`@gavel/shared`. All money is integer cents. All user text lives in `src/copy`.

## Setup

Install once at the repository root. Do not run `npm install` inside this package.

```
npm ci
```

Node 22 is required.

## Run the web app

From the repository root:

```
npm run dev -w @gavel/web
```

This starts Vite. Other package scripts, all run the same way with `-w @gavel/web`:

| Script      | What it does                             |
| ----------- | ---------------------------------------- |
| `build`     | Type-check, then produce a Vite bundle   |
| `preview`   | Serve the built bundle locally           |
| `test`      | Run the package unit and component tests |
| `lint`      | ESLint with zero warnings allowed        |
| `typecheck` | `tsc --noEmit`                           |

Root scripts that cover this package as well: `npm run lint`, `npm run typecheck`,
`npm run format:check`, `npm run check:ascii` and `npm test`.

## Configuration

The client reads these variables at build time and refuses to start when one is missing or
invalid (see `src/config.ts`):

- `VITE_API_BASE`: HTTP base of the server, for example `http://localhost:8080` (the server Quick start port).
- `VITE_WS_BASE`: WebSocket base, for example `ws://localhost:8080`.
- `VITE_SANDBOX`: must be `true`.
- `VITE_PAYMENTS`: `fake` for the in-process fake PayPal, `paypal` for the PayPal sandbox.
- `VITE_PAYPAL_CLIENT_ID`: sandbox client id, needed when `VITE_PAYMENTS` is `paypal`.

`packages/web/.env.example` has working local values (server on `localhost:8080`, `VITE_PAYMENTS=fake`). Vite does not read that file by name, so copy it first:

```
cp packages/web/.env.example packages/web/.env.local
npm run dev -w @gavel/web
```

A production build with `VITE_PAYMENTS=fake` also needs `VITE_ALLOW_FAKE=true`.

Keep `VITE_PAYMENTS` in line with `PAYMENTS` on the server (see `.env.example` at the root).

## Scripted demo (mock server)

`mock/server.ts` is a small Node server that plays back a named scenario from
`src/testing/scenarios` over a WebSocket. It needs no PayPal credentials and no real
auction server.

```
npx vite-node packages/web/mock/server.ts
```

It listens on port 8787 and prints a URL of the form `ws://localhost:8787/?scenario=happy`.
Available scenarios: `happy`, `outbid_race`, `soft_close` and `rejections`. Run the web app
with the variables above pointing at `localhost:8787` (mock server port) and `VITE_PAYMENTS=fake`.

## Live demo

Run the real server from the repository root with `npm start -w @gavel/server`, using
`PAYMENTS=fake` for an offline run or `PAYMENTS=sandbox` with sandbox credentials for PayPal.
Point `VITE_API_BASE` and `VITE_WS_BASE` at it.

## Judge walkthrough

Open the app at the Vite address. Each route is a role in the same auction:

1. `/` is the landing page. It states the promise: a hold is placed, nothing is charged until
   the hammer falls and PayPal confirms the hold.
2. `/demo` is the entry point for choosing a role.
3. `/r/<room>/register` and `/r/<room>/bid` are the bidder flow: register, approve a hold
   as a ceiling, then bid.
4. `/r/<room>/console` is the auctioneer: open, pause, extend, hammer. Hammer needs a held
   confirmation so it cannot fire by accident.
5. `/r/<room>/screen` is the public screen with the current price, the ladder and the
   hammer stamp.
6. `/r/<room>/audit` shows the settlement ladder and event log; `/r/<room>/receipt` shows
   the outcome for a bidder.
7. `/replay/<recording>` plays a recorded auction read-only.

Watch the ladder after the hammer: each lane moves through hold, capture or release, and a
banner appears if a figure does not match the hammer price.

## What is real and what is scripted

Every screen carries a provenance tag (`src/design/Provenance.tsx`) with one of three values:

- Live: events come from a running server in this session.
- Scripted: events come from a scenario file played by the mock server or in-process runner.
- Recorded: events come from a saved recording in replay.

With the mock server, bids, prices and the ladder are scripted and the tag says so. Only a
live run against the server, with `PAYMENTS=sandbox`, talks to PayPal. The fake payments
adapter never contacts PayPal.

## Motion

Hammer and price animations are CSS only (`src/design/motion.css`). Durations are tokens in
`src/design/tokens.css`. With `prefers-reduced-motion: reduce` the hammer is a static stamp
and the price changes without movement.
