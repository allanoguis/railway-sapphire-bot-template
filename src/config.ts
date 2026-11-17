export interface BotConfig {
	readonly discordToken: string;
	readonly commandCooldownDelayMs: number;
	readonly commandCooldownLimit: number;
	readonly healthPort?: number;
	readonly databaseUrl?: string;
	readonly tornEncryptionKey?: Buffer;
	readonly tornFactionChannelId?: string;
	readonly tornOcAlertChannelId: string;
	readonly website?: WebsiteConfig;
}

export interface WebsiteConfig {
	readonly origin: string;
	readonly clientId: string;
	readonly clientSecret: string;
	readonly ownerId: string;
}

function getWebsiteConfig(
	environment: NodeJS.ProcessEnv,
	databaseUrl: string | undefined,
	encryptionKey: Buffer | undefined
): WebsiteConfig | undefined {
	const origin = environment.WEBSITE_ORIGIN?.trim();
	const clientId = environment.DISCORD_CLIENT_ID?.trim();
	const clientSecret = environment.DISCORD_CLIENT_SECRET?.trim();
	const ownerId = environment.WEBSITE_OWNER_DISCORD_ID?.trim();
	if (ownerId && !/^\d{17,20}$/.test(ownerId)) {
		throw new Error('WEBSITE_OWNER_DISCORD_ID must be a valid Discord user ID.');
	}
	if (!origin && !clientId && !clientSecret) return undefined;
	if (!origin || !clientId || !clientSecret || !ownerId || !databaseUrl || !encryptionKey) {
		throw new Error(
			'Website configuration requires WEBSITE_ORIGIN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, WEBSITE_OWNER_DISCORD_ID, DATABASE_URL and TORN_ENCRYPTION_KEY.'
		);
	}
	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		throw new Error('WEBSITE_ORIGIN must be an HTTPS origin or an HTTP localhost origin.');
	}
	if (
		parsed.origin !== origin ||
		(parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) ||
		parsed.username ||
		parsed.password ||
		!/^\d{17,20}$/.test(clientId)
	) {
		throw new Error('WEBSITE_ORIGIN must be an HTTPS origin or an HTTP localhost origin, and DISCORD_CLIENT_ID must be a valid Discord ID.');
	}
	return { origin, clientId, clientSecret, ownerId };
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

function getDatabaseUrl(environment: NodeJS.ProcessEnv): string | undefined {
	const databaseUrl = environment.DATABASE_URL?.trim();
	if (!databaseUrl) return undefined;

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(databaseUrl);
	} catch {
		throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
	}

	if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
		throw new Error('DATABASE_URL must use the postgres:// or postgresql:// scheme.');
	}

	return databaseUrl;
}

function getTornEncryptionKey(environment: NodeJS.ProcessEnv): Buffer | undefined {
	const value = environment.TORN_ENCRYPTION_KEY?.trim();
	if (!value) return undefined;
	if (!/^[\da-fA-F]{64}$/.test(value)) {
		throw new Error('TORN_ENCRYPTION_KEY must be a 64-character hexadecimal value (32 bytes).');
	}

	return Buffer.from(value, 'hex');
}

function getTornFactionChannelId(environment: NodeJS.ProcessEnv): string | undefined {
	const value = environment.TORN_FACTION_CHANNEL_ID?.trim();
	if (!value) return undefined;
	if (!/^\d{17,20}$/.test(value)) {
		throw new Error('TORN_FACTION_CHANNEL_ID must be a valid Discord channel ID.');
	}

	return value;
}

function getTornOcAlertChannelId(environment: NodeJS.ProcessEnv): string {
	const value = environment.TORN_OC_ALERT_CHANNEL_ID?.trim() || '1571740567862382693';
	if (!/^\d{17,20}$/.test(value)) {
		throw new Error('TORN_OC_ALERT_CHANNEL_ID must be a valid Discord channel ID.');
	}

	return value;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): BotConfig {
	const discordToken = environment.DISCORD_TOKEN?.trim();

	if (!discordToken) {
		throw new Error('Missing required environment variable: DISCORD_TOKEN');
	}

	const healthPort = getPort(environment);
	const databaseUrl = getDatabaseUrl(environment);
	const tornEncryptionKey = getTornEncryptionKey(environment);
	const tornFactionChannelId = getTornFactionChannelId(environment);
	const tornOcAlertChannelId = getTornOcAlertChannelId(environment);
	const website = getWebsiteConfig(environment, databaseUrl, tornEncryptionKey);

	return {
		discordToken,
		commandCooldownDelayMs: getPositiveInteger(environment, 'COMMAND_COOLDOWN_DELAY_MS', 5000),
		commandCooldownLimit: getPositiveInteger(environment, 'COMMAND_COOLDOWN_LIMIT', 1),
		...(healthPort === undefined ? {} : { healthPort }),
		...(databaseUrl === undefined ? {} : { databaseUrl }),
		...(tornEncryptionKey === undefined ? {} : { tornEncryptionKey }),
		...(tornFactionChannelId === undefined ? {} : { tornFactionChannelId }),
		tornOcAlertChannelId,
		...(website === undefined ? {} : { website })
	};
}

export { getTornEncryptionKey };
