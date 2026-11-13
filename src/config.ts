export interface BotConfig {
	readonly discordToken: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): BotConfig {
	const discordToken = environment.DISCORD_TOKEN?.trim();

	if (!discordToken) {
		throw new Error('Missing required environment variable: DISCORD_TOKEN');
	}

	return { discordToken };
}
