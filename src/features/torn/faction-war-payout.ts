import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import {
	getTornApiKeyForPlayerId,
	getTornFactionApiContext,
	normalizeFactionMembers,
	requestFactionEndpoint,
	requestTornPayload,
	TornApiError
} from './service';
import type { CredentialAccessCheck, TornStorage } from './service';

const ATTACK_PAGE_SIZE = 100;
const MAX_ATTACK_PAGES = 1000;
const MEMBERS_PER_EMBED = 12;

export type TornWarPayoutOutcome = 'leave' | 'mug' | 'hospitalize';
export type TornWarPayoutExclusionReason =
	| 'duplicate'
	| 'outside-war-period'
	| 'not-ranked-war'
	| 'interrupted'
	| 'missing-attacker'
	| 'attacker-outside-faction'
	| 'defender-outside-faction'
	| 'unqualified-result'
	| 'member-not-in-war-report';

interface TornWarPayoutFaction {
	id: number;
	name: string;
	members: Array<{ id: number; name: string }>;
}

interface TornWarPayoutWar {
	id: number;
	start: number;
	end: number;
	faction: TornWarPayoutFaction;
	opponent: TornWarPayoutFaction;
}

interface TornWarPayoutAttack {
	id: number;
	started: number;
	attackerId?: number;
	attackerFactionId?: number;
	defenderFactionId?: number;
	result: string;
	isInterrupted: boolean;
	isRankedWar: boolean;
}

export interface TornFactionWarPayoutMember {
	id: number;
	name: string;
	leave: number;
	mug: number;
	hospitalize: number;
	total: number;
}

export interface TornFactionWarPayoutReport {
	warId: number;
	start: number;
	end: number;
	faction: { id: number; name: string };
	opponent: { id: number; name: string };
	members: TornFactionWarPayoutMember[];
	totals: {
		leave: number;
		mug: number;
		hospitalize: number;
		total: number;
		excluded: number;
		attackRecords: number;
	};
	exclusions: Array<{ attackId: number; reason: TornWarPayoutExclusionReason }>;
}

function invalidWarReport(): never {
	throw new TornApiError('Torn returned an unexpected ranked-war report. Please try again later.');
}

function invalidAttackData(): never {
	throw new TornApiError('Torn returned unexpected faction attack data. Please try again later.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function requiredNumber(record: Record<string, unknown>, key: string, positive = false): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || (positive && value <= 0) || (!positive && value < 0)) {
		return invalidWarReport();
	}
	return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== 'string' || value.trim().length === 0) return invalidWarReport();
	return value.trim();
}

function normalizeWarFaction(value: unknown): TornWarPayoutFaction {
	if (!isRecord(value) || !Array.isArray(value.members)) return invalidWarReport();

	const memberIds = new Set<number>();
	const members = value.members.map((member) => {
		if (!isRecord(member)) return invalidWarReport();
		const id = requiredNumber(member, 'id', true);
		const name = requiredString(member, 'name');
		if (memberIds.has(id)) return invalidWarReport();
		memberIds.add(id);
		return { id, name };
	});

	return {
		id: requiredNumber(value, 'id', true),
		name: requiredString(value, 'name'),
		members
	};
}

export function normalizeTornFactionWarPayoutWar(payload: Record<string, unknown>, expectedWarId: number, factionId: number): TornWarPayoutWar {
	const report = payload.rankedwarreport;
	if (!isRecord(report) || !Array.isArray(report.factions) || report.factions.length !== 2) return invalidWarReport();

	const id = requiredNumber(report, 'id', true);
	const start = requiredNumber(report, 'start', true);
	const end = requiredNumber(report, 'end');
	if (id !== expectedWarId) {
		throw new TornApiError('Torn returned a ranked-war report for a different War ID. Please try again.');
	}
	if (end === 0) throw new TornApiError('This war is still active. Run the payout report after the war has ended.');
	if (end <= start) return invalidWarReport();

	const factions = report.factions.map(normalizeWarFaction);
	const faction = factions.find((entry) => entry.id === factionId);
	const opponent = factions.find((entry) => entry.id !== factionId);
	if (!faction || !opponent || faction.id === opponent.id) {
		throw new TornApiError('That War ID does not belong to your current faction.');
	}

	return { id, start, end, faction, opponent };
}

