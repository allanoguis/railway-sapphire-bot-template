import { Events, Listener } from '@sapphire/framework';
import type { Client } from 'discord.js';
import { organizedCrimeAlertScheduler, restoreOrganizedCrimeAlert } from '../features/torn/faction-oc-alerts';
import { setBotPresence } from '../lib/presence';

export class ReadyListener extends Listener<typeof Events.ClientReady> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.ClientReady, once: true });
	}

	public override run(client: Client<true>) {
		setBotPresence(client, false);
		this.container.logger.info(`Ready as ${client.user.username}`);
		const { storage, tornOcAlertChannelId, logger } = this.container;
		if (!storage || !tornOcAlertChannelId) {
			logger.warn('Organized-crime alerts cannot resume without PostgreSQL storage and an alert channel.');
			return;
		}
		const restore = async () => {
			const restored = await restoreOrganizedCrimeAlert(client, storage, tornOcAlertChannelId, logger);
			if (restored) logger.info('Organized-crime alert updates resumed.');
		};
		void restore().catch((error: unknown) => {
			logger.error(error, 'Failed to restore the organized-crime alert');
			if (!organizedCrimeAlertScheduler.has(tornOcAlertChannelId)) {
				organizedCrimeAlertScheduler.retryRestoration(tornOcAlertChannelId, restore, logger);
			}
		});
	}
}
