export interface HelpEntry {
	name: string;
	description: string;
	chatInputRun?: unknown;
}

export function formatCommandList(commands: Iterable<HelpEntry>): string {
	const commandLines = [...commands]
		.filter((command) => typeof command.chatInputRun === 'function')
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((command) => `/${command.name} - ${command.description}`);

	return commandLines.length > 0 ? commandLines.join('\n') : 'No slash commands are available.';
}