function normalizeAttackPlayerFaction(value: unknown): number | undefined {
	if (value === null || value === undefined) return undefined;
	if (!isRecord(value)) return invalidAttackData();
	const { id } = value;
	if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return invalidAttackData();
	return id;
}

function normalizeAttackPlayer(value: unknown): { id?: number; factionId?: number } | undefined {
	if (value === null || value === undefined) return undefined;
	if (!isRecord(value)) return invalidAttackData();
	const { id } = value;
	if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return invalidAttackData();
	return {
		id,
		factionId: normalizeAttackPlayerFaction(value.faction)
	};
}

function normalizeAttack(value: unknown): TornWarPayoutAttack {
	if (!isRecord(value)) return invalidAttackData();
	const { id } = value;
	const { started } = value;
	if (
		typeof id !== 'number' ||
		!Number.isSafeInteger(id) ||
		id <= 0 ||
		typeof started !== 'number' ||
		!Number.isSafeInteger(started) ||
		started <= 0 ||
		typeof value.result !== 'string' ||
		typeof value.is_interrupted !== 'boolean' ||
		typeof value.is_ranked_war !== 'boolean'
	) {
		return invalidAttackData();
	}

	const attacker = normalizeAttackPlayer(value.attacker);
	const defender = normalizeAttackPlayer(value.defender);
	return {
		id,
		started,
		...(attacker?.id === undefined ? {} : { attackerId: attacker.id }),
		...(attacker?.factionId === undefined ? {} : { attackerFactionId: attacker.factionId }),
		...(defender?.factionId === undefined ? {} : { defenderFactionId: defender.factionId }),
		result: value.result,
		isInterrupted: value.is_interrupted,
		isRankedWar: value.is_ranked_war
	};
}

function attackOutcome(result: string): TornWarPayoutOutcome | undefined {
	switch (result.trim().toLowerCase()) {
		case 'attacked':
			return 'leave';
		case 'mugged':
			return 'mug';
		case 'hospitalized':
			return 'hospitalize';
		default:
			return undefined;
	}
}

function normalizedNextUrl(payload: Record<string, unknown>, current: URL, apiKey: string): URL | undefined {
	const metadata = payload._metadata;
	if (!isRecord(metadata) || !isRecord(metadata.links)) return invalidAttackData();
	const { next } = metadata.links;
	if (next === null || next === undefined) return undefined;
	if (typeof next !== 'string') return invalidAttackData();

	let nextUrl: URL;
	try {
		nextUrl = new URL(next, current);
	} catch {
		return invalidAttackData();
	}
	if (nextUrl.origin !== 'https://api.torn.com' || nextUrl.pathname !== '/v2/faction/attacks') return invalidAttackData();
	nextUrl.searchParams.set('key', apiKey);
	return nextUrl;
}

async function requestPayoutEndpoint(apiKey: string, endpoint: string, params?: Record<string, string | number>): Promise<Record<string, unknown>> {
	try {
		return await requestFactionEndpoint(apiKey, endpoint, params);
	} catch (error) {
		if (error instanceof TornApiError && error.code === 6) {
			throw new TornApiError('No ranked war with that War ID was found.', error.code);
		}
		if (error instanceof TornApiError && (error.code === 7 || error.code === 16)) {
			throw new TornApiError(
				"The registered faction leader's API key needs Faction API Access. Ask the leader to enable it or pair a key that has it.",
				error.code
			);
		}
		throw error;
	}
}

