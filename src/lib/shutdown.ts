import type { ILogger, SapphireClient } from '@sapphire/framework';

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

type ShutdownClient = Pick<SapphireClient, 'destroy'>;
type ShutdownLogger = Pick<ILogger, 'error' | 'info'>;

export function createShutdownHandler(
	client: ShutdownClient,
	logger: ShutdownLogger,
	setExitCode: (code: number) => void = (code) => {
		process.exitCode = code;
	},
	cleanup?: () => Promise<void>
): (signal: ShutdownSignal) => Promise<void> {
	let shutdownPromise: Promise<void> | undefined;

	return (signal) => {
		if (shutdownPromise) return shutdownPromise;

		shutdownPromise = (async () => {
			logger.info(`Received ${signal}; shutting down.`);
			let failed = false;
			try {
				await cleanup?.();
			} catch (error) {
				logger.error(error, 'Failed to close auxiliary services cleanly');
				failed = true;
			}
			try {
				await client.destroy();
			} catch (error) {
				logger.error(error, 'Failed to shut down the Discord client cleanly');
				failed = true;
			}
			setExitCode(failed ? 1 : 0);
		})();

		return shutdownPromise;
	};
}

export function registerShutdownHandlers(client: ShutdownClient, logger: ShutdownLogger, cleanup?: () => Promise<void>): void {
	const shutdown = createShutdownHandler(client, logger, undefined, cleanup);
	process.on('SIGINT', () => {
		void shutdown('SIGINT');
	});
	process.on('SIGTERM', () => {
		void shutdown('SIGTERM');
	});
}
