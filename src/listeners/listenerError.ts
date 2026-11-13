import { Events, Listener } from '@sapphire/framework';
import type { ListenerErrorPayload } from '@sapphire/framework';

export class ListenerErrorListener extends Listener<typeof Events.ListenerError> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.ListenerError });
	}

	public override run(error: unknown, { piece }: ListenerErrorPayload) {
		this.container.logger.error(error, `The ${piece.name} listener failed`);
	}
}
