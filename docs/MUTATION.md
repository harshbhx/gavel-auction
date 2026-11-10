# Mutation testing results

Stryker runs from `.github/workflows/mutation.yml` (config: `stryker.config.mjs`, threshold 80, non-blocking). Nothing was run on a developer machine.

## Saga (`packages/payments/src/saga/**`)

Run https://github.com/harshbhx/gavel-auction/actions/runs/42765784229 (job `mutation (saga)`, 10 Nov 2026, branch `docs/FIX-162-quality-evidence`, after the vitest root fix).

**Score 77.5 %, under the 80 % threshold.** 2319 mutants: 1708 killed, 417 survived, 79 without coverage, 115 ignored. The score is killed over killed plus survived plus no coverage.

| File            | Killed | Survived | No coverage | Score % |
| --------------- | ------ | -------- | ----------- | ------- |
| `truth.ts`      | 6      | 5        | 0           | 54.5    |
| `killswitch.ts` | 41     | 14       | 10          | 63.1    |
| `remainder.ts`  | 79     | 31       | 8           | 66.9    |
| `bridge.ts`     | 18     | 7        | 1           | 69.2    |
| `create.ts`     | 158    | 53       | 4           | 73.5    |
| `machine.ts`    | 94     | 29       | 4           | 74.0    |
| `reauth.ts`     | 191    | 45       | 18          | 75.2    |
| `emit.ts`       | 71     | 16       | 3           | 78.9    |
| `void.ts`       | 425    | 98       | 14          | 79.1    |
| `capture.ts`    | 538    | 118      | 17          | 79.9    |
| `plan.ts`       | 41     | 1        | 0           | 97.6    |
| `owner.ts`      | 4      | 0        | 0           | 100.0   |
| `unknown.ts`    | 17     | 0        | 0           | 100.0   |
| `fallback.ts`   | 13     | 0        | 0           | 100.0   |
| `trail.ts`      | 12     | 0        | 0           | 100.0   |

Surviving mutants by kind: ConditionalExpression 196, StringLiteral 159, LogicalOperator 30, EqualityOperator 28, ObjectLiteral 22, BlockStatement 15, MethodExpression 11, OptionalChaining 8. The full list (file, line, mutator, replacement: 496 entries) is in the artifact `mutation-saga` of the run above (`summary.json`, kept 7 days). The weakest files are `truth.ts`, `killswitch.ts`, `remainder.ts` and `bridge.ts`.

## Engine (`packages/engine/src/**`)

Not recorded yet. The first dispatch on `main` (https://github.com/harshbhx/gavel-auction/actions/runs/42764815655) was green but wrote no report: the first test run timed out. Later runs failed in the first test run on the timing budget test and on the 5 s test timeout under instrumentation; `packages/engine/vitest.mutation.config.ts` now leaves out `perf.test.ts` and raises the timeout for the mutation run only. A run with that config is https://github.com/harshbhx/gavel-auction/actions/runs/42769816832; its score is to be added here when it finishes. Until then the engine score is UNKNOWN, not met.
