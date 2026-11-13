import 'dotenv/config';
import { LogLevel, SapphireClient } from '@sapphire/framework';
import { Logger } from '@sapphire/plugin-logger';
import '@sapphire/plugin-logger/register';
import { GatewayIntentBits } from 'discord.js';

const client = new SapphireClient({
	caseInsensitiveCommands: true,
	logger: {
		instance: new Logger({ level: LogLevel.Debug })
	},
	intents: [GatewayIntentBits.Guilds]
});

const main = async () => {
	try {
		const token = process.env.DISCORD_TOKEN?.trim();
		if (!token) {
			throw new Error('Missing required environment variable: DISCORD_TOKEN');
		}

		client.logger.info('Logging in');
		await client.login(token);
		client.logger.info('Logged in');
	} catch (error) {
		client.logger.fatal(error);
		await client.destroy();
		process.exit(1);
	}
};

void main().catch(async (error) => {
	client.logger.fatal(error);
	await client.destroy();
	process.exit(1);
});
