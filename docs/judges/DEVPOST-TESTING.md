# Devpost testing instructions (draft)

Draft for the Devpost "testing instructions" field. The owner pastes this in and fills the lines marked OWNER. Do not commit real credentials back into this file.

---

For judges: start at https://gavel.dualmindlab.tech/try (judge panel). No login: https://gavel.dualmindlab.tech/demo/scripted. Demo room: https://gavel.dualmindlab.tech/demo. Trust and FAQ: https://docs.gavel.dualmindlab.tech/docs/judges/trust-and-faq. Sandbox buyer logins are placeholders below (OWNER fills in).

GAVEL is a live auction where every bid is a PayPal authorization hold. At the hammer only the winning price is captured and every other hold is voided. Everything runs in the PayPal sandbox: no real money moves, and you should never use your own PayPal account.

No login path (about 1 minute)

1. Open https://gavel.dualmindlab.tech/demo/scripted
2. It plays a recorded room in your browser with no server and no PayPal calls. It is labelled "Scripted demo: recorded events, no PayPal calls".

Judge key (optional, for HTTP)

You do not need a key for any path above or below: a keyless judge room on /try works without one. To drive a room over HTTP instead, use the shared judging key and follow https://docs.gavel.dualmindlab.tech/docs/judges/call-the-api

- Shared judge key: OWNER fills in on Devpost only (it does not expire, sandbox rooms only, never commit it)

Live sandbox room (about 3 minutes)

1. Open https://gavel.dualmindlab.tech and press "Start a demo auction". The page /try lists the same steps.
2. The room opens on the room hub, which shows a room code, a QR code and buttons for the big screen, the console and the bidder view. Join as a bidder from the hub (button, room code, or scan the QR code on a phone) with any name and a ceiling, and keep the big screen open in a second window.
3. Press and hold the approve button for 3 seconds. In the PayPal sandbox window log in with this sandbox buyer:
   - Email: OWNER fills in from the sandbox dashboard
   - Password: OWNER fills in
     (Sandbox test account only. If a login is refused, try the second buyer below.)
   - Second buyer: OWNER fills in email and password
4. Place a bid, then open the console from the hub and press and hold hammer.
5. You should see: the hold shown as held while bidding, then after the hammer the winner captured for the winning price only and the other holds released. The receipt and the audit trail (a ledger chained by hash) open from the room.

Notes for testers

- A room lasts about thirty minutes. Do the whole run in one sitting.
- The hosted API keeps its data on a 1 GB persistent disk, so a room normally survives a host restart until it expires. If a room is gone anyway, start a new demo auction.
- If the host is busy or judge rooms are off, the page says so and offers the scripted demo.
- Voice bidding was tested with synthetic, noise-free clips, so a spoken bid always asks for confirmation on the bidder's screen. The auctioneer console microphone works only when the server has a speech provider (the console says when it is off), and bidder phones have no microphone. Typed and QR bids work without it.
- Sandbox buyers are US accounts and the auction is in USD.

More: judge walkthrough https://github.com/harshbhx/gavel-auction/blob/main/docs/JUDGES.md and the docs site https://docs.gavel.dualmindlab.tech/docs/judges
