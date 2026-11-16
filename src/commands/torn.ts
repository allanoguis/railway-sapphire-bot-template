import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import type { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { buildTornFactionInfoEmbeds, buildTornFactionMemberEmbeds } from '../features/torn/faction';
import {
	buildTornFactionOrganizedCrimeEmbeds,
	buildTornFactionOrganizedCrimeSummaryEmbed,
	getTornFactionOrganizedCrimes
} from '../features/torn/faction-oc';
import { buildTornFactionUnregisteredEmbeds, getTornFactionUnregisteredReport } from '../features/torn/faction-unregistered';
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

const tornSubcommands = {
	profile: {
		name: 'profile',
		description: 'View your profile or another player with your paired Torn API key.'
	},
	factionInfo: {
		name: 'faction info',
		description: 'Post faction information in the #bot-commands channel.'
	},
	factionMembers: {
		name: 'faction members',
		description: 'Post the faction roster in the #bot-commands channel.'
	},
	factionUnregistered: {
		name: 'faction unregistered',
		description: 'Post faction members without a Torn API account paired with the bot.'
	},
	factionOrganizedCrime: {
		name: 'faction organized-crime',
		description: 'Post crimes with player and item names, slot status, pass rates, and category counts.'
	}
} as const;

export async function runTornFactionCommand(
	interaction: ChatInputCommandInteraction,
	context: FactionCommandContext,
	view: 'info' | 'members' | 'unregistered' | 'organized-crime'
) {
	const { tornFactionChannelId } = context;
	if (!tornFactionChannelId) {
		return interaction.reply({
			content: 'The faction command is not configured by the bot administrator.',
			flags: 'Ephemeral'
		});
	}

	if (!interaction.inGuild() || interaction.channelId !== tornFactionChannelId) {
		return interaction.reply({
			content:
				'Use `/torn faction info`, `/torn faction members`, `/torn faction unregistered`, or `/torn faction organized-crime` in the configured channel.',
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
		let embeds: EmbedBuilder[];
		let summaryEmbed: EmbedBuilder | undefined;
		if (view === 'organized-crime') {
			const report = await getTornFactionOrganizedCrimes(context.storage, interaction.user.id);
			embeds = buildTornFactionOrganizedCrimeEmbeds(report);
			summaryEmbed = buildTornFactionOrganizedCrimeSummaryEmbed(report);
		} else if (view === 'unregistered') {
			const report = await getTornFactionUnregisteredReport(context.storage, interaction.user.id);
			embeds = buildTornFactionUnregisteredEmbeds(report);
		} else {
			const overview = await getTornFactionOverview(context.storage, interaction.user.id);
			embeds = view === 'info' ? buildTornFactionInfoEmbeds(overview) : buildTornFactionMemberEmbeds(overview);
		}

		for (const embed of embeds) {
			await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
			postedMessages += 1;
		}
		if (summaryEmbed !== undefined) {
			await channel.send({ embeds: [summaryEmbed], allowedMentions: { parse: [] } });
			postedMessages += 1;
		}

		let content: string;
		if (view === 'info') {
			content = `Posted faction information in this channel (${postedMessages} messages).`;
		} else if (view === 'members') {
			content = `Posted the faction roster in this channel (${postedMessages} messages).`;
		} else if (view === 'organized-crime') {
			content = `Posted the active organized crimes and summary in this channel (${postedMessages} messages).`;
		} else {
			content = `Posted the unregistered faction member list in this channel (${postedMessages} messages).`;
		}
		return interaction.editReply(content);
	} catch (error) {
		if (error instanceof TornApiError) return interaction.editReply(error.message);

		context.logger.error(error, 'Failed to post a Torn faction report');
		return interaction.editReply(
			postedMessages > 0
				? 'Could not finish posting the faction report. Some messages may already have been sent.'
				: 'Could not post the faction report right now. Please try again later.'
		);
	}
}

@ApplyOptions<Command.Options>({
	name: 'torn',
	description: 'View Torn profiles, faction information, and member pairing status.'
})
export class TornCommand extends Command {
	public readonly helpCategory = 'torn' as const;
	public readonly helpSubcommands = Object.values(tornSubcommands);

	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((subcommand) =>
					subcommand
						.setName(tornSubcommands.profile.name)
						.setDescription(tornSubcommands.profile.description)
						.addStringOption((option) =>
							option.setName('player-id').setDescription('Torn player ID; omit to view your paired profile.').setRequired(false)
						)
				)
				.addSubcommandGroup((group) =>
					group
						.setName('faction')
						.setDescription('Post faction information, the roster, paired-account status, or active organized crimes.')
						.addSubcommand((subcommand) => subcommand.setName('info').setDescription(tornSubcommands.factionInfo.description))
						.addSubcommand((subcommand) => subcommand.setName('members').setDescription(tornSubcommands.factionMembers.description))
						.addSubcommand((subcommand) =>
							subcommand.setName('unregistered').setDescription(tornSubcommands.factionUnregistered.description)
						)
						.addSubcommand((subcommand) =>
							subcommand.setName('organized-crime').setDescription(tornSubcommands.factionOrganizedCrime.description)
						)
				)
		);
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (interaction.options.getSubcommandGroup(false) === 'faction') {
			const view = interaction.options.getSubcommand();
			if (view === 'info' || view === 'members' || view === 'unregistered' || view === 'organized-crime') {
				return runTornFactionCommand(interaction, this.container, view);
			}
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
