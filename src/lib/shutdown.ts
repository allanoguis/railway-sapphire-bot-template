import type { ILogger, SapphireClient } from '@sapphire/framework';

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

type ShutdownClient = Pick<SapphireClient, 'destroy'>;
type ShutdownLogger = Pick<ILogger, 'error' | 'info'>;

export function createShutdownHandler(
	client: ShutdownClient,
	logger: ShutdownLogger,
	setExitCode: (code: number) => void = (code) => {
		process.exitCode = code;
	}
): (signal: ShutdownSignal) => Promise<void> {
	let shutdownPromise: Promise<void> | undefined;

	return (signal) => {
		if (shutdownPromise) return shutdownPromise;

		shutdownPromise = (async () => {
			logger.info(`Received ${signal}; shutting down.`);
			try {
				await client.destroy();
				setExitCode(0);
			} catch (error) {
				logger.error(error, 'Failed to shut down the Discord client cleanly');
				setExitCode(1);
			}
		})();

		return shutdownPromise;
	};
}

export function registerShutdownHandlers(client: ShutdownClient, logger: ShutdownLogger): void {
	const shutdown = createShutdownHandler(client, logger);
	process.on('SIGINT', () => {
		void shutdown('SIGINT');
	});
	process.on('SIGTERM', () => {
		void shutdown('SIGTERM');
	});
}
