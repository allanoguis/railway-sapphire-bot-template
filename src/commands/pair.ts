import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { hasTornPairingConfiguration } from '../features/torn/service';

@ApplyOptions<Command.Options>({
	name: 'pair',
	description: 'Pair your Torn account with your Discord account.'
})
export class PairCommand extends Command {
	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		this.container.logger.debug('Handling /pair command');
		await interaction.deferReply({ flags: 'Ephemeral' });
		try {
			const { storage } = this.container;
			if (!storage || !hasTornPairingConfiguration()) {
				return interaction.editReply('Torn account pairing is not configured by the bot administrator. Please contact them for help.');
			}

			const embed = new EmbedBuilder()
				.setColor(0x5865f2)
				.setTitle('Torn API key use and storage')
				.setDescription('Review this disclosure before entering your API key. Never provide your Torn password.')
				.addFields(
					{
						name: 'Data storage',
						value: 'Your API key is stored encrypted in this bot’s PostgreSQL database until you use `/unpair`.',
						inline: false
					},
					{
						name: 'Data sharing',
						value: 'The key is not shared. Bot operators administer the service; profile and verification replies are private to you.',
						inline: false
					},
					{
						name: 'Purpose of use',
						value: 'The key retrieves your own profile with `/torn profile` and is revalidated with `/verify`.',
						inline: false
					},
					{
						name: 'Key storage & deletion',
						value: 'The key is encrypted with AES-256-GCM at rest and can be deleted at any time with `/unpair`.',
						inline: false
					},
					{
						name: 'Key access level',
						value: 'Pairing and verification request `basic`; profile requests may also use `profile`, `bars`, `cooldowns`, and `battlestats`.',
						inline: false
					}
				);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`torn:pair:${interaction.user.id}`).setLabel('Continue to pair').setStyle(ButtonStyle.Primary)
			);
			return interaction.editReply({ embeds: [embed], components: [row] });
		} catch (error) {
			this.container.logger.error(error, 'Failed to start Torn account pairing');
			return interaction.editReply('Could not start Torn account pairing. Please try again later.');
		}
	}
}
