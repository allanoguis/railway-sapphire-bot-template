import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, PermissionFlagsBits, type ButtonInteraction, type Message } from 'discord.js';
import { collectMessagesForClear } from '../features/core/clear';

const CONFIRMATION_TIMEOUT_MS = 60_000;
const MAX_DELETE_BATCH_SIZE = 100;

interface ClearChannel {
	messages: {
		fetch(options: { before?: string; limit: number }): Promise<{ values(): IterableIterator<Message> }>;
	};
	bulkDelete(messageIds: readonly string[], filterOld?: boolean): Promise<{ size: number }>;
}

const clearSubcommands = [
	{ name: 'user', description: "Delete a selected user's recent messages by amount." },
	{ name: 'amount', description: 'Delete a number of the latest messages from any author.' },
	{ name: 'all', description: 'Delete all removable recent messages in this channel.' }
] as const;

function isClearChannel(channel: unknown): channel is ClearChannel {
	if (typeof channel !== 'object' || channel === null || !('messages' in channel) || !('bulkDelete' in channel)) return false;
	const { messages, bulkDelete } = channel;
	return (
		typeof messages === 'object' &&
		messages !== null &&
		'fetch' in messages &&
		typeof messages.fetch === 'function' &&
		typeof bulkDelete === 'function'
	);
}

@ApplyOptions<Command.Options>({
	name: 'clear',
	description: 'Remove recent messages from this channel.',
	preconditions: ['GuildOnly'],
	requiredUserPermissions: PermissionFlagsBits.ManageMessages,
	requiredClientPermissions: PermissionFlagsBits.ManageMessages
})
export class ClearCommand extends Command {
	public readonly helpSubcommands = clearSubcommands;

	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
				.addSubcommand((subcommand) =>
					subcommand
						.setName('user')
						.setDescription(clearSubcommands[0].description)
						.addUserOption((option) => option.setName('user').setDescription('User whose messages should be removed.').setRequired(true))
						.addIntegerOption((option) =>
							option
								.setName('amount')
								.setDescription('Maximum number of recent messages from this user to remove.')
								.setRequired(true)
								.setMinValue(1)
								.setMaxValue(MAX_DELETE_BATCH_SIZE)
						)
				)
				.addSubcommand((subcommand) =>
					subcommand
						.setName('amount')
						.setDescription(clearSubcommands[1].description)
						.addIntegerOption((option) =>
							option
								.setName('amount')
								.setDescription('Number of latest messages to remove.')
								.setRequired(true)
								.setMinValue(1)
								.setMaxValue(MAX_DELETE_BATCH_SIZE)
						)
				)
				.addSubcommand((subcommand) => subcommand.setName('all').setDescription(clearSubcommands[2].description))
		);
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { channel } = interaction;
		if (!isClearChannel(channel)) {
			return interaction.reply({
				content: 'This channel does not support message cleanup.',
				flags: 'Ephemeral'
			});
		}

		const subcommand = interaction.options.getSubcommand();
		if (subcommand !== 'user' && subcommand !== 'amount' && subcommand !== 'all') {
			return interaction.reply({ content: 'Choose a valid message cleanup mode.', flags: 'Ephemeral' });
		}
		const amount = subcommand === 'all' ? undefined : interaction.options.getInteger('amount', true);
		const targetUser = subcommand === 'user' ? interaction.options.getUser('user', true) : undefined;
		await interaction.deferReply({ flags: 'Ephemeral' });
		const collected = await collectMessagesForClear(
			async (before) => {
				const page = await channel.messages.fetch({ limit: MAX_DELETE_BATCH_SIZE, ...(before ? { before } : {}) });
				return [...page.values()];
			},
			subcommand,
			amount ?? undefined,
			targetUser?.id
		);

		if (collected.messages.length === 0) {
			return interaction.editReply(appendAgeLimitNotice('No removable recent messages were found.', collected.olderMessagesSkipped));
		}

		const confirmation = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId('clear:confirm').setLabel('Confirm').setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId('clear:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
		);
		const targetDescription = targetUser ? ` from @${targetUser.username}` : '';
		const description =
			subcommand === 'all'
				? `Delete all ${collected.messages.length} removable recent messages in this channel?`
				: `Delete ${collected.messages.length} removable recent message${collected.messages.length === 1 ? '' : 's'}${targetDescription}?`;
		const prompt = await interaction.editReply({
			content: appendAgeLimitNotice(`${description} This cannot be undone.`, collected.olderMessagesSkipped),
			components: [confirmation]
		});

		const button = await this.waitForConfirmation(prompt, interaction.user.id);
		if (!button) {
			return interaction.editReply({ content: 'Confirmation expired. No messages were deleted.', components: [] });
		}

		if (button.customId === 'clear:cancel') {
			return button.update({ content: 'Clear cancelled. No messages were deleted.', components: [] });
		}

		await button.update({ content: 'Deleting messages...', components: [] });
		let deletedCount = 0;
		let deletionFailed = false;
		for (let index = 0; index < collected.messages.length; index += MAX_DELETE_BATCH_SIZE) {
			const batch = collected.messages.slice(index, index + MAX_DELETE_BATCH_SIZE);
			try {
				const deleted = await channel.bulkDelete(
					batch.map((message) => message.id),
					true
				);
				deletedCount += deleted.size;
			} catch (error) {
				this.container.logger.error(error, 'Failed to delete channel messages');
				deletionFailed = true;
				break;
			}
		}

		let result = deletionFailed
			? `Could not finish deleting messages. Deleted ${deletedCount} of ${collected.messages.length} selected messages.`
			: `Deleted ${deletedCount} of ${collected.messages.length} selected messages.`;
		if (deletedCount < collected.messages.length && !deletionFailed) {
			result += ' Some selected messages could not be deleted.';
		}
		result = appendAgeLimitNotice(result, collected.olderMessagesSkipped);
		return interaction.editReply(result);
	}

	private waitForConfirmation(message: Message, userId: string): Promise<ButtonInteraction | undefined> {
		return new Promise((resolve) => {
			const collector = message.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: CONFIRMATION_TIMEOUT_MS,
				filter: (interaction) => interaction.user.id === userId
			});
			collector.on('collect', (interaction) => {
				collector.stop('selected');
				resolve(interaction);
			});
			collector.on('end', (_collected, reason) => {
				if (reason !== 'selected') resolve(undefined);
			});
		});
	}
}

function appendAgeLimitNotice(message: string, olderMessagesSkipped: boolean): string {
	return olderMessagesSkipped ? `${message}\nMessages older than 14 days were left untouched.` : message;
}
