import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import type { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { buildTornFactionInfoEmbeds, buildTornFactionMemberEmbeds } from '../features/torn/faction';
import { isOrganizedCrimeAlertChannel, organizedCrimeAlertScheduler, refreshOrganizedCrimeAlert } from '../features/torn/faction-oc-alerts';
import { buildTornFactionUnregisteredEmbeds, getTornFactionUnregisteredReport } from '../features/torn/faction-unregistered';
import { buildTornProfileEmbed } from '../features/torn/profile';
import { getTornFactionOverview, getTornProfile, TornApiError } from '../features/torn/service';
import type { PostgresStorage } from '../lib/postgres-storage';
import { requireTornFeature, type TornFeature } from '../features/torn/switches';

interface FactionCommandContext {
	storage: PostgresStorage | null;
	tornFactionChannelId: string | undefined;
	tornOcAlertChannelId?: string;
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
	factionOrganizedCrimes: {
		name: 'faction organized-crimes',
		description: 'Refresh the organized-crime alert channel and start its hourly updates.'
	}
} as const;

async function runTornFactionOrganizedCrimeAlert(interaction: ChatInputCommandInteraction, context: FactionCommandContext) {
	const { tornOcAlertChannelId } = context;
	if (!tornOcAlertChannelId) {
		return interaction.reply({
			content: 'The organized-crime alert channel is not configured by the bot administrator.',
			flags: 'Ephemeral'
		});
	}

	if (!interaction.inGuild() || !interaction.guildId) {
		return interaction.reply({
			content: 'Use the organized-crime alert command in the configured Discord server.',
			flags: 'Ephemeral'
		});
	}

	const { guildId } = interaction;
	await interaction.deferReply({ flags: 'Ephemeral' });
	try {
		const channel = await interaction.client.channels.fetch(tornOcAlertChannelId);
		if (!isOrganizedCrimeAlertChannel(channel) || channel.guildId !== guildId) {
			throw new TornApiError('The configured organized-crime alert channel is unavailable in this server.');
		}
		const refresh = async (discordUserId: string) => {
			await refreshOrganizedCrimeAlert(channel, context.storage, discordUserId);
		};
		organizedCrimeAlertScheduler.start(tornOcAlertChannelId, interaction.user.id, refresh, context.logger);
		await organizedCrimeAlertScheduler.refreshNow(tornOcAlertChannelId, interaction.user.id);
		return interaction.editReply(`Refreshed <#${tornOcAlertChannelId}>. Automatic updates are active hourly until the bot restarts.`);
	} catch (error) {
		if (error instanceof TornApiError) return interaction.editReply(error.message);

		context.logger.error(error, 'Failed to refresh the Torn faction organized-crime alert');
		return interaction.editReply('Could not refresh the organized-crime alert right now. Please try again later.');
	}
}

export async function runTornFactionCommand(
	interaction: ChatInputCommandInteraction,
	context: FactionCommandContext,
	view: 'info' | 'members' | 'unregistered' | 'organized-crimes'
) {
	if (view === 'organized-crimes') {
		return runTornFactionOrganizedCrimeAlert(interaction, context);
	}

	const { tornFactionChannelId } = context;
	if (!tornFactionChannelId) {
		return interaction.reply({
			content: 'The faction command is not configured by the bot administrator.',
			flags: 'Ephemeral'
		});
	}

	if (!interaction.inGuild() || interaction.channelId !== tornFactionChannelId) {
		return interaction.reply({
			content: 'Use `/torn faction info`, `/torn faction members`, or `/torn faction unregistered` in the configured channel.',
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
		if (view === 'unregistered') {
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

		let content: string;
		if (view === 'info') {
			content = `Posted faction information in this channel (${postedMessages} messages).`;
		} else if (view === 'members') {
			content = `Posted the faction roster in this channel (${postedMessages} messages).`;
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
							subcommand.setName('organized-crimes').setDescription(tornSubcommands.factionOrganizedCrimes.description)
						)
				)
		);
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (interaction.options.getSubcommandGroup(false) === 'faction') {
			const view = interaction.options.getSubcommand();
			if (view === 'info' || view === 'members' || view === 'unregistered' || view === 'organized-crimes') {
				const feature: TornFeature = view === 'organized-crimes' ? 'faction-organized-crime' : `faction-${view}`;
				if (!(await requireTornFeature(feature, interaction, this.container.storage, this.container.logger))) return;
				return runTornFactionCommand(interaction, this.container, view);
			}
		}

		if (!(await requireTornFeature('profile', interaction, this.container.storage, this.container.logger))) return;
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
