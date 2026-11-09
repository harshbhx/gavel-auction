# Trust and FAQ for judges

Plain answers to the questions a judge is likely to ask before putting a sandbox login into a payment page. Where this page and `docs/GATES.md` disagree, the gate record wins.

## Is any real money involved?

No. Every PayPal call goes to the PayPal sandbox. The hosted server refuses to start judge rooms unless it is on the sandbox, and it refuses fake payments in production mode. A sandbox buyer is a test account with pretend funds. Never sign in with your own PayPal account: use a sandbox buyer only.

## What happens to my "bid"?

A bid is a hold, which PayPal calls an authorization. The money is held, not charged. Nothing is charged until the auctioneer presses hammer. At the hammer only the winning price is captured, and every other hold is voided. The bidder screen and the receipt show the state of each hold: hatched means held, solid means charged, hollow means released.

## Do I have to give GAVEL a card or a PayPal password?

No. The PayPal login happens on PayPal's own sandbox pages. GAVEL never sees the login details. See `docs/PRIVACY.md`.

## What does GAVEL keep about me?

The display name you type, your bids and holds (amounts in cents, times and the sandbox order ids), and the audit trail of the room. There are no analytics, no ad identifiers and no cookies; the session token lives in memory for the length of the auction. Voice is off unless the host turns it on; when it is on, audio is streamed to the speech vendor and not written to disk by GAVEL. Records are removed when the demo is shut down.

## Can I check that the auction was not rigged?

Yes. Every event goes into a ledger chained by hash. The audit trail link in a room shows it, and the export can be verified with `verifyPublicExport` (see the replay bundle section of `docs/JUDGES.md`). Any edited entry breaks the chain at that entry. The engine that decides outcomes is deterministic: the same events give the same result.

## What if the server restarts mid-room?

The hosted API keeps its data on a 1 GB persistent disk, and rooms are read back from it on start, so a room normally survives a restart until it expires. If a room is gone anyway, start a new demo auction. The settlement saga is designed to resume after a crash without a second capture; that is tested against the fake PayPal and on a small set of real sandbox runs (see `docs/GATES.md`), not on a whole auction driven through the hosted server.

## What is real, simulated and recorded?

- Real on the PayPal sandbox: gates G0, G1, G2 and G4, and the nightly specs R7, R8 and R10 (see `docs/GATES.md`).
- In progress: gate G3 (how long a hold stays capturable) is a real probe that started 7 Nov 2026 03:06 UTC; no result yet.
- Partial: gate G5 (speech accuracy) is PARTIAL on synthetic, noise-free clips, so a spoken bid always goes through a confirm prompt.
- Simulated: the 30-day run on a fake clock.
- Recorded: the scripted demo and the replay. They make no PayPal calls and are labelled as such on screen.

## What is not proven?

Whole-auction settlement through the hosted server, a real process kill on the sandbox, guest-card capture, release of the remainder as seen on a buyer balance (inferred from PayPal's answers, not read), real-room voice accuracy, and the PayPal hold window beyond the G3 readings so far. `docs/JUDGES.md` has the full status list.

## Time limits that affect you

A judge room lasts about thirty minutes. Register, bid and hammer in one sitting: PayPal's honor period for a hold is unproven (G3), and a hold older than two hours at settlement is flagged stale in the audit trail.

## Something is not working. What next?

1. Reload and try the room code again.
2. If the room is gone or the host is busy, start a new demo auction.
3. If judge rooms are off or the host is down, open `/demo/scripted`: it plays the recorded room in the tab with no server and no PayPal login.
4. If the sandbox login rejects the buyer, see `docs/judges/SANDBOX-BUYERS.md`.
5. Open an issue on https://github.com/harshbhx/gavel-auction/issues.
