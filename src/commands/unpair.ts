import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import { unpairTornAccount } from '../features/torn/service';

@ApplyOptions<Command.Options>({
	name: 'unpair',
	description: 'Remove your paired Torn API key from the bot.'
})
export class UnpairCommand extends Command {
	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { storage } = this.container;
		if (!storage) {
			return interaction.reply({
				content: 'Torn account pairing is not configured by the bot administrator. Please contact them for help.',
				flags: 'Ephemeral'
			});
		}

		await interaction.deferReply({ flags: 'Ephemeral' });
		const deleted = await unpairTornAccount(storage, interaction.user.id);
		return interaction.editReply(deleted ? 'Your stored Torn API key has been deleted.' : 'You do not have a paired Torn account.');
	}
}
