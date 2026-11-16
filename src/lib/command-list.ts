export interface HelpEntry {
	name: string;
	description: string;
	chatInputRun?: unknown;
	helpCategory?: 'core' | 'torn';
	helpSubcommands?: readonly { name: string; description: string }[];
}

export function formatCommandList(commands: Iterable<HelpEntry>): string {
	const commandLines: Record<'core' | 'torn', string[]> = { core: [], torn: [] };
	for (const command of commands) {
		if (typeof command.chatInputRun !== 'function') continue;
		const category = command.helpCategory ?? 'core';
		const lines = command.helpSubcommands?.length
			? command.helpSubcommands.map((subcommand) => `/${command.name} ${subcommand.name} - ${subcommand.description}`)
			: [`/${command.name} - ${command.description}`];
		commandLines[category].push(...lines);
	}

	const sections = (['core', 'torn'] as const)
		.map((category) => {
			const lines = commandLines[category].sort((left, right) => left.localeCompare(right));
			return lines.length > 0 ? `**${category === 'core' ? 'Core' : 'Torn'}**\n${lines.join('\n')}` : '';
		})
		.filter(Boolean);
	return sections.length > 0 ? sections.join('\n\n') : 'No slash commands are available.';
}
