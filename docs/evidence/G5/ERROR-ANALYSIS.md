# G5 error analysis: where the wrong accepts and misses came from

Date: 2026-11-07. Scope: the 24 synthetic clips (eSpeak and a human-like synthetic voice), both
speech-to-text providers. Synthetic, noise-free audio only; this is not a real-room test.

The recorded provider text of the first runs is in the git history of `packages/voice/fixtures/stt-cache`
and `stt-cache-human` (Deepgram nova-2, Groq whisper-large-v3-turbo without a prompt). The scores
below were read from the artifacts of the `voice-eval` cached job.

## Root causes

Eleven wrong accepts were counted on main over the four provider and clip-set runs. Nine of them were
a defect in the evaluation, not in the parser or the providers.

| #   | cause                                                                                                                                                          | example (what was heard)                                                                           | runs affected                                                | outcome on main                                              | fix                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The eval ignored the manifest `expected.paddle` and compared the accepted paddle with an empty bidder, so a correct "paddle 14, 300" counted as a wrong accept | `300 from paddle 14`, `Bidder number nine four hundred`                                            | 9 of the 11 wrong accepts (clips a07, a08, a09, a10)         | counted wrong accept                                         | the eval scores the spoken paddle against `expected.paddle` (measurement fix, no parser change)                                                                                                                                                                      |
| 2   | The provider writes the amount as digits and symbols, and the dollar and cent reading is not the spoken one                                                    | Groq `$2.50?` and `12.50` for "two fifty" and "twelve fifty"; Deepgram with smart_format `$350`    | Groq on a03, a05; Deepgram with smart_format on every number | miss or unrecovered confirm                                  | a colloquial reading is offered next to the dollars-and-cents one (2.50 and 250 dollars, 12.50 and 1,250 dollars); a bare amount with a question mark is asked about instead of dropped; Groq prompt and Deepgram `smart_format=false` make the provider write words |
| 3   | Paddle number and amount written as one digit run                                                                                                              | Groq `Bidder number 9400.` and `Panel 12,350`                                                      | a07, a08 on Groq                                             | missed bid, or a confirm with an amount of 1,235,000 dollars | the run is split into candidates (9 and 400; 12 and 350; 1 and 2,350) and always asked about                                                                                                                                                                         |
| 4   | Homophones of the word "paddle"                                                                                                                                | `panel twelve three fifty`, `pedal seven five hundred dollars`                                     | Deepgram on a07, a10 (both clip sets)                        | confirm with no paddle (unrecovered)                         | `panel`, `pedal`, `peddle` before a number are read as "paddle" and flagged as an ASR repair                                                                                                                                                                         |
| 5   | Teen against tens, written as digits                                                                                                                           | Groq `15.` for "fifteen" at a price of 40 dollars                                                  | Groq human on a18                                            | accepted 15 dollars below the price                          | the existing fifteen/fifty check also covers two-digit numerals, so 15 and 50 are both offered                                                                                                                                                                       |
| 6   | A statement or a question said without a question mark                                                                                                         | Deepgram `it is two fifty` for "is it two fifty"                                                   | Deepgram eSpeak on a21                                       | accepted 250 dollars                                         | "it is", "it's", "that is", "this is" before an amount are asked about, never booked                                                                                                                                                                                 |
| 7   | A number the parser cannot read next to one it can                                                                                                             | Deepgram nova-3 `two fifteen o eight three hundred` for "two fifty no wait three hundred"          | Deepgram nova-3 on a14 (found in the option trials)          | accepted 215 dollars                                         | the readable amount is asked about whenever another number in the text is unreadable                                                                                                                                                                                 |
| 8   | Speech-to-text errors with no usable trace                                                                                                                     | Deepgram nova-2 `ninety seventy five` for "I bid seventy five"; `paddle salmon` for "paddle seven" | Deepgram nova-2, a13 and a10 (eSpeak)                        | confirm without the right candidate                          | not repairable in the parser; nova-3 heard both clips correctly                                                                                                                                                                                                      |

