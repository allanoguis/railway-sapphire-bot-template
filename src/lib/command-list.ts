export interface HelpEntry {
	name: string;
	description: string;
	chatInputRun?: unknown;
	helpSubcommands?: readonly { name: string; description: string }[];
}

export function formatCommandList(commands: Iterable<HelpEntry>): string {
	const commandLines = [...commands]
		.filter((command) => typeof command.chatInputRun === 'function')
		.flatMap((command) =>
			command.helpSubcommands?.length
				? command.helpSubcommands.map((subcommand) => `/${command.name} ${subcommand.name} - ${subcommand.description}`)
				: [`/${command.name} - ${command.description}`]
		)
		.sort((left, right) => left.localeCompare(right));

	return commandLines.length > 0 ? commandLines.join('\n') : 'No slash commands are available.';
}
