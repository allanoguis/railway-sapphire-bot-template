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
- `/torn profile` for individual Torn profile information

## ⚙️ Configuration

- Copy `.env.example` to `.env` and set `DISCORD_TOKEN` to your Discord bot token.
- Optionally adjust `COMMAND_COOLDOWN_DELAY_MS` and `COMMAND_COOLDOWN_LIMIT` to change the default per-user command cooldown.
- For Railway, add `DISCORD_TOKEN` to the service's Variables; do not commit your `.env` file.
- For public Torn player lookups, optionally set `TORN_API_KEY` to a bot-owned Torn API key.
- To enable private account linking, configure `DATABASE_URL` and `TORN_ENCRYPTION_KEY`. Generate the latter with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and keep it backed up securely; losing it makes stored Torn keys unusable.

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

- `/torn profile` with no player ID displays the caller's linked profile. `/torn profile player-id:<id>` looks up public profile data using `TORN_API_KEY`; private bars are shown only for the linked account.
- `/torn link` first displays the API-key use and storage disclosure, then opens a private modal. Only a Torn API key is accepted; never provide a Torn password. `/torn unlink` deletes the encrypted key.
- User keys are encrypted with AES-256-GCM in PostgreSQL and require both `DATABASE_URL` and `TORN_ENCRYPTION_KEY`. The key is used only for the linked user's profile. Keep the encryption key backed up; changing or losing it prevents decrypting linked API keys.
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
