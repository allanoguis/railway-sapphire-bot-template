import 'dotenv/config';
import { BucketScope, container, LogLevel, SapphireClient } from '@sapphire/framework';
import { Logger } from '@sapphire/plugin-logger';
import '@sapphire/plugin-logger/register';
import { GatewayIntentBits } from 'discord.js';
import { Pool } from 'pg';
import type { RequestListener, Server } from 'node:http';
import { loadConfig } from './config';
import { organizedCrimeAlertScheduler } from './features/torn/faction-oc-alerts';
import { closeHealthServer, createHealthServer, listenHealthServer } from './lib/health';
import { PostgresStorage } from './lib/postgres-storage';
import { setBotPresence } from './lib/presence';
import { registerShutdownHandlers } from './lib/shutdown';
import { WebAuth } from './web/auth';
import { createDashboardServer } from './web/server';
import { WebsiteStorage } from './web/storage';

const logger = new Logger({ level: LogLevel.Debug });
let client: SapphireClient | undefined;
let healthServer: Server | undefined;
let storage: PostgresStorage | undefined;
let sessionCleanup: ReturnType<typeof setInterval> | undefined;

const main = async () => {
	try {
		const config = loadConfig();
		container.storage = null;
		container.tornFactionChannelId = config.tornFactionChannelId;
		container.tornOcAlertChannelId = config.tornOcAlertChannelId;
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
		let websiteHandler: RequestListener | undefined;
		const serveWhenReady: RequestListener = (request, response) => {
			if (websiteHandler) websiteHandler(request, response);
			else {
				response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
				response.end(JSON.stringify({ error: 'Website is starting. Please try again later.' }));
			}
		};
		const server = createHealthServer(() => client?.isReady() ?? false, config.website ? serveWhenReady : undefined);
		healthServer = server;
		server.on('error', (error) => {
			if (client) setBotPresence(client, true);
			logger.error(error, 'Health server error');
		});
		await listenHealthServer(server, config.healthPort ?? 3000);
		registerShutdownHandlers(client, logger, async () => {
			const errors: unknown[] = [];
			if (sessionCleanup) clearInterval(sessionCleanup);
			organizedCrimeAlertScheduler.stopAll();
			try {
				await closeHealthServer(server);
			} catch (error) {
				errors.push(error);
			}
			try {
				await storage?.close();
			} catch (error) {
				errors.push(error);
			}
			if (errors.length > 0) throw new AggregateError(errors, 'Failed to close bot services cleanly.');
		});

		if (config.databaseUrl) {
			const pool = new Pool({ connectionString: config.databaseUrl });
			pool.on('error', (error) => {
				if (client) setBotPresence(client, true);
				logger.error(error, 'Unexpected PostgreSQL pool error');
			});
			storage = new PostgresStorage(pool);
			const legacySettingsRemain = await storage.initialize();
			container.storage = storage;
			if (legacySettingsRemain) {
				logger.warn('Legacy bot_settings table retained because it contains data outside per-user Torn credentials');
			}
			logger.info('PostgreSQL storage initialized');
			if (config.website) {
				const websiteStorage = new WebsiteStorage(pool);
				await websiteStorage.initialize();
				const auth = new WebAuth({ enabled: true, ...config.website }, websiteStorage);
				websiteHandler = createDashboardServer({
					auth,
					websiteStorage,
					storage,
					client,
					origin: config.website.origin,
					factionChannelId: config.tornFactionChannelId,
					logError: (message) => logger.error(message)
				});
				const cleanupSessions = () => {
					void websiteStorage.cleanupExpiredSessions().catch(() => logger.error('Failed to clean up expired website sessions.'));
				};
				sessionCleanup = setInterval(cleanupSessions, 60 * 60 * 1000);
				sessionCleanup.unref();
				logger.info('Website dashboard initialized');
			}
		} else {
			logger.warn('DATABASE_URL is not configured; persistent storage is disabled.');
		}

		logger.info('Logging in');
		await client.login(config.discordToken);
		logger.info('Logged in');
	} catch (error) {
		if (client) setBotPresence(client, true);
		logger.fatal(error);
		if (healthServer || storage) {
			const errors: unknown[] = [];
			try {
				if (healthServer) await closeHealthServer(healthServer);
			} catch (healthCloseError) {
				errors.push(healthCloseError);
			}
			try {
				await storage?.close();
			} catch (storageCloseError) {
				errors.push(storageCloseError);
			}
			for (const closeError of errors) logger.error(closeError, 'Failed to close a bot service');
		}
		await client?.destroy();
		process.exit(1);
	}
};

void main().catch((error) => {
	if (client) setBotPresence(client, true);
	logger.fatal(error);
	process.exit(1);
});