async function requestWarAttackPages(apiKey: string, war: TornWarPayoutWar): Promise<TornWarPayoutAttack[]> {
	let url = new URL('https://api.torn.com/v2/faction/attacks');
	url.searchParams.set('filters', 'outgoing');
	url.searchParams.set('from', String(war.start));
	url.searchParams.set('to', String(war.end));
	url.searchParams.set('limit', String(ATTACK_PAGE_SIZE));
	url.searchParams.set('sort', 'ASC');
	url.searchParams.set('key', apiKey);

	const attacks: TornWarPayoutAttack[] = [];
	const visited = new Set<string>();
	for (let page = 0; page < MAX_ATTACK_PAGES; page += 1) {
		const auditUrl = new URL(url);
		auditUrl.searchParams.delete('key');
		if (visited.has(auditUrl.href)) return invalidAttackData();
		visited.add(auditUrl.href);

		let payload: Record<string, unknown>;
		try {
			payload = await requestTornPayload(url);
		} catch (error) {
			if (error instanceof TornApiError && (error.code === 7 || error.code === 16)) {
				throw new TornApiError(
					"The registered faction leader's API key needs Faction API Access. Ask the leader to enable it or pair a key that has it.",
					error.code
				);
			}
			throw error;
		}
		if (!Array.isArray(payload.attacks)) return invalidAttackData();
		for (const attack of payload.attacks) attacks.push(normalizeAttack(attack));

		const next = normalizedNextUrl(payload, url, apiKey);
		if (!next) return attacks;
		url = next;
	}

	throw new TornApiError('The faction attack feed exceeded the safe pagination limit for this war.');
}

function aggregatePayout(
	war: TornWarPayoutWar,
	attacks: TornWarPayoutAttack[]
): Omit<TornFactionWarPayoutReport, 'warId' | 'start' | 'end' | 'faction' | 'opponent'> {
	const members = new Map(
		war.faction.members.map((member) => [
			member.id,
			{
				...member,
				leave: 0,
				mug: 0,
				hospitalize: 0,
				total: 0
			}
		])
	);
	const seen = new Set<number>();
	const exclusions: TornFactionWarPayoutReport['exclusions'] = [];
	const exclude = (attackId: number, reason: TornWarPayoutExclusionReason) => exclusions.push({ attackId, reason });

	for (const attack of attacks) {
		if (seen.has(attack.id)) {
			exclude(attack.id, 'duplicate');
			continue;
		}
		seen.add(attack.id);

		if (attack.started < war.start || attack.started >= war.end) {
			exclude(attack.id, 'outside-war-period');
			continue;
		}
		if (!attack.isRankedWar) {
			exclude(attack.id, 'not-ranked-war');
			continue;
		}
		if (attack.isInterrupted) {
			exclude(attack.id, 'interrupted');
			continue;
		}
		if (attack.attackerId === undefined || attack.attackerFactionId === undefined) {
			exclude(attack.id, 'missing-attacker');
			continue;
		}
		if (attack.attackerFactionId !== war.faction.id) {
			exclude(attack.id, 'attacker-outside-faction');
			continue;
		}
		if (attack.defenderFactionId !== war.opponent.id) {
			exclude(attack.id, 'defender-outside-faction');
			continue;
		}
		const outcome = attackOutcome(attack.result);
		if (!outcome) {
			exclude(attack.id, 'unqualified-result');
			continue;
		}
		const member = members.get(attack.attackerId);
		if (!member) {
			exclude(attack.id, 'member-not-in-war-report');
			continue;
		}
		member[outcome] += 1;
		member.total += 1;
	}

	const reportMembers = [...members.values()].sort(
		(left, right) => right.total - left.total || left.name.localeCompare(right.name) || left.id - right.id
	);
	const totals = reportMembers.reduce(
		(result, member) => {
			result.leave += member.leave;
			result.mug += member.mug;
			result.hospitalize += member.hospitalize;
			result.total += member.total;
			return result;
		},
		{ leave: 0, mug: 0, hospitalize: 0, total: 0 }
	);

	return {
		members: reportMembers,
		totals: {
			...totals,
			excluded: exclusions.length,
			attackRecords: attacks.length
		},
		exclusions
	};
}

