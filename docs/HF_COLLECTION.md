# Open data: Hugging Face collection

Status: prepared, not yet published. No dataset below is live. Links are placeholders until publish: replace `<namespace>` with the Hugging Face account that publishes them.

The datasets are built from evidence committed in this repository by `scripts/hf/build-datasets.mjs`, run by the workflow `hf-datasets` (manual, dry run by default). Every dataset carries a `MANIFEST.json` (sha256 of every file, the repository commit, the build run URL, row counts) and a `verify.py` that recomputes the hashes. The privacy and secret scan runs on every output and fails the build on a hit. How the pipeline is built and checked: `docs/DATA-ENGINEERING.md`.

Only data that is not already browsable in the repository is published. Documents, issues, pull requests and CI history stay on GitHub.

## Collection

Title: GAVEL: evidence data for a voice-and-hold auction

Description (paste into the collection):

> Data behind GAVEL, an auction where bidders hold funds with PayPal authorizations and the winner is captured at the hammer. Five small datasets, each labelled for what it is: real sandbox measurements, a simulated 30-day settlement run on a fake clock, synthetic speech with recorded speech-to-text outputs, and scripted demo audit trails. Every file has a checksum and a manifest so the numbers can be verified. Nothing is production data and no real person or real money is involved.

## Order and descriptions

| #   | Dataset                        | Label                         | Rows                                                                                | License   |
| --- | ------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------- | --------- |
| 1   | `<namespace>/gavel-gates`      | real sandbox, synthetic audio | 6 gates, evidence file hashes, nightly results, adversarial-review and audit counts | CC-BY-4.0 |
| 2   | `<namespace>/gavel-latency`    | real sandbox                  | summary statistics                                                                  | CC-BY-4.0 |
| 3   | `<namespace>/gavel-sim-30d`    | simulated                     | per lot and per hold                                                                | CC-BY-4.0 |
| 4   | `<namespace>/gavel-stt-bids`   | synthetic audio               | 24 clips, 96 provider outputs                                                       | CC-BY-4.0 |
| 5   | `<namespace>/gavel-audit-demo` | synthetic, simulated          | scripted scenario traces                                                            | CC-BY-4.0 |

Exact row counts are in each dataset's `MANIFEST.json` and in the summary of the `hf-datasets` run.

### 1. gavel-gates

Short description: Index of the six go/no-go experiments (G0 to G5): status, date, method, workflow run links, and a sha256 and link for every evidence file, plus aggregate counts of adversarial-review and audit findings (found, closed, open, by label, severity and area; no issue text).

Tags: evidence, sandbox, payments, verification, checksums.

Why this data matters: judges can see in one small table which claims rest on real PayPal sandbox runs, which on simulation, and what is still open (the multi-day authorization probe, G3, is in progress). Each row can be checked against a file hash or a workflow run, so the project does not ask to be trusted.

### 2. gavel-latency

Short description: Latency of the PayPal sandbox calls an auction settlement makes: hammer to capture, hammer to fully settled, and per-call order, authorize, capture and void.

Tags: sandbox, latency, payments, benchmark, small-n.

Why this data matters: the time between hammer and charge decides whether an auction feels live. These are real sandbox numbers with the sample sizes stated (3 and 20 settlements, 10 call cycles), including the places where the target was not met, so they can be used to size timeouts instead of guessing.

### 3. gavel-sim-30d

Short description: A simulated 30-day settlement of 40 auction lots with 100 fake bidders, crashes and injected payment faults, with every cent of every hold accounted for.

Tags: simulated, payments, settlement, authorization-hold, fake-clock.

Why this data matters: real authorization holds expire and reauthorize over days, which a demo cannot wait for. The simulation shows the settlement code keeping the books balanced to the cent under crashes, outages and rate limits, and lists why each lot that went to review did so. It is labelled simulated because the payment provider is a model.

### 4. gavel-stt-bids

Short description: 24 synthetic bid utterances (audio, intended text, expected parse), what two speech-to-text services returned, and per-clip scores, with a text-only second voice.

Tags: synthetic, speech-to-text, bid-parsing, espeak-ng.

Why this data matters: spoken numbers ("two fifty no wait three hundred") are hard for transcription services, and the project failed its own accuracy gate on them, which is why spoken bids always go through a confirm step. The data lets anyone replay that result offline and compare services. It is synthetic and noise-free, so it says nothing about a real room.

### 5. gavel-audit-demo

Short description: Event, ledger and outcome records of scripted demo auctions (bids, rejections, holds, captures, voids) with anonymised bidders and a fake clock.

Tags: synthetic, simulated, audit-log, ledger, anonymised.

Why this data matters: it shows what the audit trail of a hold-then-capture auction looks like, including crashes, duplicate webhooks, voided holds and late bids, and that the ledger invariants held in each case. The payment provider is fake and no real person appears.

## Publishing

1. Add the repository secret `HF_TOKEN` (a write token) and the repository variable `HF_NAMESPACE`.
2. Run the workflow `hf-datasets` once with the default dry run and download the artifact `hf-datasets`.
3. Run it again with `dry_run` unticked. Each dataset is created as a public dataset repository and uploaded.
4. Create the collection on Hugging Face with the title, description and order above, then replace the placeholders in this file, in `docsite` (page Open data) and, if wanted, add an Open data section to the README.
