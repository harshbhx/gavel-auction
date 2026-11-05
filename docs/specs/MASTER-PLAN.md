# MASTER-PLAN: GAVEL work breakdown and rules

Areas and key prefixes: ENG (engine), PAY (payments), RT (realtime and shared), VOI (voice), WEB (frontend), QA (quality and infra).
Cross-area keys are named by topic; real numbers come from each area's issues file.

## 1. Rules of the road

1. One issue, one branch, one PR. Branch `<type>/<KEY>-slug`; title starts with the key.
2. Interface-first: the first issue of every package publishes types, a fake or in-memory implementation and fixtures. Implementations and consumers start after it merges. Changes to `@gavel/shared` exports go in their own `interface`-labelled PR.
3. File ownership is exclusive (CODEOWNERS). `packages/shared` and `packages/server` belong to realtime; `packages/e2e`, `infra/`, `.github/` belong to quality.
4. Everything external sits behind an interface with a fake. No contributor needs a PayPal or STT key to be productive; only gate issues and nightly sandbox runs do.
5. Heavy work runs in GitHub Actions only. Locally: typecheck, lint on changed files, one package's unit tests.
6. A gate result that contradicts the design produces a DECISIONS.md entry and a stated fallback in the same PR.
7. Merge order: types and fakes first, then implementations, then integration, then polish.

## 2. Critical path

shared types -> engine -> room -> saga -> stack runner -> crash scenario S03. Keep the stack runner and the crash and resume scenario staffed.

## 3. Definition of ready and done (all areas)

Ready: issue has Spec, Files, Depends on, test ids, size under 4 hours, all dependencies merged.
Done: PR merged by squash, `ci / required` green, tests named in the Test plan exist and pass, docs updated, DECISIONS entry if a contract changed, no secrets, ASCII only.
