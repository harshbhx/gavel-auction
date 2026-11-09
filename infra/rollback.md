# Production deploy and rollback

Three surfaces deploy separately: the API on Render (this page, sections Deploy to Rollback), the web Worker `gavel-web` and the docs site (sections below). Names and settings are in `infra/environments.md`.

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

## Rollback web (Cloudflare Worker `gavel-web`)

The `deploy-web` workflow builds the artifact `web-dist` and runs `wrangler deploy` on every push to `main` that touches the web package. Each deploy is a Worker version, so a revert needs no rebuild:

```
cd infra/web
npx wrangler deployments list        # recent deployments and their version ids
npx wrangler rollback                # back to the previous version
npx wrangler rollback <version-id>   # or to a chosen one
```

It needs a Cloudflare API token with Workers edit rights for the account, held by the repository owner as `CLOUDFLARE_API_TOKEN`. The alternative is to redeploy an older `web-dist` artifact (`gh run download <run-id> -n web-dist -D infra/web/dist`, then `npx wrangler deploy`), which works while the artifact has not expired. Check the result by opening the Worker address and the `/try` page.

The web build embeds `VITE_API_BASE` and `VITE_WS_BASE` at build time. A web rollback keeps the API address it was built with, and an API rollback leaves the web app as it is, so after a release that changed the protocol roll both back together, API first, then web.

## Rollback docs site

`docsite.yml` publishes the artifact `docsite` with `wrangler pages deploy` to the Cloudflare project named by the repository variable `DOCSITE_PAGES_PROJECT` (default `gavel-docs`). Every deploy stays listed:

```
npx wrangler pages deployment list --project-name gavel-docs
```

To revert, open the project in the Cloudflare dashboard (Workers and Pages, the project, Deployments), pick an earlier production deployment and choose rollback to this deployment. A rollback of the docs site does not touch the API or the web app. Without dashboard access, re-run `docsite.yml` on an earlier commit of `main`.

## Rehearsal

Record each rehearsal here.

| Date | Surface | Deployed sha A | Deployed sha B | Rollback served | Result      |
| ---- | ------- | -------------- | -------------- | --------------- | ----------- |
|      | API     |                |                |                 | not run yet |
|      | Web     |                |                |                 | not run yet |
|      | Docs    |                |                |                 | not run yet |

Acceptance: after rollback `/version` returns sha A again. The rows stay empty until each rehearsal is run.
