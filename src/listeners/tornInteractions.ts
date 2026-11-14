import { Events, Listener } from '@sapphire/framework';
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type Interaction, type ModalActionRowComponentBuilder } from 'discord.js';
import { linkTornAccount } from '../features/torn/service';

export class TornInteractionsListener extends Listener<typeof Events.InteractionCreate> {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: Events.InteractionCreate });
	}

	public override async run(interaction: Interaction) {
		if (interaction.isButton() && interaction.customId.startsWith('torn:link:')) {
			const ownerId = interaction.customId.slice('torn:link:'.length);
			if (interaction.user.id !== ownerId) {
				return interaction.reply({ content: 'This Torn linking request belongs to another user.', flags: 'Ephemeral' });
			}

			const keyInput = new TextInputBuilder()
				.setCustomId('api-key')
				.setLabel('Torn API key (never your Torn password)')
				.setStyle(TextInputStyle.Short)
				.setMinLength(16)
				.setMaxLength(16)
				.setRequired(true);
			const modal = new ModalBuilder()
				.setCustomId(`torn:link-submit:${ownerId}`)
				.setTitle('Link Torn account')
				.addComponents(new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(keyInput));
			return interaction.showModal(modal);
		}

		if (!interaction.isModalSubmit() || !interaction.customId.startsWith('torn:link-submit:')) return;
		const ownerId = interaction.customId.slice('torn:link-submit:'.length);
		if (interaction.user.id !== ownerId) {
			return interaction.reply({ content: 'This Torn linking request belongs to another user.', flags: 'Ephemeral' });
		}

		const { storage } = this.container;
		if (!storage) {
			return interaction.reply({
				content: 'Torn account linking is unavailable because PostgreSQL is not configured.',
				flags: 'Ephemeral'
			});
		}

		await interaction.deferReply({ flags: 'Ephemeral' });
		try {
			const linked = await linkTornAccount(storage, ownerId, interaction.fields.getTextInputValue('api-key').trim());
			await interaction.editReply(
				`Linked Torn account **${linked.name ?? 'Unknown'}** (ID ${
					linked.playerId
				}). Use \`/torn profile\` to view your profile, or \`/torn unlink\` to delete the stored key.`
			);
		} catch (error) {
			this.container.logger.error(error, 'Failed to link a Torn account');
			await interaction.editReply(error instanceof Error ? error.message : 'Could not link that Torn API key.');
		}

		return undefined;
	}
}
