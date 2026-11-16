import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import { TornApiError, verifyTornAccount } from '../features/torn/service';

@ApplyOptions<Command.Options>({
	name: 'verify',
	description: 'Verify that your paired Torn API key is still valid.'
})
export class VerifyCommand extends Command {
	public readonly helpCategory = 'torn' as const;

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
		try {
			const pairedAccount = await verifyTornAccount(storage, interaction.user.id);
			if (!pairedAccount) {
				return interaction.editReply('You have not paired a Torn API key yet. Use `/pair` to pair your account.');
			}

			return interaction.editReply(
				`You are already verified. Your Torn account **${pairedAccount.name ?? 'Unknown'}** (ID ${
					pairedAccount.playerId
				}) is paired and the API key is valid.`
			);
		} catch (error) {
			if (error instanceof TornApiError) {
				return interaction.editReply(`Verification failed: ${error.message}`);
			}

			this.container.logger.error(error, 'Failed to verify a paired Torn account');
			return interaction.editReply('Could not verify your Torn account right now. Please try again later.');
		}
	}
}
