# Production deploy and rollback

Requirements: R-QA-042 (deploy), R-QA-049 (rollback). Workflow: `.github/workflows/deploy-prod.yml`.

## Deploy

1. Tag the commit: `git tag v0.1.0 && git push origin v0.1.0`, or run the workflow by hand from the Actions tab.
2. The job waits for approval on the `production` environment. Add a required reviewer under Settings, Environments, production; without one the gate does not exist.
3. A deploy run stops before anything changes unless the tagged or dispatched commit is the head of `main`, because the deploy hook builds the head of `main`.
4. After approval the job records the live Render deploy id, triggers the deploy hook, polls `GET /version` until it serves the deployed commit (15 minutes at most), then runs `scripts/smoke.sh` against `PRODUCTION_URL`. If the commit never appears, the job restores the deploy that was live before it automatically.

Required in the `production` environment: secrets `RENDER_API_KEY`, `RENDER_DEPLOY_HOOK_URL`; variables `RENDER_SERVICE_ID`, `PRODUCTION_URL`. Values are never printed.

## Version endpoint

`GET /version` answers `{"sha":"<commit>"}`. The host reads `GAVEL_SHA`, or Render's `RENDER_GIT_COMMIT`, and answers `unknown` when neither is a hex commit id.

## Rollback

Run the workflow by hand with `rollback` set to true. The job lists the service's recent deploys, takes the newest deactivated one built from a different commit than the live one, and calls the Render rollback endpoint with it. The job then waits until `/version` serves that deploy's commit and runs the smoke test; the job summary shows which sha is now served. When the live deploy is itself a rollback the job refuses to guess, because the newest deactivated deploy is then the bad build: pass the Render deploy id to restore in the `rollback_deploy_id` input.

The persistent disk is not rolled back. A rollback changes code only, so a release that changed the stored data format needs a data restore from the latest `backup.yml` artifact as well.

## Rehearsal

Record each rehearsal here.

| Date | Deployed sha A | Deployed sha B | Rollback served | Result      |
| ---- | -------------- | -------------- | --------------- | ----------- |
|      |                |                |                 | not run yet |

Acceptance: after rollback `/version` returns sha A again. The first row stays empty until a reviewer is configured and the Render service exists.
