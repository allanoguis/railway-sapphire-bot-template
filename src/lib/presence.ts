import type { Client } from 'discord.js';

let hasEncounteredError = false;

export function setBotPresence(client: Pick<Client, 'user'>, hasError: boolean): void {
	if (hasError) hasEncounteredError = true;

	const { user } = client;
	if (!user) return;

	user.setPresence({
		activities: [{ name: hasEncounteredError ? 'service error' : 'brewing coffee' }],
		status: 'online'
	});
}
