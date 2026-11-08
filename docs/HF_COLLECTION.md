# Open data: Hugging Face collection

Status: published. The five datasets, the Space and the collection are live under the Hugging Face account `harshbhx`: [collection](https://huggingface.co/collections/harshbhx/gavel-evidence-auction-holds-hammer-and-receipts-6af0afebebb37eb4c9184504), Space [gavel-evidence-explorer](https://huggingface.co/spaces/harshbhx/gavel-evidence-explorer), datasets [gavel-gates](https://huggingface.co/datasets/harshbhx/gavel-gates), [gavel-latency](https://huggingface.co/datasets/harshbhx/gavel-latency), [gavel-sim-30d](https://huggingface.co/datasets/harshbhx/gavel-sim-30d), [gavel-stt-bids](https://huggingface.co/datasets/harshbhx/gavel-stt-bids) and [gavel-audit-demo](https://huggingface.co/datasets/harshbhx/gavel-audit-demo).

The datasets are built from evidence committed in this repository by `scripts/hf/build-datasets.mjs`, run by the workflow `hf-datasets` (manual, dry run by default). Every dataset carries a `MANIFEST.json` (sha256 of every file, the repository commit, the build run URL, row counts) and a `verify.py` that recomputes the hashes. The privacy and secret scan runs on every output and fails the build on a hit. How the pipeline is built and checked: `docs/DATA-ENGINEERING.md`.

Only data that is not already browsable in the repository is published. Documents, issues, pull requests and CI history stay on GitHub.

## Collection

Title: GAVEL Evidence: auction holds, hammer and receipts

Description (the Hub allows 150 characters; this is what `scripts/hf/push.py` sets):

> Open data behind GAVEL, a hold-then-capture auction: sandbox latency, gates, a simulated 30-day run, synthetic speech and scripted audit trails.

Longer text for the datasets' own pages: data behind GAVEL, an auction where bidders hold funds with PayPal authorizations and the winner is captured at the hammer. Five small datasets, each labelled for what it is: real sandbox measurements, a simulated 30-day settlement run on a fake clock, synthetic speech with recorded speech-to-text outputs, and scripted demo audit trails. Every file has a checksum and a manifest so the numbers can be verified. Nothing is production data and no real person or real money is involved.

Items, in this order: the five datasets below, then the Space `harshbhx/gavel-evidence-explorer`.

## Order and descriptions

| #   | Dataset                     | Label                         | Rows                                                                                | License   |
| --- | --------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- | --------- |
| 1   | `harshbhx/gavel-gates`      | real sandbox, synthetic audio | 6 gates, evidence file hashes, nightly results, adversarial-review and audit counts | CC-BY-4.0 |
| 2   | `harshbhx/gavel-latency`    | real sandbox                  | summary statistics                                                                  | CC-BY-4.0 |
| 3   | `harshbhx/gavel-sim-30d`    | simulated                     | per lot and per hold                                                                | CC-BY-4.0 |
| 4   | `harshbhx/gavel-stt-bids`   | synthetic audio               | 24 clips, 96 provider outputs                                                       | CC-BY-4.0 |
| 5   | `harshbhx/gavel-audit-demo` | synthetic, simulated          | scripted scenario traces                                                            | CC-BY-4.0 |

The Space `harshbhx/gavel-evidence-explorer` is item 6 (see below). Exact row counts are in each dataset's `MANIFEST.json` and in the summary of the `hf-datasets` run.

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

Why this data matters: spoken numbers ("two fifty no wait three hundred") are hard for transcription services, and the project's accuracy gate on them (G5) is PARTIAL, not passed: the numbers are measured in sample on 24 noise-free synthetic clips, so spoken bids always go through a confirm step. The data lets anyone replay that result offline and compare services. It is synthetic and noise-free, so it says nothing about a real room.

### 5. gavel-audit-demo

Short description: Event, ledger and outcome records of scripted demo auctions (bids, rejections, holds, captures, voids) with anonymised bidders and a fake clock.

Tags: synthetic, simulated, audit-log, ledger, anonymised.

Why this data matters: it shows what the audit trail of a hold-then-capture auction looks like, including crashes, duplicate webhooks, voided holds and late bids, and that the core ledger invariants held in each case. The payment provider is fake and no real person appears.

## Space: gavel-evidence-explorer

A static, read-only Hugging Face Space (no server, no tracking). Source in `hf/space/` (`README.md` with the Space header, `index.html`); the data file `data/explorer.json` is generated by `scripts/hf/build-space.mjs` from the built datasets and from the G5 and latency-target tables of `docs/GATES.md`, so it cannot drift from them. The workflow builds it on every run (artifact `hf-space`) and fails if an input is missing.

What it shows, each section carrying its label:

- Gates G0 to G5 with status exactly as `docs/GATES.md` says (PASS, PARTIAL, IN PROGRESS for G3).
- Latency, real sandbox: hammer to captured and to settled p95 against the targets (the capture target is missed), and per-call p50 and p95, with n stated.
- The 30-day run, labelled SIMULATED: lots, holds, outcomes, review causes, money held, captured, released and open, and the scenario checks.
- Speech-to-text, labelled SYNTHETIC: exact-match rates per provider and clip set, and the parse-level G5 table.
- A link to the live demo, https://gavel-web.creharsh.workers.dev/demo.

## Publishing

They were published with these steps, and the same steps update them:

1. Add the repository secret `HF_TOKEN` (a Hugging Face write token). Never paste it in chat or in a file.
2. Add the repository variable `HF_NAMESPACE` (the Hugging Face user or organisation that will own the datasets, the Space and the collection).
3. Run the workflow `hf-datasets` once with the default `dry_run` ticked. It builds and checks everything, prints the publish plan in the job summary and keeps the artifacts `hf-datasets` and `hf-space`.
4. Run it again with `dry_run` unticked. It uploads the five datasets and the Space (all public), creates the collection (or reuses one with the same title) and adds the datasets and then the Space to it, in the order above. If the secret or the variable is missing the run fails with a message that says which one; nothing is uploaded.
5. Re-running step 4 later updates the files and keeps the collection.
