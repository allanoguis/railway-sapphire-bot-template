import { ChatInputCommand, Command } from '@sapphire/framework';
import { ApplyOptions } from '@sapphire/decorators';
import { EmbedBuilder } from 'discord.js';
import { formatUptime } from '../lib/bot-info';
import { getLatestErrorAt } from '../lib/presence';

@ApplyOptions<Command.Options>({
	name: 'about',
	description: 'Show bot status and runtime information.'
})
export class AboutCommand extends Command {
	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { guilds, user, ws } = this.container.client;
		const latestErrorAt = getLatestErrorAt();
		const botName = user?.username ?? 'Discord bot';
		const apiLatency = ws.ping;
		const latestError =
			latestErrorAt === undefined
				? 'No errors recorded'
				: `<t:${Math.floor(latestErrorAt / 1000)}:F>\n<t:${Math.floor(latestErrorAt / 1000)}:R>`;

		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle(`About ${botName}`)
			.setDescription('Bot runtime and service information')
			.addFields(
				{
					name: 'API Latency',
					value: Number.isFinite(apiLatency) && apiLatency >= 0 ? `${Math.round(apiLatency)} ms` : 'Unavailable',
					inline: true
				},
				{ name: 'Server Uptime', value: formatUptime(process.uptime()), inline: true },
				{ name: 'Servers', value: guilds.cache.size.toLocaleString(), inline: true },
				{ name: 'Latest Error (Occurred)', value: latestError, inline: false }
			)
			.setFooter({ text: 'Powered by token' })
			.setTimestamp();

		if (user) embed.setThumbnail(user.displayAvatarURL());

		return interaction.reply({
			embeds: [embed],
			flags: 'Ephemeral'
		});
	}
}
