import 'dotenv/config';
import { BucketScope, LogLevel, SapphireClient } from '@sapphire/framework';
import { Logger } from '@sapphire/plugin-logger';
import '@sapphire/plugin-logger/register';
import { GatewayIntentBits } from 'discord.js';
import type { Server } from 'node:http';
import { loadConfig } from './config';
import { closeHealthServer, createHealthServer, listenHealthServer } from './lib/health';
import { registerShutdownHandlers } from './lib/shutdown';

const logger = new Logger({ level: LogLevel.Debug });
let client: SapphireClient | undefined;
let healthServer: Server | undefined;

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
		const server = createHealthServer(() => client?.isReady() ?? false);
		healthServer = server;
		server.on('error', (error) => logger.error(error, 'Health server error'));
		await listenHealthServer(server, config.healthPort ?? 3000);
		registerShutdownHandlers(client, logger, () => closeHealthServer(server));

		logger.info('Logging in');
		await client.login(config.discordToken);
		logger.info('Logged in');
	} catch (error) {
		logger.fatal(error);
		if (healthServer) {
			try {
				await closeHealthServer(healthServer);
			} catch (closeError) {
				logger.error(closeError, 'Failed to close the health server');
			}
		}
		await client?.destroy();
		process.exit(1);
	}
};

void main().catch((error) => {
	logger.fatal(error);
	process.exit(1);
});
