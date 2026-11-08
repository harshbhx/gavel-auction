---
title: GAVEL Evidence Explorer
emoji: "\U0001F528"
colorFrom: gray
colorTo: blue
sdk: static
pinned: false
license: cc-by-4.0
short_description: Charts of GAVEL sandbox, simulated and synthetic evidence
tags:
  - evidence
  - payments
  - simulation
  - speech-to-text
---

# GAVEL Evidence Explorer

A read-only, static page that charts the five open datasets of the GAVEL project:
latency of real PayPal sandbox calls, the status of the six go/no-go gates (G0 to G5),
a **simulated** 30-day settlement run, and speech-to-text results on **synthetic** audio.

Every number comes from a dataset file built from evidence committed in
https://github.com/harshbhx/gavel-auction (the build is `scripts/hf/build-space.mjs`), or from the results table
of `docs/GATES.md`. Nothing is typed in by hand. No server, no tracking, no cookies.

- Live demo (sandbox payments): https://gavel-web.creharsh.workers.dev/demo
- Documentation: https://gavel-docs.creharsh.workers.dev/docs/judges/open-data
- Source of this Space: `hf/space/` in the repository above

Labels: real sandbox (PayPal sandbox, never production), simulated (fake clock, model of PayPal),
synthetic (machine-generated speech). Nothing here is production data, and no real person or real
money is involved.
