# Privacy notice

GAVEL is a sandbox demo built for a hackathon. It moves no real money and is not meant for personal
data. Please do not speak or type anything you would not want kept.

## What is collected

- **Display name.** The name a bidder types when joining (up to 64 characters). It is shown to the
  room and kept with the auction record (bids, audit trail, exports).
- **Bids and holds.** Amounts in cents, timestamps and the sandbox PayPal order identifiers for the
  hold. Card and PayPal login details are entered on PayPal's own pages and never reach GAVEL.
- **Voice.** When voice bidding is on, microphone audio is streamed from the browser to the server
  and on to the speech-to-text vendor (Groq or Deepgram, whichever is configured) for live
  transcription. Audio is not written to disk or kept by GAVEL. The text of an accepted voice bid
  is kept in the audit trail; text from chatter that is not a bid is redacted before it is stored.
- **Operational logs.** Request method, path, status and a request id. Tokens, keys, signatures and
  secret-shaped values are redacted before a line is written. No request bodies are logged.

## What is not collected

No analytics, advertising identifiers or third-party tracking scripts. The web app sets no cookies;
a session token is held in memory for the length of the auction.

## Vendors

The speech vendor receives the audio while a stream is open. Its own retention terms apply and have
not been verified by this project (gate G5 in `docs/GATES.md`), which is why this is a sandbox notice.
PayPal receives the sandbox order data under its sandbox terms.

## Retention and deletion

Auction records live on the demo host's disk for the judging period and are removed when the demo
is shut down. To ask for earlier removal of a name or an auction, open an issue on the repository or
contact the owner listed in `README.md`.
