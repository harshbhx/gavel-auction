# Traffic simulation

A bounded, manual run that sends simulated bidders through the live judge rooms and reports how
the real site held up. It is the live counterpart of the in-process load scenarios (`load-soak`),
which run against a server booted inside the runner with the fake PayPal.

It uses judge rooms with simulated holds. There is no PayPal login, no PayPal call and no secret.

## What it does

Workflow: `.github/workflows/traffic-sim.yml` (manual dispatch only). Code: `qa/traffic-sim/`.

1. Checks `confirm` is `yes`, validates the settings and wakes the API.
2. Asks `GET /api/judge/capabilities`. If judge rooms or simulated holds are off, or the host is
   not accepting rooms, it reports `not_available` and creates nothing.
3. Runs the rooms in waves of at most 3. Per room it:
   - creates a judge room (`POST /api/judge/rooms`), one create after another;
   - reads the room snapshot for the ceiling presets;
   - joins each simulated bidder (`POST /api/judge/join`), gives it a simulated hold
     (`POST /api/judge/rooms/:id/sim-hold`) and opens a WebSocket on `/ws`;
   - bids over the socket with manual bids at the next valid price, every 3 to 6 seconds per
     bidder, and polls `GET /api/auctions/:id/snapshot` the way the page does;
   - at the end of the wave hammers the lot (`POST /api/auctions/:id/control`, the room's own
     auctioneer token) and polls the snapshot for up to 30 seconds to see whether settlement
     reached `SETTLED`.
4. Writes `report.json` and `summary.md`, shows the summary in the job summary and uploads the
   folder as the `traffic-report` artifact.
5. After a clean run (verdict `completed`), a second job does one real browser walk of the judge
   journey with Playwright (the same walk script as the `judge-smoke` workflow) for
   realism. It makes one more room and is informational. Its artifact is `traffic-walk`.

The load itself is plain HTTP and WebSocket calls with the real request shapes, not browsers, so
it measures the API and not the runner.

## Inputs

| input              | default                              | limit                              |
| ------------------ | ------------------------------------ | ---------------------------------- |
| `target`           | `https://gavel.dualmindlab.tech`     | https origin on the allow list     |
| `api_url`          | `https://api.gavel.dualmindlab.tech` | https origin on the allow list     |
| `rooms`            | 3                                    | 1 to 8                             |
| `bidders_per_room` | 6                                    | 1 to 12                            |
| `duration_minutes` | 5                                    | 1 to 10                            |
| `confirm`          | `no`                                 | must equal `yes`, or the job exits |

The allow list is `*.dualmindlab.tech`, `gavel-web.creharsh.workers.dev` and
`gavel-auction-z2nm.onrender.com`. Any other host is refused before a request is made.

## Guardrails

- Room cap: rooms run in waves of 3 or fewer and never more than 8 in total. The host allows 12
  creates per hour per address and 15 live public rooms by default; the first 429 on room
  creation stops the run and is reported with its code and `retry-after`.
- Join pacing: the API allows 10 join attempts per minute per address. Joins from all rooms share
  one gate at 8 per minute, so a 3 by 6 run spends about 2 minutes joining before the bidding
  time starts to matter. A joined seat that has no hold is given back after 2 minutes, so each
  bidder gets its hold right after it joins.
- Request budget: one budget for HTTP calls and socket frames together
  (`60 + rooms * (6 + bidders * (12 + minutes * 20))`, at most 8000; 2094 for the defaults).
  When it is spent the run stops. The closing hammer and settlement checks are the only calls
  allowed past an abort, so rooms are still ended.
- Error rate: if more than 20 percent of the requests fail over a 30 second window (with at least
  20 requests in the window) the run aborts. A failure is a network error, a timeout, or a status
  outside 200 to 299. A `bid_rejected` frame is an answer, not a failure.
- Paths: only the seven judge-room and auction routes above (plus `/healthz` from curl) can be
  called. Anything containing `webhook` or `admin`, and the judge pause and key routes, is refused
  in code.
- Identity: user agent `gavel-traffic-sim`, bidder names start with `sim`.
- Secrets: none are read or printed. Room tokens live in memory only and never reach a log or the
  report.
- The workflow has a 30 minute timeout, one run at a time, and no schedule.

## How to read the report

The job summary and `summary.md` start with a verdict:

| verdict         | meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `completed`     | every wave ran to the end                                                   |
| `rate_limited`  | the first 429 on room creation stopped the run; read the Rate limit section |
| `aborted`       | the error window or the request budget stopped it; the reason is shown      |
| `not_available` | the host had judge rooms or simulated holds off, or was not accepting rooms |

Then:

- Rooms: created, completed, and the final split. `Settled` rooms reached `SETTLED`; `failed`
  rooms ended in `FAILED_NEEDS_REVIEW`; `not final in time` rooms were still settling after 30
  seconds, which is not a failure by itself.
- Per step table: count, success rate, p50, p95 and max in milliseconds. Steps are
  `capabilities`, `create_room`, `snapshot_setup`, `join`, `sim_hold`, `ws_join` (socket open to
  first state frame), `bid` (bid sent to accepted or rejected frame), `snapshot_poll`, `hammer`
  and `settle_poll`.
- Status codes: HTTP statuses, plus `neterr`, `timeout`, `accepted`, `rejected:<reason>`,
  `ok` (socket joined) and `wserror` or `wsclosed`.
- Percentiles are nearest rank over all samples of the step. They include the runner's network
  distance to the host, so compare runs from the same place.

`report.json` has the same numbers for tooling. Judge rooms expire on their own after 30 minutes,
so a stopped run leaves nothing behind for long.

## Running it

Dispatch from the Actions tab or `gh workflow run traffic-sim.yml -f confirm=yes`. Dispatch works
once the workflow is on the default branch. The API needs a build with open join and simulated
holds (`JUDGE_ROOMS` and `JUDGE_SIM_HOLDS` on); if it is older, the run reports `not_available`.

Run it once, read it, and do not loop it: it spends the host's hourly room allowance.

## Results

One run is recorded: https://github.com/harshbhx/gavel-auction/actions/runs/42582589995 (workflow
`traffic-sim`, 9 Nov 2026, the job concluded success). Its report verdict is **aborted** (request
budget spent), so it is not a completed capacity measurement. Figures are copied from its
`traffic-report` artifact.

- Asked: 3 rooms, 6 bidders per room, 5 minutes, budget 2094 requests; all 2094 were used in 389 s.
- Rooms: 3 created, 0 settled, 3 not final in time. The hammer call answered 409 in all 3 rooms.
- Success over 2130 samples: 99.9 percent. No rate limit was hit (`firstRateLimit` null).
- p95 per step in milliseconds: create_room 118, join 142, sim_hold 115, ws_join 461, bid 107,
  snapshot_poll 106, hammer 105, settle_poll 105.

A run that settles its rooms has not been recorded yet.
