import { Events, Listener } from '@sapphire/framework';
import type { ChatInputCommandErrorPayload } from '@sapphire/framework';
import { reportCommandError } from '../lib/command-error';

export class ChatInputCommandErrorListener extends Listener<typeof Events.ChatInputCommandError> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.ChatInputCommandError });
	}

	public override run(error: unknown, { interaction, command }: ChatInputCommandErrorPayload) {
		return reportCommandError(interaction, command.name, error, this.container.logger);
	}
}
