# GitHub Actions secrets

The current scraper workflows are manual smoke tests that write to an
ephemeral local SQLite file inside GitHub Actions. Production data refreshes
run on the local workstation so the attached SSD database is updated directly.
No GitHub Actions secrets are required for the current scrape / discover /
maintenance workflows.

## Required

None.

## Optional (not currently used, reserved for future workflows)

| Secret | Used by | Source |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | optional remote DB experiments | `turso db show onepiece-tcg --url` |
| `TURSO_AUTH_TOKEN` | optional remote DB experiments | `turso group tokens create default` |
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
| `scrape-regulations.yml` | — | manual via "Run workflow" |
| `discover-new-sets.yml` | — | manual via "Run workflow" |
| `scrape-bandai-cards.yml` | — | manual via "Run workflow" |
| `db-maintenance.yml` | — | manual via "Run workflow" |
