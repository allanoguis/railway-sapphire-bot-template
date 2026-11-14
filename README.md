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
- `/help` command discovery
- `/about` runtime details
- `/debug` to enable or disable the construction status
- `/pair` and `/verify` for Torn account pairing and API-key verification
- `/torn profile` for individual Torn profile information

## ⚙️ Configuration

- Copy `.env.example` to `.env` and set `DISCORD_TOKEN` to your Discord bot token.
- Optionally adjust `COMMAND_COOLDOWN_DELAY_MS` and `COMMAND_COOLDOWN_LIMIT` to change the default per-user command cooldown.
- For public Torn player lookups, optionally set `TORN_API_KEY` to a bot-owned Torn API key.
- To enable private account pairing, configure `DATABASE_URL` and `TORN_ENCRYPTION_KEY`. Generate the latter with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and keep it backed up securely; losing it makes stored Torn keys unusable.
- These Torn variables are configured once by the bot operator in the bot host's environment; individual Discord users do not need database credentials or an encryption key.

## 🚆 Railway deployment

- Keep the bot and PostgreSQL services in the same Railway project **and environment** so the bot can use Railway private networking.
- In the bot service's Variables, set `DISCORD_TOKEN` and set `DATABASE_URL` to a Railway service reference such as `${{Postgres.DATABASE_URL}}` (replace `Postgres` with the exact database service name). The bot only needs `DATABASE_URL`; do not copy the database's individual `PG*` or `POSTGRES_*` variables.
- Use `pnpm install --frozen-lockfile && pnpm build` as the build command and `pnpm start` as the start command. The package pins pnpm to match the existing lockfile.
- Railway supplies `PORT`; the health server listens on it. Set the deployment health check path to `/readyz`.
- On its first successful startup, the bot creates the minimal `bot_settings` table automatically. No manual schema setup or seed data is needed. The database user must have permission to create tables in the target schema. Check the deployment logs for `PostgreSQL storage initialized` and `Ready as ...`.
- The Postgres internal hostname is only reachable inside the Railway environment. A local connection using that URL will fail to resolve; do not enable a public TCP proxy just for bot-to-database traffic.
- Keep appropriate PostgreSQL backups enabled. Each bot process uses a PostgreSQL connection pool (up to 10 connections by default), so account for all replicas when scaling.

## 🔐 Command permissions

The built-in `GuildOnly` precondition restricts `/ping` to servers. The `/debug` command requires the user to have Manage Messages permission:

```ts
requiredUserPermissions: PermissionFlagsBits.ManageMessages
```

Sapphire's built-in `requiredUserPermissions` and `requiredClientPermissions` options are also available when a command needs different permission requirements.

## ⏱️ Command cooldowns

Commands default to one use per user every five seconds. This is configurable with the two cooldown variables above; individual commands can override the default with Sapphire's `cooldownDelay` and `cooldownLimit` options.

The process also handles `SIGINT` and `SIGTERM` by closing the Discord client before exiting.

## 🗄️ Persistent storage

Set `DATABASE_URL` to a PostgreSQL connection URL to enable the shared `container.storage` service. On startup it creates an idempotent `bot_settings` table with JSONB values; the service provides `get(scope, key)`, `set(scope, key, value)`, and `delete(scope, key)` methods. The setting scope can be `global` or a namespaced value such as `guild:<guild-id>`. Without `DATABASE_URL`, storage stays disabled and the bot logs a warning. A configured but unreachable database fails startup so the application does not silently run without persistence.

## 🧩 Feature module conventions

Keep Sapphire entry points in their auto-discovered directories and delegate feature behavior to focused modules:

```text
src/
  commands/       # Thin slash-command adapters
  listeners/      # Discord event adapters
  preconditions/  # Reusable access and eligibility checks
  features/
    <feature>/
      service.ts  # Feature-specific behavior
      types.ts    # Feature-specific types, when needed
  lib/            # Infrastructure shared across features
```

Commands should validate interaction input and call a feature service rather than contain database or domain logic. Listeners should delegate event handling to the relevant service, while preconditions should focus on access checks. Keep shared infrastructure in `src/lib` and avoid importing one feature's command or listener into another. Sapphire pieces can use `this.container.storage`; it is `null` when `DATABASE_URL` is unset, so features that require persistence should handle that case explicitly.

## 🎮 Torn individual profiles

- `/pair` displays the API-key use and storage disclosure, then opens a private modal. Only a Torn API key is accepted; never provide a Torn password. `/verify` revalidates the paired key with Torn and privately confirms whether it is still valid. `/torn unlink` deletes the encrypted key.
- `/torn profile` with no player ID displays the caller's paired profile. `/torn profile player-id:<id>` looks up public profile data using `TORN_API_KEY`; private bars are shown only for the paired account.
- User keys are encrypted with AES-256-GCM in PostgreSQL and require both `DATABASE_URL` and `TORN_ENCRYPTION_KEY`. The key is used only for the paired user's profile and `/verify`. Keep the encryption key backed up; changing or losing it prevents decrypting paired API keys.
- The bot requests only the Torn API `basic`, `profile`, `bars`, `cooldowns`, and `battlestats` selections as needed. Torn may reject unavailable selections based on the API key's access level. Responses are private to the requesting Discord user.
- Faction management is intentionally not included in this individual-profile module.

## 🩺 Health checks

The built-in HTTP server listens on `PORT` (default `3000`). Configure Railway's health check path as `/readyz`; it returns `200` after the Discord client is ready and `503` before then. `/healthz` reports process liveness, and unknown paths return `404`.

## 💁‍♀️ How to use

- Install dependencies with `pnpm install`
- Configure `DISCORD_TOKEN` as described above
- Connect to your Railway project `railway link`
- Build the bot `pnpm build`
- Start the bot `railway run pnpm start`
