import { EmbedBuilder } from 'discord.js';
import type { TornProfile } from './service';

function displayNumber(value: unknown): string {
	return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value).toLocaleString() : 'Unavailable';
}

function displayBar(name: string, value: TornProfile['energy']): string {
	if (!value || typeof value.current !== 'number' || typeof value.maximum !== 'number') {
		return `${name}: Unavailable`;
	}
	return `${name}: ${displayNumber(value.current)} / ${displayNumber(value.maximum)}`;
}

function buildStatus(profile: TornProfile): string {
	const parts = [profile.status?.description, profile.status?.details, profile.status?.state].filter(
		(part): part is string => typeof part === 'string' && part.length > 0
	);
	return parts.length > 0 ? [...new Set(parts)].join(' — ') : 'Unavailable';
}

function buildLastAction(profile: TornProfile): string {
	const timestamp = profile.last_action?.timestamp;
	if (typeof timestamp === 'number' && Number.isSafeInteger(timestamp) && timestamp > 0) {
		return `<t:${timestamp}:F>\n<t:${timestamp}:R>`;
	}
	return profile.last_action?.relative ?? profile.last_action?.status ?? 'Unavailable';
}

function getBattleStats(profile: TornProfile): NonNullable<TornProfile['battlestats']> | undefined {
	if (profile.battlestats) return profile.battlestats;
	if (
		typeof profile.strength === 'number' ||
		typeof profile.defense === 'number' ||
		typeof profile.speed === 'number' ||
		typeof profile.dexterity === 'number'
	) {
		return {
			strength: profile.strength,
			defense: profile.defense,
			speed: profile.speed,
			dexterity: profile.dexterity,
			total: profile.total
		};
	}
	return undefined;
}

function buildFaction(profile: TornProfile): string {
	const { faction } = profile;
	if (!faction?.name) return 'None';

	const lines = [`${faction.tag ? `[${faction.tag}] ` : ''}${faction.name}`];
	if (faction.position) lines.push(`Position: ${faction.position}`);
	if (typeof faction.days_in_faction === 'number') lines.push(`Days in faction: ${displayNumber(faction.days_in_faction)}`);
	return lines.join('\n');
}

export function buildTornProfileEmbed(profile: TornProfile, isLinkedProfile: boolean): EmbedBuilder {
	const name = profile.name ?? 'Torn player';
	const faction = buildFaction(profile);
	const linkedBarLines = [
		displayBar('Energy', profile.energy),
		displayBar('Nerve', profile.nerve),
		displayBar('Happy', profile.happy),
		displayBar('Life', profile.life),
		`Cooldowns — drug: ${displayNumber(profile.cooldowns?.drug)}, medical: ${displayNumber(profile.cooldowns?.medical)}, booster: ${displayNumber(
			profile.cooldowns?.booster
		)}`
	];
	const bars = isLinkedProfile ? linkedBarLines.join('\n') : 'Available only for a paired account.';
	const stats = isLinkedProfile ? getBattleStats(profile) : undefined;
	const battleStats = stats
		? `Strength: ${displayNumber(stats.strength)}
Defense: ${displayNumber(stats.defense)}
Speed: ${displayNumber(stats.speed)}
Dexterity: ${displayNumber(stats.dexterity)}
Total: ${displayNumber(stats.total)}`
		: 'Unavailable for this API key.';

	return new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle(name)
		.setDescription(`Torn profile${profile.player_id ? ` · ID ${profile.player_id}` : ''}`)
		.addFields(
			{ name: 'Level', value: displayNumber(profile.level), inline: true },
			{ name: 'Faction', value: faction, inline: true },
			{ name: 'Status', value: buildStatus(profile), inline: false },
			{ name: 'Last Action', value: buildLastAction(profile), inline: false },
			{ name: 'Bars & Cooldowns', value: bars, inline: false },
			...(isLinkedProfile ? [{ name: 'Battle Stats', value: battleStats, inline: false }] : [])
		)
		.setFooter({ text: isLinkedProfile ? 'Private profile shown only to you' : 'Public profile data' })
		.setTimestamp();
}
