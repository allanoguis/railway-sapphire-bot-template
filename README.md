---
title: Token Discord Bot Template
description: Token is a Discord bot template built with Discord.js and the Sapphire framework.
tags:
  - typescript
  - javascript
  - discord
  - token
---

# Token Discord Bot Template

Token is a basic Discord bot template built with Discord.js and the [Sapphire](https://www.sapphirejs.dev/) framework.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/4v1jeR?referralCode=6QmbhN)

## ✨ Features

- Discord.js and Sapphire
- TypeScript
- `/help` lists commands in Core and Torn sections
- `/about` runtime details
- `/debug` to enable or disable the construction status
- `/clear` to remove selected users' messages, a specified number of recent messages, or all recent messages in a channel
- `/pair` and `/verify` for Torn account pairing and API-key verification
- `/torn profile` for individual Torn profile information
- `/torn faction info` to post the paired member's faction details in a permitted channel
- `/torn faction members` to post the paired member's faction roster in that channel
- `/torn faction unregistered` to post faction members who are not assigned to a recruiting or planning OC

## ⚙️ Configuration

- Copy `.env.example` to `.env` and set `DISCORD_TOKEN` to your Discord bot token.
- Optionally adjust `COMMAND_COOLDOWN_DELAY_MS` and `COMMAND_COOLDOWN_LIMIT` to change the default per-user command cooldown.
- To enable private Torn account pairing and API requests, configure `DATABASE_URL` and `TORN_ENCRYPTION_KEY`. Generate the latter with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and keep it backed up securely; losing it makes stored Torn keys unusable.
- To enable the faction commands, set `TORN_FACTION_CHANNEL_ID` to the Discord channel ID where public faction information may be posted. The bot rejects uses from other channels. Keep this channel appropriate for publicly sharing member status and last-action data.
- These Torn variables are configured once by the bot operator in the bot host's environment; individual Discord users do not need database credentials or an encryption key.

## 🚆 Railway deployment

- Keep the bot and PostgreSQL services in the same Railway project **and environment** so the bot can use Railway private networking.
- In the bot service's Variables, set `DISCORD_TOKEN` and set `DATABASE_URL` to a Railway service reference such as `${{Postgres.DATABASE_URL}}` (replace `Postgres` with the exact database service name). The bot only needs `DATABASE_URL`; do not copy the database's individual `PG*` or `POSTGRES_*` variables.
- Use `pnpm install --frozen-lockfile && pnpm build` as the build command and `pnpm start` as the start command. The package pins pnpm to match the existing lockfile.
- Railway supplies `PORT`; the health server listens on it. Set the deployment health check path to `/readyz`.
- On its first successful startup, the bot creates the minimal `verified_users` table automatically. No manual schema setup or seed data is needed. The database user must have permission to create tables in the target schema. Check the deployment logs for `PostgreSQL storage initialized` and `Ready as ...`.
- The Postgres internal hostname is only reachable inside the Railway environment. A local connection using that URL will fail to resolve; do not enable a public TCP proxy just for bot-to-database traffic.
- Keep appropriate PostgreSQL backups enabled. Each bot process uses a PostgreSQL connection pool (up to 10 connections by default), so account for all replicas when scaling.

## 🔐 Command permissions

The built-in `GuildOnly` precondition restricts `/ping` to servers. The `/debug` command requires the user to have Manage Messages permission:

```ts
requiredUserPermissions: PermissionFlagsBits.ManageMessages
```

Sapphire's built-in `requiredUserPermissions` and `requiredClientPermissions` options are also available when a command needs different permission requirements.

The `/clear` command requires both the user and the bot to have Manage Messages permission in the current channel. It asks for private confirmation before deleting, and leaves messages older than 14 days untouched because Discord does not allow them to be bulk-deleted.

Use `/clear user` to remove up to 100 recent messages from a selected user, `/clear amount` to remove up to 100 of the latest messages regardless of author, or `/clear all` to remove all eligible recent messages in the current channel. Each operation requires an ephemeral confirmation.

The `/help` command lists general bot commands, including `/clear`, under **Core**. Torn-related commands such as `/pair`, `/verify`, `/unpair`, and `/torn` appear under **Torn**.

## ⏱️ Command cooldowns

Commands default to one use per user every five seconds. This is configurable with the two cooldown variables above; individual commands can override the default with Sapphire's `cooldownDelay` and `cooldownLimit` options.

The process also handles `SIGINT` and `SIGTERM` by closing the Discord client before exiting.

## 🗄️ Persistent storage

Set `DATABASE_URL` to a PostgreSQL connection URL to enable the `container.storage` service. It creates `verified_users` with one row per Discord user: `discord_id` is the primary key, `torn_api` is a JSONB encrypted-credential envelope, and `updated_at` records the last pairing update. On startup, the bot migrates matching per-user Torn credentials from the legacy `bot_settings` table and drops that table when it contains no unrelated settings. If unrelated legacy data remains, the bot preserves the old table and logs a warning rather than deleting that data. Without `DATABASE_URL`, storage stays disabled and the bot logs a warning. A configured but unreachable database fails startup so the application does not silently run without persistence.

## 🧩 Feature module conventions

Keep Sapphire entry points in their auto-discovered directories and delegate feature behavior to focused modules:

```text
src/
  commands/       # Thin slash-command adapters
  listeners/      # Discord event adapters
  preconditions/  # Reusable access and eligibility checks
  features/
    core/         # General bot functionality, independent of Torn
    torn/         # Torn-specific functionality and API integrations
    <feature>/
      service.ts  # Feature-specific behavior
      types.ts    # Feature-specific types, when needed
  lib/            # Infrastructure shared across features
```

Commands should validate interaction input and call a feature service rather than contain database or domain logic. Listeners should delegate event handling to the relevant service, while preconditions should focus on access checks. Keep shared infrastructure in `src/lib` and avoid importing one feature's command or listener into another. Sapphire pieces can use `this.container.storage`; it is `null` when `DATABASE_URL` is unset, so features that require persistence should handle that case explicitly.

## 🎮 Torn individual profiles

- `/pair` displays the API-key use and storage disclosure, then opens a private modal. Only a Torn API key is accepted; never provide a Torn password. `/verify` revalidates the paired key with Torn and privately confirms whether it is still valid. `/unpair` deletes the encrypted key.
- Pairing and verification call Torn API v2 with `GET https://api.torn.com/v2/user/basic?key=...`. `/verify` loads and decrypts only the invoking Discord user's stored key, then confirms Torn returns the same player ID that was paired.
- `/torn profile` uses the caller's own paired Torn API key for every request. With no player ID it displays the caller's own profile; with `player-id:<id>` it requests that player's profile using the caller's key. Torn may restrict the returned data based on that key's access level.
- Each user's key is encrypted with AES-256-GCM in PostgreSQL and is used for `/verify` and that user's profile requests. Pairing requires both `DATABASE_URL` and `TORN_ENCRYPTION_KEY`. Keep the encryption key backed up; changing or losing it prevents decrypting paired API keys.
- The bot requests Torn API v2 `/v2/user/profile` and `/v2/user/faction` for a profile, adding the `id` parameter for a different player. It separately requests `/v2/user/bars`, `/v2/user/cooldowns`, and `/v2/user/battlestats` only for the paired user's own profile. Battle stats are never requested or shown for another player's profile. Torn may reject unavailable endpoints based on the API key's access level. Responses are private to the requesting Discord user.
- `/torn faction info` and `/torn faction members` use the invoking member's own paired Torn API key and Torn API v2's `/v2/user/faction`, `/v2/faction/basic`, `/v2/faction/members`, `/v2/faction/chain`, `/v2/faction/wars`, and `/v2/faction/territory` endpoints. Those endpoints require a public access key. `/torn faction unregistered` also requests `/v2/faction/crimes?cat=available`; Torn requires a minimal access key with faction API access for that endpoint. The `available` category includes recruiting and planning crimes. All three commands are available to server members only in the configured `TORN_FACTION_CHANNEL_ID` and post publicly.
- The faction info post includes faction name, ID, text tag, leader, member count, respect, age, best chain, current chain, territories, wars/pacts with their status or expiry, and a link to the Torn faction page. It does not include tag-image data. The roster command includes each member's name, Torn ID, faction position, level, status, and last action, splitting a long roster across messages when needed. The unregistered command lists faction members whose IDs are absent from every slot in the returned available crimes; it uses the v2 slot `user.id` field. This reports OC slot registration only, not Torn account verification or personal item ownership. Configure a channel where sharing these fields is appropriate.

## 🩺 Health checks

The built-in HTTP server listens on `PORT` (default `3000`). Configure Railway's health check path as `/readyz`; it returns `200` after the Discord client is ready and `503` before then. `/healthz` reports process liveness, and unknown paths return `404`.

## 💁‍♀️ How to use

- Install dependencies with `pnpm install`
- Configure `DISCORD_TOKEN` as described above
- Connect to your Railway project `railway link`
- Build the bot `pnpm build`
- Start the bot `railway run pnpm start`
