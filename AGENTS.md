# Agent instructions

At the start of every session or task, load the Obsidian project context before planning or changing code:

1. If the root `progress.md` is missing, reconstruct it from the Obsidian progress snapshot, this file, the repository, and available session history; do not invent current status.
2. Run `.\sync-vault-notes.ps1` from the repository root to refresh the mirrored guides. If the vault is elsewhere, set `OBSIDIAN_VAULT_PATH` or pass `-VaultPath`.
3. Read the vault's `Token Discord Bot Project.md`, then `Project Reference/Agent Instructions.md`, `Project Reference/Project Progress Snapshot.md`, and `Project Reference/Project README.md`. Read relevant notes under `Copilot Sessions/` for historical decisions.
4. Treat the repository's `AGENTS.md`, `README.md`, and root `progress.md` as canonical. The vault copies are read-only mirrors; historical session notes can be incomplete or stale. Verify implementation details in the current repository and time-sensitive Railway facts against current service data.

After work that changes the project or materially changes its status, update the root `progress.md` with the outcome, validation performed, deployment status, blockers, and next steps. Update `README.md` or this file when their guidance changes, then run `.\sync-vault-notes.ps1` again so the vault mirrors stay current. Do not edit mirrored guide copies directly. Keep the project goal and security constraints clear; do not record credentials, API keys, tokens, connection strings, or other secrets.

`progress.md` is intentionally ignored by Git and is local to this checkout. Do not force-add or commit it. The sync script mirrors it to the configured Obsidian vault on this machine; it does not synchronize `progress.md` to other clones or machines.

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
-   `/torn faction organized-crime` uses the caller's paired key to identify the faction and its registered Leader, then uses that Leader's encrypted, PostgreSQL-stored key only for Torn API v2 `cat=available` crime requests, with the Leader's consent. Never log or expose the decrypted key. The Leader's key must have Faction API Access; explain this requirement when Torn denies the request. Use the response's `item_requirement.is_available` to flag missing items, `checkpoint_pass_rate` for CPR, and `difficulty` for the OC score level; do not make separate personal-inventory requests. Discord subcommand names cannot contain spaces, so use the hyphenated `organized-crime` name.

## Test file policy

-   Keep all files under `/test/` gitignored and do not add per-file exceptions. Local test files may be run for validation but should not be tracked.
