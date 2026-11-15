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

function displayCooldown(value: unknown): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';

	const totalSeconds = Math.max(0, Math.floor(value));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${String(hours).padStart(2, '0')}h:${String(minutes).padStart(2, '0')}m:${String(seconds).padStart(2, '0')}s`;
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
	if (!faction) return 'None';

	return [
		`Id: ${typeof faction.id === 'number' && Number.isFinite(faction.id) ? Math.floor(faction.id) : 'Unavailable'}`,
		`Name: ${faction.name ?? 'Unavailable'}`,
		`Position: ${faction.position ?? 'Unavailable'}`,
		`Days in faction: ${displayNumber(faction.days_in_faction)}`
	].join('\n');
}

export function buildTornProfileEmbed(profile: TornProfile, isLinkedProfile: boolean): EmbedBuilder {
	const name = profile.name ?? 'Torn player';
	const faction = buildFaction(profile);
	const linkedBarLines = [
		displayBar('Energy', profile.energy),
		displayBar('Nerve', profile.nerve),
		displayBar('Happy', profile.happy),
		displayBar('Life', profile.life)
	];
	const linkedCooldownLines = [
		`drug: ${displayCooldown(profile.cooldowns?.drug)}`,
		`medical: ${displayCooldown(profile.cooldowns?.medical)}`,
		`booster: ${displayCooldown(profile.cooldowns?.booster)}`
	];
	const bars = isLinkedProfile ? linkedBarLines.join('\n') : 'Available only for a paired account.';
	const cooldowns = isLinkedProfile ? linkedCooldownLines.join('\n') : 'Available only for a paired account.';
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
			{ name: 'Bars', value: bars, inline: false },
			{ name: 'Cooldowns', value: cooldowns, inline: false },
			...(isLinkedProfile ? [{ name: 'Battle Stats', value: battleStats, inline: false }] : [])
		)
		.setFooter({ text: isLinkedProfile ? 'Private profile shown only to you' : 'Public profile data' })
		.setTimestamp();
}
