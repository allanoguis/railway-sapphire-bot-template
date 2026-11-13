import type { Client } from 'discord.js';

let hasEncounteredError = false;
let debugStatusEnabled = false;

export function setBotPresence(client: Pick<Client, 'user'>, hasError: boolean): void {
	if (hasError) hasEncounteredError = true;

	applyBotPresence(client);
}

export function setDebugStatus(client: Pick<Client, 'user'>, enabled: boolean): void {
	debugStatusEnabled = enabled;
	applyBotPresence(client);
}

function applyBotPresence(client: Pick<Client, 'user'>): void {
	const { user } = client;
	if (!user) return;

	if (debugStatusEnabled) {
		user.setPresence({
			activities: [{ name: 'Bot under development 🛠️' }],
			status: 'dnd'
		});
		return;
	}

	user.setPresence({
		activities: [{ name: hasEncounteredError ? 'service error' : 'Brewing coffee 🍵' }],
		status: 'online'
	});
}
