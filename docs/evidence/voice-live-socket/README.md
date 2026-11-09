# Live /audio socket run, run 42575018866

Artifacts `voice-live-socket-groq` and `voice-live-socket-deepgram` of workflow `evidence-voice-live-socket` on `main`, run https://github.com/harshbhx/gavel-auction/actions/runs/42575018866 (9 Nov 2026). The 24 committed synthetic clips (eSpeak, 16 kHz mono) were streamed in real time over the `/audio` socket of the real server process (fake PayPal, an auctioneer token, an empty cached recording so a transcript can only come from the live provider), once per provider. The server log of each run was then scanned with a canary for the provider key.

The `.json` and `.md` files were re-laid out by prettier; the numbers are those of the artifacts.

| File                        | sha256                                                           |
| --------------------------- | ---------------------------------------------------------------- |
| `LIVE-SOCKET-groq.json`     | e3c81ed9a261318eed5f8f0c70122edb00e403c667efacbaa8b49f2f402744c6 |
| `LIVE-SOCKET-groq.md`       | e5eb3ada95bda25f4ce32cc42ad612afd1eb97365106b19343f1ba1b239c8152 |
| `log-scan-groq.json`        | 46b62a0da3324927195f1237dd3ad6449715d2fd36d67b36f3f94ed4f8a34014 |
| `run-groq.txt`              | 31025b9abad8502595cd6bfad1e7f85ea81e10d580d181d7027ab3758950acfa |
| `server-groq.log`           | 490c851fc98565640be725563fc72056524827bab9854bdaa7786ef68ab51fe3 |
| `LIVE-SOCKET-deepgram.json` | 85905621e5743260b7a61ca7d82e91c5b22a21f259b66b7bb6e9ecb2ef4031cf |
| `LIVE-SOCKET-deepgram.md`   | 6cd60063ed3d58db794a527aa5ff3814a396586470c23cfcc535b04f938b1321 |
| `log-scan-deepgram.json`    | 1938273f1b8229e00f6c8fbbb0efb863e7b9fc9c57a73dd408810faadebfe046 |
| `run-deepgram.txt`          | db065ff61074de32b35c25e42897154a3551de6f577e2c898c52a1e047c14cd5 |
| `server-deepgram.log`       | 2c01d700471b29050bec7cd845a18ae870e1c247812389b81bfa88d9a84b0def |

The server logs were checked before committing: the only lines that mention a token or key are the redacted configuration line and the payments client lines; no email address, bearer value or provider key appears.

Limits: synthetic clips, fake PayPal in the server, no human voice and no real room, and the web console has an auctioneer microphone (FEAT-62) that was added after this run and has not been part of it; it works only when the server reports a live speech provider, and a bidder phone has no microphone. For Deepgram the caption latency is 0 ms for every clip; that is not a meaningful latency figure (final transcripts arrive before the speech ends in the streaming path), so no Deepgram latency is claimed.
