import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { Client } from 'discord.js';

export class FactionAccessError extends Error {
	public constructor() {
		super('Cannot verify access to the configured faction channel. Check your Discord membership and channel permissions.');
	}
}

export async function requireFactionChannelAccess(client: Client, channelId: string | undefined, userId: string): Promise<void> {
	if (!channelId || !client.isReady()) throw new FactionAccessError();

	try {
		const channel = await client.channels.fetch(channelId, { force: true });
		if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
			throw new FactionAccessError();
		}
		await channel.guild.roles.fetch();
		const member = await channel.guild.members.fetch({ user: userId, force: true });
		if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) throw new FactionAccessError();
	} catch (error) {
		if (error instanceof FactionAccessError) throw error;
		throw new FactionAccessError();
	}
}
