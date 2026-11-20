import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { TornStorage } from './service';
import { getTornFactionApiContext, requestFactionEndpoint, TornApiError } from './service';

const rankedWarHistoryLimit = 20;

interface TornRankedWarFaction {
	id: number;
	name: string;
	score: number;
	chain: number;
}

export interface TornFactionRankedWar {
	id: number;
	start: number;
	end: number;
	target: number;
	winner: number | null;
	factions: TornRankedWarFaction[];
}

export interface TornFactionWarHistory {
	faction: { id: number; name?: string; tag?: string };
	wars: TornFactionRankedWar[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function requiredNumber(record: Record<string, unknown>, key: string, positive = false): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || (positive && value <= 0) || (!positive && value < 0)) {
		throw new TornApiError('Torn returned unexpected ranked-war history. Please try again later.');
	}
	return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new TornApiError('Torn returned unexpected ranked-war history. Please try again later.');
	}
	return value.trim();
}

function normalizeFaction(value: unknown): TornRankedWarFaction {
	if (!isRecord(value)) throw new TornApiError('Torn returned unexpected ranked-war history. Please try again later.');
	return {
		id: requiredNumber(value, 'id', true),
		name: requiredString(value, 'name'),
		score: requiredNumber(value, 'score'),
		chain: requiredNumber(value, 'chain')
	};
}

export function normalizeTornFactionWarHistory(payload: Record<string, unknown>, faction: TornFactionWarHistory['faction']): TornFactionWarHistory {
	const entries = payload.rankedwars;
	if (!Array.isArray(entries)) throw new TornApiError('Torn returned unexpected ranked-war history. Please try again later.');

	const wars = entries.map((value) => {
		if (!isRecord(value)) throw new TornApiError('Torn returned unexpected ranked-war history. Please try again later.');
		const { winner } = value;
		if (winner !== null && (typeof winner !== 'number' || !Number.isSafeInteger(winner) || winner <= 0)) {
			throw new TornApiError('Torn returned unexpected ranked-war history. Please try again later.');
		}
		if (!Array.isArray(value.factions) || value.factions.length < 2) {
			throw new TornApiError('Torn returned unexpected ranked-war history. Please try again later.');
		}
		const factions = value.factions.map(normalizeFaction);
		if (!factions.some((entry) => entry.id === faction.id)) {
			throw new TornApiError('Torn returned ranked-war history for a different faction. Please try again later.');
		}
		return {
			id: requiredNumber(value, 'id', true),
			start: requiredNumber(value, 'start', true),
			end: requiredNumber(value, 'end'),
			target: requiredNumber(value, 'target', true),
			winner,
			factions
		};
	});

	wars.sort((left, right) => (right.end || right.start) - (left.end || left.start));
	return { faction, wars: wars.slice(0, rankedWarHistoryLimit) };
}

export async function getTornFactionWarHistory(storage: TornStorage | null, discordUserId: string): Promise<TornFactionWarHistory> {
	const { apiKey, faction } = await getTornFactionApiContext(storage, discordUserId);
	const payload = await requestFactionEndpoint(apiKey, 'rankedwars', {
		limit: rankedWarHistoryLimit,
		sort: 'DESC'
	});
	return normalizeTornFactionWarHistory(payload, faction);
}

function displayText(value: string): string {
	return escapeMarkdown(value).replace(/\s+/g, ' ').slice(0, 100);
}

function displayTimestamp(value: number): string {
	return value > 0 ? `<t:${value}:F>` : 'Ongoing';
}

function resultLabel(war: TornFactionRankedWar, factionId: number): string {
	if (war.winner === null) return war.end === 0 ? 'Ongoing' : 'No winner';
	return war.winner === factionId ? 'Victory' : 'Defeat';
}

function displayFaction(faction: TornRankedWarFaction): string {
	return `${displayText(faction.name)}: ${faction.score.toLocaleString()} score / ${faction.chain.toLocaleString()} chain`;
}

export function buildTornFactionWarHistoryEmbeds(history: TornFactionWarHistory): EmbedBuilder[] {
	const factionName = history.faction.name ? `${displayText(history.faction.name)} ranked-war history` : 'Faction ranked-war history';
	const factionUrl = `https://www.torn.com/factions.php?step=profile&ID=${history.faction.id}`;
	if (history.wars.length === 0) {
		return [
			new EmbedBuilder()
				.setColor(0x5865f2)
				.setTitle(factionName)
				.setURL(factionUrl)
				.setDescription('No ranked-war history was returned.')
				.setTimestamp()
		];
	}

	const embeds: EmbedBuilder[] = [];
	for (let offset = 0; offset < history.wars.length; offset += 5) {
		const wars = history.wars.slice(offset, offset + 5);
		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle(`${factionName}${history.wars.length > 5 ? ` - ${Math.floor(offset / 5) + 1}/${Math.ceil(history.wars.length / 5)}` : ''}`)
			.setURL(factionUrl);
		if (offset === 0)
			embed.setDescription(`Faction ID: ${history.faction.id}\nShowing the ${history.wars.length} most recent ranked wars.`).setTimestamp();

		for (const war of wars) {
			const own = war.factions.find((entry) => entry.id === history.faction.id);
			const opponents = war.factions.filter((entry) => entry.id !== history.faction.id);
			const participants = [...(own ? [own] : []), ...opponents].map(displayFaction).join(' vs ');
			embed.addFields({
				name: `War ${war.id} - ${resultLabel(war, history.faction.id)}`,
				value: [
					participants,
					`Started: ${displayTimestamp(war.start)}`,
					`Ended: ${displayTimestamp(war.end)}`,
					`Target: ${war.target.toLocaleString()}`
				].join('\n')
			});
		}
		embeds.push(embed);
	}
	return embeds;
}
