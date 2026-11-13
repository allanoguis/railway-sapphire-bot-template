---
title: Discord Sapphire Bot
description: A basic Discord bot template using Discord.js and the Sapphire library.
tags:
  - typescript
  - javascript
  - discord
  - sapphire
---

# Discord Sapphire Bot template

This is a basic Discord bot template using Discord.js and the [Sapphire](https://www.sapphirejs.dev/) library.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/4v1jeR?referralCode=6QmbhN)

## ✨ Features

- Sapphire
- TypeScript

## ⚙️ Configuration

- Copy `.env.example` to `.env` and set `DISCORD_TOKEN` to your Discord bot token.
- For Railway, add `DISCORD_TOKEN` to the service's Variables; do not commit your `.env` file.

## 🔐 Command permissions

The built-in `GuildOnly` precondition restricts `/ping` to servers. For staff commands, the custom `StaffOnly` precondition requires the user to have Manage Messages:

```ts
preconditions: ['GuildOnly', 'StaffOnly']
```

Sapphire's built-in `requiredUserPermissions` and `requiredClientPermissions` options are also available when a command needs different permission requirements.

## 💁‍♀️ How to use

- Install dependencies with `pnpm install`
- Configure `DISCORD_TOKEN` as described above
- Connect to your Railway project `railway link`
- Build the bot `pnpm build`
- Start the bot `railway run pnpm start`
