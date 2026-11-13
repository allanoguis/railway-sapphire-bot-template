import { ChatInputCommand, Command } from '@sapphire/framework';
import { ApplyOptions } from '@sapphire/decorators';
import { formatUptime } from '../lib/bot-info';

@ApplyOptions<Command.Options>({
	name: 'about',
	description: 'Show bot status and runtime information.'
})
export class AboutCommand extends Command {
	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { guilds, user } = this.container.client;
		const botName = user?.username ?? 'Discord bot';

		return interaction.reply({
			content: `**${botName}** is online.\nServers: ${guilds.cache.size}\nUptime: ${formatUptime(process.uptime())}`,
			flags: 'Ephemeral'
		});
	}
}
