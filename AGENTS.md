# Agent instructions

At the start of every session or task, read the root `progress.md` before planning or changing code. Use it to understand the product direction, decisions, current status, and next steps. Cross-check time-sensitive details (especially Railway configuration and deployment status) against the current repository or available service data before acting.

After work that changes the project or materially changes its status, update `progress.md` with the outcome, validation performed, deployment status, blockers, and next steps. Keep the project goal and security constraints clear; do not record credentials, API keys, tokens, connection strings, or other secrets.

`progress.md` is intentionally ignored by Git and is local to this checkout. Do not force-add or commit it. If it is missing, reconstruct it from this file, the repository, and available session history before proceeding; note that the progress file is not synchronized to other clones or machines.

## Torn API version policy

-   All Torn API requests made by the application must use Torn API v2. Do not add or retain v1 request paths or v1 `selections` parameters; avoid mixed v1/v2 request flows.
-   Before implementing or changing Torn API calls, check the current official Torn API v2 Swagger UI for endpoints, request parameters, access requirements, and response schemas: [Torn - Swagger UI](https://www.torn.com/swagger.php#/). Do not rely on legacy code, old examples, or assumptions when they conflict with the current documentation.
-   When a request touches an existing v1 flow, migrate every affected call site, response parser/type, test, and directly related documentation to v2 in the same change. If official v2 behavior cannot be confirmed, pause and ask rather than guessing.
-   Tests for Torn API behavior must assert the v2 endpoint and the documented v2 response shape. Do not silently fall back to v1.

## Faction output policy

-   Do not include faction tag-image data in future faction command output, embeds, examples, or documentation. The faction's text tag is separate and may still be included.
