import { Events, Listener } from '@sapphire/framework';
import type { ListenerErrorPayload } from '@sapphire/framework';
import { setBotPresence } from '../lib/presence';

export class ListenerErrorListener extends Listener<typeof Events.ListenerError> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.ListenerError });
	}

	public override run(error: unknown, { piece }: ListenerErrorPayload) {
		setBotPresence(this.container.client, true);
		this.container.logger.error(error, `The ${piece.name} listener failed`);
	}
}
