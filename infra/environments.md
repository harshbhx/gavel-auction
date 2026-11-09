# Environments

Three GitHub environments exist (R-QA-043). Secrets live only in environment secrets and in the
Render and Cloudflare dashboards. `.env.example` lists the variable names with empty values; no
value is committed.

| Environment       | Used by                                | PayPal         | Notes                                                |
| ----------------- | -------------------------------------- | -------------- | ---------------------------------------------------- |
| `staging`         | the optional `deploy-staging` run (manual only), the R7 and R8 specs | PayPal sandbox | Own data and URL. Not configured today.              |
| `production`      | the public demo                        | PayPal sandbox | Same PayPal sandbox as staging; data and URL differ. |
| `sandbox-nightly` | the gate workflows and the nightly run | PayPal sandbox | Required reviewer, deployments limited to `main`.    |

Both app environments point at the sandbox: `PAYMENTS=sandbox` and `PAYPAL_ENV=sandbox`. There is
no live PayPal account in this project.

## Deployed surfaces

| Surface   | Name                                                                                      | Set by                               |
| --------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| API       | Render web service `gavel-host`, Starter plan (`render.yaml`)                             | the owner, Manual Deploy of `main` in the Render dashboard (`deploy-prod` is optional and unused) |
| Web app   | Cloudflare Worker `gavel-web` (`infra/web/wrangler.toml`)                                 | `deploy-web.yml`                     |
| Docs site | Cloudflare Pages project `gavel-docs`, or the repository variable `DOCSITE_PAGES_PROJECT` | `docsite.yml`                        |

The one real deploy path is written down in `docs/DEPLOY.md` ("The one real deploy path"). Both Cloudflare deploys need the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Rollback steps for each surface are in `infra/rollback.md`.

## Boot validation

`packages/server/src/config/validate.ts` checks the environment before the server starts. A missing
or empty required variable, or a `PAYPAL_ENV` other than `sandbox`, ends the process with exit
code 78 and one JSON line per problem on stderr:

```json
{ "level": "fatal", "event": "boot_config_invalid", "variable": "ADMIN_KEY", "reason": "missing" }
```

The line names the variable and the reason (`missing` or `not_sandbox`) and never a value.

Required in every deployment: `PUBLIC_URL`, `TOKEN_SECRET`, `ADMIN_KEY`, `PAYMENTS`,
`PAYPAL_ENV`. Also required when `PAYMENTS=sandbox`: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
`PAYPAL_WEBHOOK_ID`.

## Secrets by environment

| Secret                                                    | staging | production | sandbox-nightly |
| --------------------------------------------------------- | ------- | ---------- | --------------- |
| `TOKEN_SECRET`, `ADMIN_KEY`                               | yes     | yes        | no              |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`                | yes     | yes        | yes             |
| `PAYPAL_WEBHOOK_ID`                                       | yes     | yes        | yes             |
| `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD`           | no      | no         | yes             |
| `SANDBOX_CARD_BUYER_EMAIL`, `SANDBOX_CARD_BUYER_PASSWORD` | no      | no         | yes (optional)  |
| `GAVEL_STAGING_URL`, `GAVEL_STAGING_ADMIN_KEY`            | no      | no         | yes (R7 and R8) |
| `DEEPGRAM_API_KEY`                                        | no      | no         | yes (G5)        |

Without a secret the matching nightly spec reports `skipped`; see `docs/GATES.md`.
