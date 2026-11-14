import type { Client } from 'discord.js';

let hasEncounteredError = false;
let debugStatusEnabled = false;
let latestErrorAt: number | undefined;

export function setBotPresence(client: Pick<Client, 'user'>, hasError: boolean): void {
	if (hasError) {
		hasEncounteredError = true;
		latestErrorAt = Date.now();
	}

	applyBotPresence(client);
}

export function getLatestErrorAt(): number | undefined {
	return latestErrorAt;
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
		activities: [{ name: hasEncounteredError ? 'Service Error 🚨' : 'Brewing coffee 🍵' }],
		status: 'online'
	});
}
