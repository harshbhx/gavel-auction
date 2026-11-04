# Noise beds

One wav per noise id used in `../manifest.json` (`cafe`, `crowd`). The id is the file name without
the extension. The beds are not committed; the CI job downloads them into the directory named by
the `FIXTURE_NOISE_DIR` environment variable (default: this directory).

Rules for every bed:

- CC0 or an equivalent public-domain dedication. Anything else is rejected.
- At least 10 seconds long, so a seeded offset still leaves room for the longest utterance.
- One row in `../LICENSES.md` naming the source, the license and the retrieval date before the id
  appears in the manifest. The fixture tool refuses to run when a row is missing.

Mixing is done by `scripts/mix-noise.sh`: the bed is looped, started at an offset derived from the
item seed, scaled to the requested SNR against the speech RMS, and the result is normalized to
16 kHz mono s16le. The same manifest and the same beds give byte-identical output.
