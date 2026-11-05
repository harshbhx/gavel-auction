# GAVEL: 3-minute video script and shot list

Refs #319 and #97. Target runtime 2:50 (limit 3:00). Voiceover text below needs no music. If a track is added later it must be royalty free; the cut works with none. Every shot carries a source label that is shown on screen. Never say or show a live charge: all PayPal calls are sandbox, and money is only taken at capture.

Source legend: UI = needs the web app (to be filled by the UI owner); TERM = terminal on the repo; EVID = evidence files under `docs/evidence`; FAKE = fake PayPal replay or tests against the fake; REC = recorded replay.

## Shot list

| #   | Time      | Shot                                                                                            | Source            | On-screen label                                         | Voiceover                                                                                                                |
| --- | --------- | ----------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | 0:00-0:15 | Paper bid sheet, then a note "winner never paid" (title card, no UI)                            | TERM (title card) | Problem                                                 | "At a live auction, bidders hold back when a card is charged first. And when bids are unsecured, winners can walk away." |
| 2   | 0:15-0:30 | One line promise on a title card                                                                | TERM (title card) | GAVEL: sandbox only                                     | "GAVEL makes every bid a PayPal authorization hold. The hammer is the payment."                                          |
| 3   | 0:30-0:50 | Register two bidders and pick ceilings; holds shown as HELD                                     | UI                | UI owner fills; label Live sandbox or Recorded          | "A bidder approves a ceiling. It is held, not charged."                                                                  |
| 4   | 0:50-1:10 | Typed and QR bids on the console and bid screen                                                 | UI                | UI owner fills                                          | "Bids above a ceiling are refused. Typed, QR and voice all feed the same rules."                                         |
| 5   | 1:10-1:30 | Spoken bid and the confirm prompt in the replay                                                 | REC               | Recorded: this is a replay                              | "A spoken bid becomes a structured bid. When it is ambiguous, GAVEL asks first."                                         |
| 6   | 1:30-1:55 | Hammer: winner captured at the winning price, others voided; ladder HELD to CAPTURED and VOIDED | UI or FAKE        | UI owner fills; label Fake PayPal if the replay is used | "At the hammer only the winning price is captured. The other holds are voided."                                          |
| 7   | 1:55-2:15 | Terminal: the G1 and G4 evidence lines and the GATES status table                               | EVID, TERM        | Real sandbox evidence                                   | "These are real sandbox runs: capture 350 of a 500 hold released the remainder, and six real webhooks verified."         |
| 8   | 2:15-2:30 | Crash mid-settlement then resume, still one capture                                             | FAKE              | Fake PayPal, test run                                   | "Stop the server mid-settlement and resume: still exactly one capture. This is shown against our fake PayPal."           |
| 9   | 2:30-2:42 | Ledger verify output and the audit screen                                                       | TERM or UI        | UI owner fills for the screen                           | "Every accepted bid sits in a hash-chained ledger anyone can re-verify."                                                 |
| 10  | 2:42-2:50 | Closing card with repo URL and the honest status line                                           | TERM (title card) | Gates G3 and G5 not yet run                             | "GAVEL: PayPal sandbox, open source, MIT. Two gates are still open, and we say so."                                      |

Timings sum to 2:50 (170 s).

## Real versus recorded label sheet

| Claim shown                           | Label on screen             | Truth                                          |
| ------------------------------------- | --------------------------- | ---------------------------------------------- |
| Hold, capture 350, remainder released | Real sandbox, evidence file | G1 PASS, wallet and card                       |
| Card and guest authorize              | Real sandbox                | G2 PASS                                        |
| Webhook verification                  | Real sandbox, 6 events      | G4 PASS; tampered-event rejection is fake only |
| Full multi-bidder settlement          | Fake PayPal                 | Not run end to end on the sandbox              |
| Crash and resume                      | Fake PayPal, test hook      | In-process hook; no trigger on a hosted server |
| Voice bid                             | Recorded replay             | Speech accuracy not measured (G5 not run)      |
| Honor period and reauthorize          | Not shown as a result       | G3 not recorded yet                            |
| Any money                             | Never a live charge         | Sandbox only                                   |

## Open items for the UI owner

Shots 3, 4, 6 and 9 need the real screens against a seeded room. Until then, shots 6 and 8 can use the fake replay, and 7 and 9 can use the terminal. Cut order if over time: shot 9, then 4, then 5.
