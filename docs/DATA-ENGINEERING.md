# Data engineering of the open datasets

The open datasets are produced by a small, checked pipeline: sources committed in this repository, validators, transforms, datasets with manifests and checksums, and only then (by hand, on request) Hugging Face: the datasets, the static Space `gavel-evidence-explorer` and the collection. Nothing is uploaded automatically. See `docs/HF_COLLECTION.md` for what each dataset contains.

## Pipeline

```text
 sources (committed, or produced in CI)            checks              output
 ------------------------------------------        ------------        --------------------------
 engine ledger events (e2e scenario traces) --+
 payment journals and audit rows (sim suite) -+--> transforms   --> schema validation  --> datasets (jsonl, csv, parquet)
 STT provider outputs (voice fixtures) -------+    scripts/hf        data-quality checks    + dataset card
 sandbox reports (measure-sandbox, nightly) --+    build-         privacy / secret scan  + CHANGELOG.md
 simulated runs (sim-multiday, fake clock) ---+    datasets.mjs                          + MANIFEST.json (sha256, commit, run URL)
 issue counts (GitHub API, aggregates only) --+                                           + verify.py
                                                                                                |
                                                          dry run: artifact `hf-datasets`  <----+
                                                          dry_run=false and HF secrets: Hugging Face (datasets, Space, collection)
```

Honest labels carried through every stage: real sandbox (PayPal sandbox, never production), simulated (fake clock, model of PayPal), synthetic audio (machine-generated speech), fake PayPal (scripted demo auctions).

## One command, reproducible

`scripts/hf/build.sh OUT_DIR [dataset|all]` runs the whole chain: build, parquet, schema validation and quality checks, manifests, hash verification, privacy scan. The workflow `hf-datasets` runs it twice from the same inputs and compares the two `MANIFEST.json` files byte for byte; any difference fails the job. The sources are deterministic: the simulation uses a seed and a fake clock (and its test asserts that two runs are equal), the demo scenarios have fixed seeds and a manual clock, and the build sorts its inputs and writes no wall-clock time except the date on which the issue counts were taken (one value, fetched once per run).

## Schemas

Each dataset has a table schema in `scripts/hf/schemas/<dataset>.json` (Frictionless-style: field types, nullable fields, primary key, minimum and maximum, enums, patterns, expected row counts, and the source files of every table). The validator rejects unexpected or missing fields and wrong types. The data dictionary (`data-dictionary.md`) is generated from the schemas on every build.

## Data-quality checks (run on every build, fail the build)

- Schema: types, nulls in required fields, ranges, enums, patterns, unique primary key, no duplicate rows, expected row counts, every field documented in the dataset card.
- Money: every amount is an integer number of cents and never negative.
- Ledger balance (simulated runs): held = captured + released + open, per lot and per hold; nothing left open after the expiry sweep; a settled lot captured exactly its winning price; holds roll up to their lot.
- Order and time: demo-scenario timestamps and sequence numbers never go backwards; ledger sequence is contiguous; nightly reports finished before they were generated; latency percentiles are ordered (min, p50, p95, p99, max).
- Consistency: every provider output refers to a listed clip and has a wav file; scores recompute from the outputs; every evidence hash equals the one recorded in `docs/GATES.md`; assurance counts add up.
- Privacy and secrets: no email addresses, tokens, key-like strings, IP addresses or payment-object-like ids in any output; demo actors are anonymised. The scan reports file, line and rule only, and a self-test proves that it can fail.

The result is written as `quality-report.md` and `quality-report.json` next to the datasets in the `hf-datasets` artifact and in the job summary of each run. This is the data-quality report.

## Lineage and verification

Each `MANIFEST.json` records the dataset version, the repository commit it was built from, the GitHub Actions run URL, and for every file its size, sha256, row count and source files. `verify.py` (inside every dataset) recomputes the hashes and reports missing, changed or unlisted files. Rows that point to runs (latency, gates) can be checked on GitHub by opening the run.

## Versioning and changelog

Every dataset has a version (in its schema file) and a `CHANGELOG.md` inside the dataset. A new field or a changed meaning raises the minor or major version; a rebuild from newer evidence with the same schema is a patch. Four datasets are at 1.0.0; `gavel-stt-bids` is at 1.1.0 (regenerated from the second-round speech-to-text recordings).

## What this does not claim

The sandbox numbers are small samples. The 30-day run is simulated against a model of PayPal. The audio is synthetic. The pipeline checks that the data is well formed and traceable; it cannot make a simulation into a measurement.
