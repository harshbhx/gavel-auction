# Decisions (append only; newest last)

## D-0001: Monorepo with npm workspaces

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Six packages and an end-to-end package are built in parallel by separate owners and share types.
Decision: One repository with npm workspaces over the packages directory and a single lockfile.
Alternatives:

- pnpm or yarn workspaces: rejected, extra tooling for no gain at this size.
- One repository per package: rejected, cross-package changes would need coordinated releases.

Consequences:

- npm ci is the only install command in CI.
- Dependency direction is enforced by lint and dependency rules (QA-03).

Evidence: SPEC-quality R-QA-001, R-QA-018.

## D-0002: Review and merge rules

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Several owners edit the repository at once and main must stay releasable.
Decision: Pull request required, squash merge only, CODEOWNER review, with self-merge after green CI allowed for docs-only changes.
Alternatives:

- Direct pushes to main: rejected, no review trail.
- Merge commits: rejected, history is not linear.

Consequences:

- Branch protection lists the ci / required check.
- Cross-area changes need the cross-area label.

Evidence: SPEC-quality R-QA-008, R-QA-009, R-QA-013.

## D-0003: Integer cents and ULIDs

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Money must never be subject to floating point error and identifiers must sort by creation time.
Decision: All amounts are integer cents and all identifiers are ULIDs.
Alternatives:

- Decimal strings: rejected, easy to mix with numbers.
- UUIDv4: rejected, not sortable.

Consequences:

- A lint rule and property tests cover money arithmetic.

Evidence: SPEC-quality R-QA-023.

## D-0004: Fake-first interfaces

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Consumers must build against payments and voice before the real integrations are verified.
Decision: Each module publishes types, a fake and fixtures before any consumer depends on the real implementation.
Alternatives:

- Build against the live sandbox from day one: rejected, blocks parallel work on credentials and network.

Consequences:

- Contract tests keep the fake and recorded real responses in agreement.

Evidence: SPEC-quality R-QA-014, R-QA-028.

## D-0005: Sandbox-only guard

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The product handles payment holds and must never reach the live payment host.
Decision: The payment client refuses any base URL except the sandbox host and the fake server host, and CI fails on the live host string.
Alternatives:

- Rely on environment variables alone: rejected, a wrong value would go unnoticed.

Consequences:

- The server refuses to boot when PAYPAL_ENV is not sandbox.

Evidence: SPEC-quality R-QA-038, R-QA-043.

## D-0006: Realtime host

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The room host choice depends on the realtime spike result, which is not available yet.
Decision: Default to a single Node server on Render until the realtime spike reports otherwise.
Alternatives:

- Durable Objects: deferred, only adopted if the spike chooses them.

Consequences:

- Superseded by a new entry if the spike chooses another host.

Evidence: SPEC-quality R-QA-042.

## D-0007: Web hosting

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The web package builds to static files.
Decision: Host the static web build on Cloudflare Pages.
Alternatives:

- Render static site: kept as the fallback if Pages setup blocks the deploy workflow.

Consequences:

- Deploys run from workflows, not dashboard clicks.

Evidence: SPEC-quality R-QA-042.

## D-0008: Keep-alive strategy

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Free instances sleep and a cold start during judging would hurt the demo.
Decision: Use a keep-alive ping every 4 minutes and a warmup route, moving to an always-on instance for the final window if needed.
Alternatives:

- Always-on instance from the start: rejected, avoidable cost.

Consequences:

- An uptime workflow probes the health routes.

Evidence: SPEC-quality R-QA-045.

## D-0009: Coverage gates

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Money-handling code needs stricter coverage than presentation code.
Decision: Enforce per-package line and branch coverage gates and never lower them without a new entry here.
Alternatives:

- One global threshold: rejected, it hides weak spots in the engine and payments.

Consequences:

- Gates are checked by the coverage job in CI.

Evidence: SPEC-quality R-QA-021.

## D-0010: Cut list triggers

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The deadline is fixed and scope must shrink before quality does.
Decision: Cut scope in a fixed order when a trigger is hit, and record each cut as a new entry.
Alternatives:

- Decide ad hoc at the deadline: rejected, decisions made late are worse.

Consequences:

- From the freeze only fixes labelled priority:P0 or type:bug merge.

Evidence: SPEC-quality section 2 (Freeze), MASTER-PLAN.
