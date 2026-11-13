import { Events, Listener } from '@sapphire/framework';
import { ApplicationCommandType } from 'discord.js';

export class ApplicationCommandRegistriesRegisteredListener extends Listener<typeof Events.ApplicationCommandRegistriesRegistered> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.ApplicationCommandRegistriesRegistered, once: true });
	}

	public async run() {
		const { application } = this.container.client;
		if (!application) {
			this.container.logger.warn('Cannot remove the old /debug-status command because the application is unavailable.');
			return;
		}

		const commands = await application.commands.fetch();
		const previousCommand = commands.find((command) => command.name === 'debug-status' && command.type === ApplicationCommandType.ChatInput);

		if (!previousCommand) return;

		await previousCommand.delete();
		this.container.logger.info('Removed the old /debug-status command');
	}
}
