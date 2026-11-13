import { ChatInputCommand, Command } from '@sapphire/framework';
import { ApplyOptions } from '@sapphire/decorators';
import { PermissionFlagsBits } from 'discord.js';
import { setDebugStatus } from '../lib/presence';

@ApplyOptions<Command.Options>({
	name: 'debug',
	description: 'Set the bot status to under construction or restore its normal status.',
	requiredUserPermissions: PermissionFlagsBits.ManageMessages
})
export class DebugCommand extends Command {
	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) =>
					option
						.setName('action')
						.setDescription('Enable or disable the construction status.')
						.setRequired(true)
						.addChoices({ name: 'enable', value: 'enable' }, { name: 'disable', value: 'disable' })
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const enabled = interaction.options.getString('action', true) === 'enable';
		setDebugStatus(this.container.client, enabled);

		return interaction.reply({
			content: enabled ? 'Debug status enabled: Bot under construction.' : 'Debug status disabled; normal status restored.',
			flags: 'Ephemeral'
		});
	}
}
