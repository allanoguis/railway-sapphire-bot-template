import { Events, Listener } from '@sapphire/framework';
import type { ChatInputCommandDeniedPayload, UserError } from '@sapphire/framework';

export class ChatInputCommandDeniedListener extends Listener<typeof Events.ChatInputCommandDenied> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.ChatInputCommandDenied });
	}

	public override run(error: UserError, { interaction, command }: ChatInputCommandDeniedPayload) {
		this.container.logger.warn(error, `The /${command.name} command was denied`);

		const response = { content: error.message, flags: 'Ephemeral' } as const;
		return interaction.deferred || interaction.replied ? interaction.followUp(response) : interaction.reply(response);
	}
}
