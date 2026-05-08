# GitHub Actions secrets

Set these in **Settings → Secrets and variables → Actions → Repository
secrets** of the GitHub repo. They are required for the scrape /
discover workflows; the CI workflow itself does not need any secrets.

## Required

| Secret | Used by | Source |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | `scrape-regulations.yml`, `discover-new-sets.yml` | `turso db show onepiece-tcg --url` |
| `TURSO_AUTH_TOKEN`   | same | `turso group tokens create default` |

## Optional (not currently used, reserved for future workflows)

| Secret | Used by | Source |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (future) AI synergy + AI deck-proposal background jobs | https://console.anthropic.com/ |

## Token rotation

`TURSO_AUTH_TOKEN` is a JWT; rotate it any time without losing data:

```bash
turso group tokens invalidate default       # invalidate the existing token
turso group tokens create default            # mint a new one
# Paste the new value into the repo secret
```

The DB URL is stable; you only need to update it if you rename the
database or move it between organizations.

## Workflow targets

| Workflow | Schedule | Trigger |
| --- | --- | --- |
| `ci.yml` | — | every push to `main`, every PR |
| `scrape-regulations.yml` | weekly (Mon 00:00 UTC) | + manual via "Run workflow" |
| `discover-new-sets.yml` | — | manual only (fires once per new pack) |
