# Production deploy and rollback

Requirements: R-QA-042 (deploy), R-QA-049 (rollback). Workflow: `.github/workflows/deploy-prod.yml`.

## Deploy

1. Tag the commit: `git tag v0.1.0 && git push origin v0.1.0`, or run the workflow by hand from the Actions tab.
2. The job waits for approval on the `production` environment. Add a required reviewer under Settings, Environments, production; without one the gate does not exist.
3. After approval the job records the live Render deploy id, triggers the deploy hook, waits, runs `scripts/smoke.sh` against `PRODUCTION_URL`, and checks that `GET /version` serves the tagged commit.

Required in the `production` environment: secrets `RENDER_API_KEY`, `RENDER_DEPLOY_HOOK_URL`; variables `RENDER_SERVICE_ID`, `PRODUCTION_URL`. Values are never printed.

## Version endpoint

`GET /version` answers `{"sha":"<commit>"}`. The host reads `GAVEL_SHA`, or Render's `RENDER_GIT_COMMIT`, and answers `unknown` when neither is a hex commit id.

## Rollback

Run the workflow by hand with `rollback` set to true. The job lists the service's recent deploys, takes the newest deactivated one (the build that was live before the current one), and calls the Render rollback endpoint with it. The smoke test and the `/version` read run afterwards; the job summary shows which sha is now served.

The persistent disk is not rolled back. A rollback changes code only, so a release that changed the stored data format needs a data restore from the latest `backup.yml` artifact as well.

## Rehearsal

Record each rehearsal here.

| Date | Deployed sha A | Deployed sha B | Rollback served | Result      |
| ---- | -------------- | -------------- | --------------- | ----------- |
|      |                |                |                 | not run yet |

Acceptance: after rollback `/version` returns sha A again. The first row stays empty until a reviewer is configured and the Render service exists.
