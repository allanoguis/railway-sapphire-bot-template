import { Events, Listener } from '@sapphire/framework';
import type { Client } from 'discord.js';

export class ReadyListener extends Listener<typeof Events.ClientReady> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.ClientReady, once: true });
	}

	public override run(client: Client<true>) {
		this.container.logger.info(`Ready as ${client.user.username}`);
	}
}