export async function getTornFactionWarPayoutReport(
	storage: TornStorage | null,
	discordUserId: string,
	warId: number,
	checkLeaderAccess?: CredentialAccessCheck
): Promise<TornFactionWarPayoutReport> {
	if (!Number.isSafeInteger(warId) || warId <= 0) throw new TornApiError('Enter a valid positive War ID.');
	if (!storage) throw new TornApiError('Torn account pairing is not configured by the bot administrator. Please contact them for help.');

	const context = await getTornFactionApiContext(storage, discordUserId);
	let membersPayload: Record<string, unknown>;
	try {
		membersPayload = await requestFactionEndpoint(context.apiKey, 'members');
	} catch (error) {
		if (error instanceof TornApiError && (error.code === 7 || error.code === 16)) {
			throw new TornApiError('Your paired API key needs faction access to identify the registered faction leader.', error.code);
		}
		throw error;
	}

	const leader = normalizeFactionMembers(membersPayload).find((member) => member.position.trim().toLowerCase() === 'leader');
	if (!leader) throw new TornApiError('Torn did not return a faction leader. Please try again later.');

	const leaderApiKey = await getTornApiKeyForPlayerId(storage, leader.id, checkLeaderAccess);
	if (!leaderApiKey) {
		throw new TornApiError('The faction leader must pair a Torn API key with the bot before the payout report can be created.');
	}

	const warPayload = await requestPayoutEndpoint(leaderApiKey, `${warId}/rankedwarreport`);
	const war = normalizeTornFactionWarPayoutWar(warPayload, warId, context.faction.id);
	const attacks = await requestWarAttackPages(leaderApiKey, war);
	const aggregated = aggregatePayout(war, attacks);

	return {
		warId,
		start: war.start,
		end: war.end,
		faction: { id: war.faction.id, name: war.faction.name },
		opponent: { id: war.opponent.id, name: war.opponent.name },
		...aggregated
	};
}

function displayText(value: string): string {
	return escapeMarkdown(value).replace(/\s+/g, ' ').slice(0, 32);
}

function tableValue(members: TornFactionWarPayoutMember[]): string {
	const rows = members.map((member) => {
		const name = displayText(member.name).slice(0, 24).padEnd(24);
		return `${name} ${String(member.leave).padStart(3)} ${String(member.mug).padStart(3)} ${String(member.hospitalize).padStart(3)} ${String(
			member.total
		).padStart(5)}`;
	});
	return ['```text', `${'Member'.padEnd(24)}   L   M Hosp Total`, '-'.repeat(49), ...rows, '```'].join('\n');
}

export function buildTornFactionWarPayoutEmbeds(report: TornFactionWarPayoutReport): EmbedBuilder[] {
	const factionName = displayText(report.faction.name);
	const opponentName = displayText(report.opponent.name);
	const title = `${factionName} vs ${opponentName} - War Payout`;
	const factionUrl = `https://www.torn.com/factions.php?step=profile&ID=${report.faction.id}`;
	const pages = Math.max(1, Math.ceil(report.members.length / MEMBERS_PER_EMBED));
	const embeds: EmbedBuilder[] = [];

	for (let offset = 0; offset < report.members.length || (offset === 0 && report.members.length === 0); offset += MEMBERS_PER_EMBED) {
		const members = report.members.slice(offset, offset + MEMBERS_PER_EMBED);
		const page = Math.floor(offset / MEMBERS_PER_EMBED) + 1;
		const embed = new EmbedBuilder()
			.setColor(0xe3cd24)
			.setTitle(`${title}${pages > 1 ? ` - ${page}/${pages}` : ''}`.slice(0, 256))
			.setURL(factionUrl);
		if (offset === 0) {
			embed
				.setDescription(
					[
						`War ID: ${report.warId}`,
						`Started: <t:${report.start}:F>`,
						`Ended: <t:${report.end}:F>`,
						'INSIDE means a successful ranked-war attack started inside the exact war period by this faction against the recorded opponent.'
					].join('\n')
				)
				.setTimestamp();
		}
		if (members.length > 0) {
			embed.addFields({ name: 'Member outcomes', value: tableValue(members) });
		} else {
			embed.addFields({ name: 'Member outcomes', value: 'No historical faction members were returned for this war.' });
		}
		embeds.push(embed);
	}

	const last = embeds[embeds.length - 1];
	last.addFields({
		name: 'INSIDE attack totals',
		value: [
			`Leave: ${report.totals.leave}`,
			`Mug: ${report.totals.mug}`,
			`Hospitalize: ${report.totals.hospitalize}`,
			`Total: ${report.totals.total}`,
			`Excluded records: ${report.totals.excluded} of ${report.totals.attackRecords}`
		].join('\n')
	});
	return embeds;
}
