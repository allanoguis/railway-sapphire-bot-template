import 'dotenv/config';
import { BucketScope, LogLevel, SapphireClient } from '@sapphire/framework';
import { Logger } from '@sapphire/plugin-logger';
import '@sapphire/plugin-logger/register';
import { GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config';
import { registerShutdownHandlers } from './lib/shutdown';

const logger = new Logger({ level: LogLevel.Debug });
let client: SapphireClient | undefined;

const main = async () => {
	try {
		const config = loadConfig();
		client = new SapphireClient({
			caseInsensitiveCommands: true,
			logger: { instance: logger },
			intents: [GatewayIntentBits.Guilds],
			defaultCooldown: {
				scope: BucketScope.User,
				delay: config.commandCooldownDelayMs,
				limit: config.commandCooldownLimit
			}
		});
		registerShutdownHandlers(client, logger);

		logger.info('Logging in');
		await client.login(config.discordToken);
		logger.info('Logged in');
	} catch (error) {
		logger.fatal(error);
		await client?.destroy();
		process.exit(1);
	}
};

void main().catch((error) => {
	logger.fatal(error);
	process.exit(1);
});
