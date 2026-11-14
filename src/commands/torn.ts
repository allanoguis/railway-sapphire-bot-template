import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { buildTornProfileEmbed } from '../features/torn/presentation';
import { getTornProfile, hasTornLinkingConfiguration, unlinkTornAccount } from '../features/torn/service';

@ApplyOptions<Command.Options>({
	name: 'torn',
	description: 'View individual Torn player profile data.'
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
						.setDescription('View your linked profile or a public player profile.')
						.addStringOption((option) =>
							option.setName('player-id').setDescription('Torn player ID; omit to view your linked profile.').setRequired(false)
						)
				)
				.addSubcommand((subcommand) => subcommand.setName('link').setDescription('Securely link your Torn API key.'))
				.addSubcommand((subcommand) => subcommand.setName('unlink').setDescription('Delete your stored Torn API key.'))
		);
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === 'link') {
			const { storage } = this.container;
			if (!storage || !hasTornLinkingConfiguration()) {
				return interaction.reply({
					content: 'Torn account linking is unavailable. The bot needs PostgreSQL and a valid TORN_ENCRYPTION_KEY.',
					flags: 'Ephemeral'
				});
			}

			const embed = new EmbedBuilder()
				.setColor(0x5865f2)
				.setTitle('Torn API key use and storage')
				.setDescription('Review this disclosure before entering your API key. Never provide your Torn password.')
				.addFields(
					{
						name: 'Data storage',
						value: 'Your API key is stored encrypted in this bot’s PostgreSQL database until you unlink it.',
						inline: false
					},
					{
						name: 'Data sharing',
						value: 'The key is not shared. Bot operators administer the service; profile replies are private to you.',
						inline: false
					},
					{
						name: 'Purpose of use',
						value: 'The key is used to retrieve your own profile when you request `/torn profile`.',
						inline: false
					},
					{
						name: 'Key storage & sharing',
						value: 'The key is encrypted with AES-256-GCM at rest and can be deleted at any time with `/torn unlink`.',
						inline: false
					},
					{
						name: 'Key access level',
						value: 'The bot requests `basic`, `profile`, `bars`, `cooldowns`, and `battlestats`; Torn may require a key with permission for each selection.',
						inline: false
					}
				);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`torn:link:${interaction.user.id}`).setLabel('Continue to link').setStyle(ButtonStyle.Primary)
			);
			return interaction.reply({ embeds: [embed], components: [row], flags: 'Ephemeral' });
		}

		if (subcommand === 'unlink') {
			const { storage } = this.container;
			if (!storage) {
				return interaction.reply({
					content: 'Torn account linking is unavailable because PostgreSQL is not configured.',
					flags: 'Ephemeral'
				});
			}

			await interaction.deferReply({ flags: 'Ephemeral' });
			const deleted = await unlinkTornAccount(storage, interaction.user.id);
			return interaction.editReply({
				content: deleted ? 'Your stored Torn API key has been deleted.' : 'You do not have a linked Torn account.'
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
