import { ChatInputCommand, Command } from '@sapphire/framework';
import { ApplyOptions } from '@sapphire/decorators';
import { formatCommandList } from '../lib/command-list';

@ApplyOptions<Command.Options>({
	name: 'help',
	description: 'List the available slash commands.',
	preconditions: ['GuildOnly']
})
export class HelpCommand extends Command {
	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const commands = this.container.stores.get('commands').values();
		return interaction.reply({
			content: `**Available commands**\n${formatCommandList(commands)}`,
			flags: 'Ephemeral'
		});
	}
}
