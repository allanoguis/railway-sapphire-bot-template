export interface BotConfig {
	readonly discordToken: string;
	readonly commandCooldownDelayMs: number;
	readonly commandCooldownLimit: number;
	readonly healthPort?: number;
}

function getPositiveInteger(environment: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
	const value = environment[name]?.trim();
	if (!value) return defaultValue;

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer.`);
	}

	return parsed;
}

function getPort(environment: NodeJS.ProcessEnv): number | undefined {
	const value = environment.PORT?.trim();
	if (!value) return undefined;

	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error('PORT must be an integer between 1 and 65535.');
	}

	return port;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): BotConfig {
	const discordToken = environment.DISCORD_TOKEN?.trim();

	if (!discordToken) {
		throw new Error('Missing required environment variable: DISCORD_TOKEN');
	}

	const healthPort = getPort(environment);

	return {
		discordToken,
		commandCooldownDelayMs: getPositiveInteger(environment, 'COMMAND_COOLDOWN_DELAY_MS', 5000),
		commandCooldownLimit: getPositiveInteger(environment, 'COMMAND_COOLDOWN_LIMIT', 1),
		...(healthPort === undefined ? {} : { healthPort })
	};
}
