import { Events, Listener } from '@sapphire/framework';
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type Interaction, type ModalActionRowComponentBuilder } from 'discord.js';
import { pairTornAccount, TornApiError } from '../features/torn/service';
import { requireTornFeature } from '../features/torn/switches';

export class TornInteractionsListener extends Listener<typeof Events.InteractionCreate> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.InteractionCreate });
	}

	public override async run(interaction: Interaction) {
		if (interaction.isButton() && interaction.customId.startsWith('torn:pair:')) {
			const ownerId = interaction.customId.slice('torn:pair:'.length);
			if (interaction.user.id !== ownerId) {
				return interaction.reply({ content: 'This Torn pairing request belongs to another user.', flags: 'Ephemeral' });
			}

			if (!(await requireTornFeature('pair', interaction, this.container.storage, this.container.logger))) return;
			const keyInput = new TextInputBuilder()
				.setCustomId('api-key')
				.setLabel('Torn API key (never your Torn password)')
				.setStyle(TextInputStyle.Short)
				.setMinLength(16)
				.setMaxLength(16)
				.setRequired(true);
			const modal = new ModalBuilder()
				.setCustomId(`torn:pair-submit:${ownerId}`)
				.setTitle('Pair Torn account')
				.addComponents(new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(keyInput));
			return interaction.showModal(modal);
		}

		if (!interaction.isModalSubmit() || !interaction.customId.startsWith('torn:pair-submit:')) return;
		const ownerId = interaction.customId.slice('torn:pair-submit:'.length);
		if (interaction.user.id !== ownerId) {
			return interaction.reply({ content: 'This Torn pairing request belongs to another user.', flags: 'Ephemeral' });
		}

		if (!(await requireTornFeature('pair', interaction, this.container.storage, this.container.logger))) return;
		const { storage } = this.container;
		if (!storage) {
			return interaction.reply({
				content: 'Torn account pairing is not configured by the bot administrator. Please contact them for help.',
				flags: 'Ephemeral'
			});
		}

		await interaction.deferReply({ flags: 'Ephemeral' });
		try {
			const paired = await pairTornAccount(storage, ownerId, interaction.fields.getTextInputValue('api-key').trim());
			await interaction.editReply(
				`Paired Torn account **${paired.name ?? 'Unknown'}** (ID ${
					paired.playerId
				}). Use \`/verify\` to confirm your key is still valid, \`/torn profile\` to view your profile, or \`/unpair\` to delete the stored key.`
			);
		} catch (error) {
			if (error instanceof TornApiError) {
				await interaction.editReply(error.message);
				return undefined;
			}

			this.container.logger.error(error, 'Failed to pair a Torn account');
			await interaction.editReply('Could not pair that Torn API key right now. Please try again later.');
		}

		return undefined;
	}
}
