# Environments

Three GitHub environments exist (R-QA-043). Secrets live only in environment secrets and in the
Render and Cloudflare dashboards. `.env.example` lists the variable names with empty values; no
value is committed.

| Environment       | Used by                                | PayPal         | Notes                                                |
| ----------------- | -------------------------------------- | -------------- | ---------------------------------------------------- |
| `staging`         | deploys of `main`, the R7 and R8 specs | PayPal sandbox | Own data and URL.                                    |
| `production`      | the public demo                        | PayPal sandbox | Same PayPal sandbox as staging; data and URL differ. |
| `sandbox-nightly` | the gate workflows and the nightly run | PayPal sandbox | Required reviewer, deployments limited to `main`.    |

Both app environments point at the sandbox: `PAYMENTS=sandbox` and `PAYPAL_ENV=sandbox`. There is
no live PayPal account in this project.

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