Not a cause on these clips (every such clip passed on main and still passes): number words
("one fifty" against "one hundred fifty", "two fifty five", "a hundred", "and"), dollar words
("dollars", "bucks"), "to" and "for" for two and four, spelled-out teens such as "fifteen", hedges
("maybe"), corrections ("no wait", "no, make it"), "or" between two amounts, filler talk ("I have two
kids"), withdrawals ("I'm out") and a non-dollar currency ("rupees"). The parser unit tests that pin
these grammar cases are in `packages/voice/test/parser/voice-accuracy.test.ts`.

## Per clip

Letters: E exact, R confirm that contains the right pair, W wrong accept, U confirm without the right
pair, M missed bid, F confirm where nothing was expected, `.` correct non-bid. Each cell reads
"main to this change".

| clip | spoken                                      | Deepgram eSpeak | Groq eSpeak | Deepgram human | Groq human |
| ---- | ------------------------------------------- | --------------- | ----------- | -------------- | ---------- |
| a01  | three hundred                               | E to E          | E to E      | E to E         | E to E     |
| a02  | I'll go four hundred and fifty              | E to E          | E to E      | E to E         | E to E     |
| a03  | two fifty                                   | E to E          | E to R      | E to E         | M to R     |
| a04  | three seventy five                          | E to E          | E to E      | E to E         | E to E     |
| a05  | twelve fifty                                | E to E          | U to E      | E to E         | E to E     |
| a06  | fifteen hundred                             | E to E          | E to E      | E to E         | E to E     |
| a07  | paddle twelve three fifty                   | U to E          | U to E      | U to E         | W to E     |
| a08  | bidder number nine four hundred             | W to E          | M to E      | W to E         | M to E     |
| a09  | three hundred from paddle fourteen          | W to E          | W to E      | W to E         | W to E     |
| a10  | paddle seven, five hundred dollars          | R to E          | W to E      | U to E         | W to E     |
| a11  | two thousand five hundred                   | E to E          | E to E      | E to E         | E to E     |
| a12  | one point five k                            | E to E          | E to E      | E to E         | E to E     |
| a13  | I bid seventy five                          | U to E          | E to E      | E to E         | E to E     |
| a14  | two fifty no wait three hundred             | . to .          | . to .      | . to .         | . to .     |
| a15  | maybe two fifty                             | . to .          | . to .      | . to .         | . to .     |
| a16  | two fifty or three hundred                  | . to .          | . to .      | . to .         | . to .     |
| a17  | paddle five two fifty paddle nine two sixty | . to .          | . to .      | . to .         | . to .     |
| a18  | fifteen                                     | . to .          | . to .      | . to .         | W to .     |
| a19  | no, make it four hundred                    | . to .          | . to .      | . to .         | . to .     |
| a20  | the price is now two hundred                | . to .          | . to .      | . to .         | . to .     |
| a21  | is it two fifty                             | W to .          | . to .      | . to .         | . to .     |
| a22  | I have two kids                             | . to .          | . to .      | . to .         | . to .     |
| a23  | I'm out                                     | . to .          | . to .      | . to .         | . to .     |
| a24  | three fifty rupees                          | . to .          | . to .      | . to .         | . to .     |

## Option trials (nothing committed except the two chosen sets)

Run 42364412751 (round 1) and run 42365428369 (round 2), workflow `voice-eval`, input `trials`.
Each variant recorded both clip sets once and was scored by the same parser. Round 1 was scored by the
parser before the unreadable-number rule (cause 7), which is why the nova-3 rows show one wrong accept
on eSpeak (a14); the recordings are unchanged and score 0 wrong accepts with the final parser. The
variants were compared on the aggregate of both sets, not clip by clip.

| variant            | setting                                                                            | eSpeak exact | eSpeak wrong accept | eSpeak exact + recoverable | human exact | human wrong accept | human exact + recoverable |
| ------------------ | ---------------------------------------------------------------------------------- | ------------ | ------------------- | -------------------------- | ----------- | ------------------ | ------------------------- |
| dg-nova2-base      | Deepgram nova-2, no punctuation, no smart_format (what the first recordings used)  | 0.846        | 0.000               | 0.846                      | 1.000       | 0.000              | 1.000                     |
| dg-nova2-keywords  | nova-2 plus keywords boost (paddle, bidder, hundred, thousand, fifty, fifteen)     | 0.769        | 0.042               | 0.769                      | 0.769       | 0.042              | 0.769                     |
| dg-nova3-plain     | nova-3, no punctuation, no smart_format                                            | 1.000        | 0.042               | 1.000                      | 1.000       | 0.000              | 1.000                     |
| dg-nova3-punct     | nova-3, punctuation on, smart_format off (chosen)                                  | 1.000        | 0.042               | 1.000                      | 1.000       | 0.000              | 1.000                     |
| dg-nova3-prod      | nova-3, punctuation and smart_format on (the streaming default before this change) | 0.692        | 0.000               | 0.846                      | 0.769       | 0.000              | 0.846                     |
| dg-nova3-numerals  | nova-3, smart_format and numerals on                                               | 0.615        | 0.000               | 0.769                      | 0.692       | 0.000              | 0.769                     |
| dg-nova3-keyterm   | nova-3 plus keyterm boost (same words, plus seventy five)                          | 1.000        | 0.042               | 1.000                      | 1.000       | 0.000              | 1.000                     |
| gq-turbo-base      | Groq whisper-large-v3-turbo, no prompt (what the first recordings used)            | 0.769        | 0.000               | 1.000                      | 0.846       | 0.000              | 1.000                     |
| gq-turbo-temp0     | turbo, temperature 0                                                               | 0.769        | 0.000               | 1.000                      | 0.846       | 0.000              | 1.000                     |
| gq-large-v3        | whisper-large-v3, no prompt                                                        | 0.846        | 0.000               | 1.000                      | 0.846       | 0.000              | 1.000                     |
| gq-turbo-prompt    | turbo, prompt with example bids and amounts, temperature 0                         | 1.000        | 0.000               | 1.000                      | 0.923       | 0.000              | 1.000                     |
| gq-large-v3-prompt | whisper-large-v3, prompt with example bids and amounts, temperature 0              | 1.000        | 0.000               | 1.000                      | 0.923       | 0.000              | 1.000                     |
| gq-turbo-prompt-b  | turbo, bid-words-only prompt, temperature 0 (chosen)                               | 0.923        | 0.000               | 1.000                      | 0.923       | 0.000              | 1.000                     |
| gq-turbo-prompt-c  | turbo, short prompt "Bid at an auction, spoken as words."                          | 0.769        | 0.000               | 1.000                      | 0.846       | 0.000              | 1.000                     |

What the trials say:

- Parser alone (rows `dg-nova2-base` and `gq-turbo-base`, the providers and options of the first
  recordings, scored by the new parser): exact 0.846 and 1.000 for Deepgram, 0.769 and 0.846 for Groq,
  exact plus recoverable 0.846, 1.000, 1.000, 1.000, and wrong accept 0.000 in all four.
- Deepgram: nova-3 reads these clips better than nova-2. The streaming default so far, `smart_format=true`,
  makes the provider write digits and symbols and scored lowest of the nova-3 variants. Keyterm and
  keywords boosting and `numerals` did not help; they are not enabled.
- Groq: a temperature of 0 and the larger model changed little. A vocabulary prompt helped most. The two
  prompts that carry example amounts scored best, but a prompt with concrete amounts can come back as a
  made-up bid when a chunk is silent or noisy, so the chosen prompt lists bid words only (no numbers,
  checked by a unit test).
- The two chosen settings were picked after seeing results on these 24 clips, so these scores are in
  sample for the option choice as well as for the parser rules.
