import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import { buildTornProfileEmbed } from '../features/torn/presentation';
import { getTornProfile, unlinkTornAccount } from '../features/torn/service';

@ApplyOptions<Command.Options>({
	name: 'torn',
	description: 'View Torn player profiles or remove your paired account.'
})
export class TornCommand extends Command {
	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((subcommand) =>
					subcommand
						.setName('profile')
						.setDescription('View your paired profile or a public player profile.')
						.addStringOption((option) =>
							option.setName('player-id').setDescription('Torn player ID; omit to view your paired profile.').setRequired(false)
						)
				)
				.addSubcommand((subcommand) => subcommand.setName('unlink').setDescription('Delete your stored Torn API key.'))
		);
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === 'unlink') {
			const { storage } = this.container;
			if (!storage) {
				return interaction.reply({
					content: 'Torn account pairing is not configured by the bot administrator. Please contact them for help.',
					flags: 'Ephemeral'
				});
			}

			await interaction.deferReply({ flags: 'Ephemeral' });
			const deleted = await unlinkTornAccount(storage, interaction.user.id);
			return interaction.editReply({
				content: deleted ? 'Your stored Torn API key has been deleted.' : 'You do not have a paired Torn account.'
			});
		}

		const playerIdText = interaction.options.getString('player-id');
		let playerId: number | undefined;
		if (playerIdText !== null) {
			if (!/^\d{1,15}$/.test(playerIdText) || !Number.isSafeInteger(Number(playerIdText)) || Number(playerIdText) <= 0) {
				return interaction.reply({
					content: 'Enter a valid positive Torn player ID.',
					flags: 'Ephemeral'
				});
			}
			playerId = Number(playerIdText);
		}

		await interaction.deferReply({ flags: 'Ephemeral' });
		const result = await getTornProfile(this.container.storage, interaction.user.id, playerId);
		return interaction.editReply({ embeds: [buildTornProfileEmbed(result.profile, result.isLinkedProfile)] });
	}
}
