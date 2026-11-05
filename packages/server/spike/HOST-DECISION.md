# Room host decision: Durable Object versus Node (RT-86)

Requirements: R-RT-141, R-RT-142, R-RT-143. Criteria: SPEC-realtime section 5.6. Recorded as D-0028 in docs/DECISIONS.md.

Result: Node host with the existing store adapters. A Durable Object host is not built.

## How to read this document

R-RT-142 makes Node the default and lets a Durable Object win only if it passes every row of the decision table, and says any miss means Node. A Durable Object therefore needs positive evidence on all six rows. This spike did not run throwaway rooms on a Durable Object host: no Cloudflare account, wrangler login or miniflare setup was used, so no Durable Object number exists. Every Durable Object row below is unmeasured. Under the rule, an unmeasured row is not a pass.

No benchmark number is quoted in this document. Rows marked "measured" mean a harness exists in the repository and CI runs it; the figures live in the CI logs, not here.

## Decision table

| Criterion                           | Node host (state on main)                                                                                                                         | Durable Object host                                                   | Passes for DO? |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------- |
| p95 accept-to-broadcast, 20 clients | Load harness exists: packages/server/bench/load.ts, run by test/bench-load.test.ts. Figures are in CI, not copied here.                           | Unmeasured. No throwaway DO room was built.                           | No evidence    |
| Restart recovery, 1000 events       | Recovery harness exists: packages/server/bench/recover.ts, run by test/bench-recover.test.ts. Figures are in CI.                                  | Unmeasured.                                                           | No evidence    |
| Payments saga and secrets           | The saga runs in the same process as the room host (packages/server/src/runtime). Secrets stay in one process.                                    | Not designed. Would need the saga in the DO or an authenticated call. | No evidence    |
| Persistence for ledger              | Memory and file stores pass the store contract (test/store-contract.ts). Postgres adapter was added with the scenario runner work (DH-02, #1460). | D1 or SQLite-backed store does not exist in the repository.           | No evidence    |
| Deploy effort under 3 h             | Render blueprint with a persistent disk and one instance is committed (D-0018, test/render-blueprint.test.ts).                                    | Unmeasured. Needs a wrangler login and a worker entry point.          | No evidence    |
| Free-plan limits                    | Not applicable to a Render instance; the demo uses the host chosen in D-0006 and D-0018.                                                          | Unverified. The spec itself marks this UNVERIFIED.                    | No evidence    |

## What the repository shows

- The room code under packages/server/src/room has no `node:` imports (checked with a search of the directory). This is consistent with R-RT-140 and means a Durable Object host stays possible later without a rewrite of the room core. It does not show the room core runs in a Durable Object; that was not tried.
- The HTTP host, the file stores and the ops routes use `node:http`, `node:crypto` and the file system, so the full server is a Node program today.
- D-0018 already commits the hosted demo to one instance with a persistent disk. The room log, ledger, journals and holds are files owned by one process.
- A Durable Object gives one single-threaded writer per room by design, which matches the single-writer room. That is a public property of the platform and it is a reason to revisit the choice, not a measured result.

## Complexity and cost, qualitatively

- Node: already built, one deploy target, state in files or Postgres, one process holds PayPal secrets and the saga. Cost is one always-on instance during the judging window (D-0008).
- Durable Object: needs a worker entry point, a storage adapter for the ledger (D1 or SQLite-backed), a second deployment pipeline, a miniflare test path (T-RT-099) and a design for the payments saga. Plan pricing and limits are not quoted here because they were not verified in this spike.

## Decision

Keep the Node host (D-0006 stands). Reasons, all from the table above: Node is the default under R-RT-142, the Node harnesses exist and run in CI, and the Durable Object path has no evidence on any criterion. The spike did not find that a Durable Object is worse; it found that nothing here shows it is good enough to meet the threshold, and the deadline favours the host that is already built.

## Revisit conditions

Reopen with a new decision ID if all of these are met: a throwaway Durable Object room is run under the same load harness with 20 clients in one region; recovery from a 1000-event log is timed; a D1 or SQLite-backed store passes the store contract; the free-plan limits are checked against current Cloudflare documentation; a clean deploy is timed.

## Not done

- No Durable Object room, no miniflare run and no wrangler deploy.
- T-RT-098 as written (results table on both hosts) is not satisfied; this document records the Node-only evidence and the missing half.
- No latency or recovery figures are reproduced here.
