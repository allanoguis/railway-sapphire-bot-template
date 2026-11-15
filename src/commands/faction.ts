import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import type { ChatInputCommandInteraction } from 'discord.js';
import { buildTornFactionEmbeds } from '../features/torn/faction-embed';
import { buildTornProfileEmbed } from '../features/torn/profile';
import { getTornFactionOverview, getTornProfile, TornApiError } from '../features/torn/service';
import type { PostgresStorage } from '../lib/postgres-storage';

interface FactionCommandContext {
	storage: PostgresStorage | null;
	tornFactionChannelId: string | undefined;
	logger: {
		error(error: unknown, message: string): void;
	};
}

export async function runTornFactionCommand(interaction: ChatInputCommandInteraction, context: FactionCommandContext) {
	const { tornFactionChannelId } = context;
	if (!tornFactionChannelId) {
		return interaction.reply({
			content: 'The faction command is not configured by the bot administrator.',
			flags: 'Ephemeral'
		});
	}

	if (!interaction.inGuild() || interaction.channelId !== tornFactionChannelId) {
		return interaction.reply({
			content: 'Use `/torn faction` in the configured faction channel.',
			flags: 'Ephemeral'
		});
	}

	const { channel } = interaction;
	if (!channel?.isTextBased() || !('send' in channel)) {
		return interaction.reply({
			content: 'The configured faction channel cannot receive messages.',
			flags: 'Ephemeral'
		});
	}

	await interaction.deferReply({ flags: 'Ephemeral' });
	let postedMessages = 0;
	try {
		const overview = await getTornFactionOverview(context.storage, interaction.user.id);
		for (const embed of buildTornFactionEmbeds(overview)) {
			await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
			postedMessages += 1;
		}

		return interaction.editReply(`Posted the faction details and full roster in this channel (${postedMessages} messages).`);
	} catch (error) {
		if (error instanceof TornApiError) return interaction.editReply(error.message);

		context.logger.error(error, 'Failed to post Torn faction information');
		return interaction.editReply(
			postedMessages > 0
				? 'Could not finish posting the faction information. Some messages may already have been sent.'
				: 'Could not post the faction information right now. Please try again later.'
		);
	}
}

@ApplyOptions<Command.Options>({
	name: 'torn',
	description: 'View Torn profiles or post your faction information.'
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
						.setDescription('View your profile or another player with your paired Torn API key.')
						.addStringOption((option) =>
							option.setName('player-id').setDescription('Torn player ID; omit to view your paired profile.').setRequired(false)
						)
				)
				.addSubcommand((subcommand) =>
					subcommand.setName('faction').setDescription('Post your faction details and roster in the permitted channel.')
				)
		);
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (interaction.options.getSubcommand() === 'faction') {
			return runTornFactionCommand(interaction, this.container);
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
		try {
			const result = await getTornProfile(this.container.storage, interaction.user.id, playerId);
			return interaction.editReply({ embeds: [buildTornProfileEmbed(result.profile, result.isLinkedProfile)] });
		} catch (error) {
			if (error instanceof TornApiError) return interaction.editReply(error.message);

			this.container.logger.error(error, 'Failed to fetch a Torn profile');
			return interaction.editReply('Could not fetch the Torn profile right now. Please try again later.');
		}
	}
}
