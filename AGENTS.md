# Agent instructions

At the start of every session or task, load the Obsidian project context before planning or changing code:

1. If the root `progress.md` is missing, reconstruct it from the Obsidian progress snapshot, this file, the repository, and available session history; do not invent current status.
2. Read the vault's `Token Discord Bot Project.md`, then `Project Reference/Agent Instructions.md`, `Project Reference/Project Progress Snapshot.md`, and `Project Reference/Project README.md`. Read relevant notes under `Copilot Sessions/` for historical decisions.
3. Check the checkout, its Git status, and the timestamps and contents of the local guides and vault mirrors before syncing. Each checkout has its own ignored `progress.md`; a different or stale checkout can overwrite newer vault notes. Reconcile differences instead of blindly syncing.
4. Treat the active checkout's `AGENTS.md`, `README.md`, and root `progress.md` as its canonical guides. Vault reference copies are mirrors; historical session notes can be incomplete or stale. Verify implementation details in the current checkout and time-sensitive Railway facts against current service data.

After work that changes the project or materially changes its status, update the root `progress.md` with the outcome, validation performed, deployment status, blockers, and next steps. Update `README.md` or this file when their guidance changes, then run `.\sync-vault-notes.ps1` again so the vault mirrors stay current. Do not edit mirrored guide copies directly. Keep the project goal and security constraints clear; do not record credentials, API keys, tokens, connection strings, or other secrets.

`progress.md` is intentionally ignored by Git and is local to this checkout. Do not force-add or commit it. After reconciling sources, run `.\sync-vault-notes.ps1` from the intended checkout to refresh the mirrors; if the vault is elsewhere, set `OBSIDIAN_VAULT_PATH` or pass `-VaultPath`. The script does not synchronize `progress.md` to other clones or machines.

## Dashboard direction and security

-   The current direction is a personal, owner-only React/TypeScript/Vite dashboard in the separate `D:\GitHub\token-dashboard` repository. The bot and PostgreSQL stay on Railway; the local frontend and Railway SSH tunnel bind to loopback. Vercel, payment processing, and an activation page are not part of the current design.
-   The bot API enforces owner authentication, CSRF checks, faction channel permissions, and separate website consent for private profiles and leader-key crimes. Preserve those boundaries and fail closed. Website actions and `/unpair` remain available when Discord feature switches are disabled.
-   The local dashboard-related changes are not necessarily deployed. Verify deployment provenance and live configuration before claiming otherwise. Protect existing work in both bot checkouts and the separate dashboard; do not overwrite or reset it to match a deployment.

## Product feature categories

-   Organize the bot's functionality into Core and Torn features. Core contains general bot features that are not specific to Torn; Torn contains features related to Torn, its game data, accounts, and API.
-   Keep general bot commands such as `/clear` as standalone Core commands, not as subcommands of `/torn`.
-   The `/help` list treats commands as Core by default. Set `helpCategory` to `'torn'` on Torn-specific commands so they appear in the Torn section.

## Torn API version policy

-   All Torn API requests made by the application must use Torn API v2. Do not add or retain v1 request paths or v1 `selections` parameters; avoid mixed v1/v2 request flows.
-   Before implementing or changing Torn API calls, check the current official Torn API v2 Swagger UI for endpoints, request parameters, access requirements, and response schemas: [Torn - Swagger UI](https://www.torn.com/swagger.php#/). Do not rely on legacy code, old examples, or assumptions when they conflict with the current documentation.
-   When a request touches an existing v1 flow, migrate every affected call site, response parser/type, test, and directly related documentation to v2 in the same change. If official v2 behavior cannot be confirmed, pause and ask rather than guessing.
-   Tests for Torn API behavior must assert the v2 endpoint and the documented v2 response shape. Do not silently fall back to v1.

## Faction output policy

-   Do not include faction tag-image data in future faction command output, embeds, examples, or documentation. The faction's text tag is separate and may still be included.
-   `/torn faction organized-crime` uses the caller's paired key to identify the faction and its roster, and to fetch public item names with Torn API v2 `/torn/{ids}/items`. It uses the registered Leader's encrypted, PostgreSQL-stored key only for faction crime requests, with the Leader's consent. Never log or expose the decrypted key. The Leader's key must have Faction API Access; explain this requirement when Torn denies the request. Use `cat=available` for crime details (`recruiting` + `planning`), and count `recruiting`, `planning` (shown as Ongoing), and `completed` separately for the final summary. The API has no `ongoing` category, and `completed` includes successful and failed crimes. Resolve player names from the faction roster; show pass rates as Success above 70%, Might Fail below 70%, and the percentage alone at exactly 70%. Label slot outcomes Status, use item names instead of IDs, and do not make separate personal-inventory requests. Discord subcommand names cannot contain spaces, so use the hyphenated `organized-crime` name.

## Test file policy

-   Keep all files under `/test/` gitignored and do not add per-file exceptions. Local test files may be run for validation but should not be tracked.
