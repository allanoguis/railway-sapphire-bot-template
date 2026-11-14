# Agent instructions

At the start of every session or task, read the root `progress.md` before planning or changing code. Use it to understand the product direction, decisions, current status, and next steps. Cross-check time-sensitive details (especially Railway configuration and deployment status) against the current repository or available service data before acting.

After work that changes the project or materially changes its status, update `progress.md` with the outcome, validation performed, deployment status, blockers, and next steps. Keep the project goal and security constraints clear; do not record credentials, API keys, tokens, connection strings, or other secrets.

`progress.md` is intentionally ignored by Git and is local to this checkout. Do not force-add or commit it. If it is missing, reconstruct it from this file, the repository, and available session history before proceeding; note that the progress file is not synchronized to other clones or machines.
