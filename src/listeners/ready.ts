import { Events, Listener } from '@sapphire/framework';
import type { Client } from 'discord.js';
import { setBotPresence } from '../lib/presence';

export class ReadyListener extends Listener<typeof Events.ClientReady> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.ClientReady, once: true });
	}

	public override run(client: Client<true>) {
		setBotPresence(client, false);
		this.container.logger.info(`Ready as ${client.user.username}`);
	}
}
