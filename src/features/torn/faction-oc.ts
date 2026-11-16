import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import {
	getTornApiKeyForPlayerId,
	getTornFactionApiContext,
	normalizeFactionMembers,
	requestFactionEndpoint,
	requestTornPayload,
	TornApiError
} from './service';
import type { TornFactionApiContext, TornStorage } from './service';

const CRIME_PAGE_SIZE = 20;
const FACTION_CRIMES_URL = 'https://www.torn.com/factions.php?step=your&type=1#faction-crimes';
type TornCrimeCategory = 'available' | 'recruiting' | 'planning' | 'completed';

export interface TornFactionCrimeItemRequirement {
	id: number;
	name?: string;
	isReusable: boolean;
	isAvailable: boolean;
}

export interface TornFactionCrimeItemOutcome {
	ownedBy?: string;
	itemId?: number;
	itemUid?: number;
	outcome?: string;
}

export interface TornFactionCrimeSlotUser {
	id: number;
	name?: string;
	outcome?: string;
	outcomeDuration?: number;
	itemOutcome?: TornFactionCrimeItemOutcome;
	joinedAt?: number;
	progress?: number;
}

export interface TornFactionCrimeSlot {
	position: string;
	positionInfo?: { id: string; label: string };
	itemRequirement?: TornFactionCrimeItemRequirement;
	user?: TornFactionCrimeSlotUser;
	checkpointPassRate?: number;
}

export interface TornFactionCrimeRewardItem {
	id: number;
	quantity: number;
}

export interface TornFactionCrimePayout {
	type?: string;
	percentage?: number;
	paidBy?: number;
	paidAt?: number;
}

export interface TornFactionCrimeRewards {
	money?: number;
	items?: TornFactionCrimeRewardItem[];
	respect?: number;
	scope?: number;
	payout?: TornFactionCrimePayout;
}

export interface TornFactionOrganizedCrime {
	id: number;
	previousCrimeId?: number;
	name: string;
	difficulty?: number;
	status: 'Recruiting' | 'Planning';
	createdAt?: number;
	planningAt?: number;
	readyAt?: number;
	expiredAt?: number;
	executedAt?: number;
	slots?: TornFactionCrimeSlot[];
	rewards?: TornFactionCrimeRewards;
}

export interface TornFactionOrganizedCrimes {
	faction: TornFactionApiContext['faction'];
	crimes: TornFactionOrganizedCrime[];
	counts: {
		recruiting: number;
		ongoing: number;
		completed: number;
		lastUpdatedAt: number;
	};
}

function displayText(value: string | undefined, fallback = 'Unavailable'): string {
	const text = value?.trim();
	return text ? escapeMarkdown(text).replace(/\s+/g, ' ').slice(0, 100) : fallback;
}

function displayStatus(outcome: string | undefined): string {
	if (outcome === undefined) return 'Pending';
	return outcome === 'Successful' ? 'Passed' : `Not passed (${displayText(outcome)})`;
}

function displayCheckpointPassRate(value: number | undefined): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
	const percentage = `${value.toLocaleString()}%`;
	if (value > 70) return `Success: ${percentage}`;
	if (value < 70) return `Might Fail: ${percentage}`;
	return percentage;
}

function chunkLines(lines: string[], maxCharacters = 3500): string[][] {
	const pages: string[][] = [];
	let page: string[] = [];
	let length = 0;

	for (const line of lines) {
		if (page.length > 0 && length + line.length + 1 > maxCharacters) {
			pages.push(page);
			page = [];
			length = 0;
		}
		page.push(line);
		length += line.length + 1;
	}

	if (page.length > 0) pages.push(page);
	return pages;
}

function buildCrimeLines(crime: TornFactionOrganizedCrime): string[] {
	const readyAt = crime.readyAt && Number.isSafeInteger(crime.readyAt) && crime.readyAt > 0 ? ` - Ready <t:${crime.readyAt}:R>` : '';
	const scoreLevel = crime.difficulty === undefined ? '' : ` - OC score level (difficulty): ${crime.difficulty.toLocaleString()}`;
	const lines = [`**${displayText(crime.name)}** - ${crime.status}${scoreLevel}${readyAt}`];
	if (!crime.slots?.length) return [...lines, '- No slot details returned.'];

	for (const slot of crime.slots) {
		const position = displayText(slot.positionInfo?.label ?? slot.position);
		const checkpointPassRate = displayCheckpointPassRate(slot.checkpointPassRate);
		if (!slot.user) {
			const itemName = slot.itemRequirement ? displayText(slot.itemRequirement.name, 'Unknown item') : undefined;
			const item = itemName ? ` - Requires ${itemName}` : '';
			lines.push(`- ${position}: Open${item} | ${checkpointPassRate}`);
			continue;
		}

		const member = displayText(slot.user.name, 'Unknown player');
		const status = displayStatus(slot.user.outcome);
		const itemName = slot.itemRequirement ? displayText(slot.itemRequirement.name, 'Unknown item') : undefined;
		if (slot.itemRequirement && !slot.itemRequirement.isAvailable) {
			lines.push(`**MISSING ITEM** - **${member}** in ${position} needs **${itemName}** | ${checkpointPassRate} | Status: ${status}`);
			continue;
		}

		const item = itemName ? ` | Item ${itemName} available` : '';
		lines.push(`- ${position}: ${member}${item} | ${checkpointPassRate} | Status: ${status}`);
	}
	return lines;
}

export function buildTornFactionOrganizedCrimeEmbeds(report: TornFactionOrganizedCrimes): EmbedBuilder[] {
	const factionName = displayText(report.faction.name, 'Torn faction');
	const factionUrl = `https://www.torn.com/factions.php?step=profile&ID=${report.faction.id}`;
	if (report.crimes.length === 0) {
		return [
			new EmbedBuilder()
				.setColor(0x5865f2)
				.setTitle(`Active organized crimes for ${factionName}`)
				.setURL(factionUrl)
				.setDescription('No recruiting or planning organized crimes were found.')
		];
	}

	const lines = report.crimes.flatMap((crime) => [...buildCrimeLines(crime), '']);
	const pages = chunkLines(lines);
	return pages.map((page, index) =>
		new EmbedBuilder()
			.setColor(page.some((line) => line.includes('**MISSING ITEM**')) ? 0xed4245 : 0x5865f2)
			.setTitle(
				`Active organized crimes for ${factionName} (${report.crimes.length})${pages.length > 1 ? ` - ${index + 1}/${pages.length}` : ''}`
			)
			.setURL(factionUrl)
			.setDescription(page.join('\n').trim())
	);
}

export function buildTornFactionOrganizedCrimeSummaryEmbed(report: TornFactionOrganizedCrimes): EmbedBuilder {
	const factionName = displayText(report.faction.name, 'Torn faction');
	const spacing = '\u2003';
	return new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle(`📊${spacing}**Organized Crime Stats**`)
		.setDescription(
			[
				`📢${spacing}**Recruiting:** ${report.counts.recruiting}`,
				`🥷${spacing}**Ongoing:** ${report.counts.ongoing}`,
				`✅${spacing}**Completed:** ${report.counts.completed}`,
				'',
				`🕛${spacing}**Last updated:** <t:${report.counts.lastUpdatedAt}:F>`,
				`🔗${spacing}**Link:** [${factionName} Organized Crimes Page](${FACTION_CRIMES_URL})`
			].join('\n')
		);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidCrimeData(): never {
	throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalidCrimeData();
	return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== 'string') return invalidCrimeData();
	return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value)) return invalidCrimeData();
	return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') return invalidCrimeData();
	return value;
}

function normalizeCrimeItemOutcome(value: unknown): TornFactionCrimeItemOutcome | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) return invalidCrimeData();
	return {
		...(optionalString(value, 'owned_by') === undefined ? {} : { ownedBy: optionalString(value, 'owned_by') }),
		...(optionalNumber(value, 'item_id') === undefined ? {} : { itemId: optionalNumber(value, 'item_id') }),
		...(optionalNumber(value, 'item_uid') === undefined ? {} : { itemUid: optionalNumber(value, 'item_uid') }),
		...(optionalString(value, 'outcome') === undefined ? {} : { outcome: optionalString(value, 'outcome') })
	};
}

function normalizeCrimeSlotUser(value: unknown): TornFactionCrimeSlotUser | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) return invalidCrimeData();

	const itemOutcome = normalizeCrimeItemOutcome(value.item_outcome);
	return {
		id: requiredNumber(value, 'id'),
		...(optionalString(value, 'outcome') === undefined ? {} : { outcome: optionalString(value, 'outcome') }),
		...(optionalNumber(value, 'outcome_duration') === undefined ? {} : { outcomeDuration: optionalNumber(value, 'outcome_duration') }),
		...(itemOutcome === undefined ? {} : { itemOutcome }),
		...(optionalNumber(value, 'joined_at') === undefined ? {} : { joinedAt: optionalNumber(value, 'joined_at') }),
		...(optionalNumber(value, 'progress') === undefined ? {} : { progress: optionalNumber(value, 'progress') })
	};
}

function normalizeCrimeSlot(value: unknown): TornFactionCrimeSlot {
	if (!isRecord(value)) return invalidCrimeData();

	const { position_info: positionInfo, item_requirement: itemRequirement } = value;
	let normalizedPositionInfo: TornFactionCrimeSlot['positionInfo'];
	if (positionInfo !== undefined && positionInfo !== null) {
		if (!isRecord(positionInfo)) return invalidCrimeData();
		normalizedPositionInfo = {
			id: requiredString(positionInfo, 'id'),
			label: requiredString(positionInfo, 'label')
		};
	}

	let normalizedItemRequirement: TornFactionCrimeItemRequirement | undefined;
	if (itemRequirement !== undefined && itemRequirement !== null) {
		if (!isRecord(itemRequirement)) return invalidCrimeData();
		if (typeof itemRequirement.is_reusable !== 'boolean' || typeof itemRequirement.is_available !== 'boolean') return invalidCrimeData();
		normalizedItemRequirement = {
			id: requiredNumber(itemRequirement, 'id'),
			isReusable: itemRequirement.is_reusable,
			isAvailable: itemRequirement.is_available
		};
	}

	const user = normalizeCrimeSlotUser(value.user);
	const checkpointPassRate = optionalNumber(value, 'checkpoint_pass_rate');
	return {
		position: requiredString(value, 'position'),
		...(normalizedPositionInfo === undefined ? {} : { positionInfo: normalizedPositionInfo }),
		...(normalizedItemRequirement === undefined ? {} : { itemRequirement: normalizedItemRequirement }),
		...(user === undefined ? {} : { user }),
		...(checkpointPassRate === undefined ? {} : { checkpointPassRate })
	};
}

function normalizeCrimeRewards(value: unknown): TornFactionCrimeRewards | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) return invalidCrimeData();

	let items: TornFactionCrimeRewardItem[] | undefined;
	if (value.items !== undefined && value.items !== null) {
		if (!Array.isArray(value.items)) return invalidCrimeData();
		items = value.items.map((item) => {
			if (!isRecord(item)) return invalidCrimeData();
			return { id: requiredNumber(item, 'id'), quantity: requiredNumber(item, 'quantity') };
		});
	}

	let payout: TornFactionCrimePayout | undefined;
	if (value.payout !== undefined && value.payout !== null) {
		if (!isRecord(value.payout)) return invalidCrimeData();
		payout = {
			...(optionalString(value.payout, 'type') === undefined ? {} : { type: optionalString(value.payout, 'type') }),
			...(optionalNumber(value.payout, 'percentage') === undefined ? {} : { percentage: optionalNumber(value.payout, 'percentage') }),
			...(optionalNumber(value.payout, 'paid_by') === undefined ? {} : { paidBy: optionalNumber(value.payout, 'paid_by') }),
			...(optionalNumber(value.payout, 'paid_at') === undefined ? {} : { paidAt: optionalNumber(value.payout, 'paid_at') })
		};
	}

	return {
		...(optionalNumber(value, 'money') === undefined ? {} : { money: optionalNumber(value, 'money') }),
		...(items === undefined ? {} : { items }),
		...(optionalNumber(value, 'respect') === undefined ? {} : { respect: optionalNumber(value, 'respect') }),
		...(optionalNumber(value, 'scope') === undefined ? {} : { scope: optionalNumber(value, 'scope') }),
		...(payout === undefined ? {} : { payout })
	};
}

function normalizeCrime(value: unknown): TornFactionOrganizedCrime {
	if (!isRecord(value)) return invalidCrimeData();
	const status = requiredString(value, 'status');
	if (status !== 'Recruiting' && status !== 'Planning') return invalidCrimeData();

	let slots: TornFactionCrimeSlot[] | undefined;
	if (value.slots !== undefined && value.slots !== null) {
		if (!Array.isArray(value.slots)) return invalidCrimeData();
		slots = value.slots.map(normalizeCrimeSlot);
	}

	const rewards = normalizeCrimeRewards(value.rewards);
	return {
		id: requiredNumber(value, 'id'),
		...(optionalNumber(value, 'previous_crime_id') === undefined ? {} : { previousCrimeId: optionalNumber(value, 'previous_crime_id') }),
		name: requiredString(value, 'name'),
		...(optionalNumber(value, 'difficulty') === undefined ? {} : { difficulty: optionalNumber(value, 'difficulty') }),
		status,
		...(optionalNumber(value, 'created_at') === undefined ? {} : { createdAt: optionalNumber(value, 'created_at') }),
		...(optionalNumber(value, 'planning_at') === undefined ? {} : { planningAt: optionalNumber(value, 'planning_at') }),
		...(optionalNumber(value, 'ready_at') === undefined ? {} : { readyAt: optionalNumber(value, 'ready_at') }),
		...(optionalNumber(value, 'expired_at') === undefined ? {} : { expiredAt: optionalNumber(value, 'expired_at') }),
		...(optionalNumber(value, 'executed_at') === undefined ? {} : { executedAt: optionalNumber(value, 'executed_at') }),
		...(slots === undefined ? {} : { slots }),
		...(rewards === undefined ? {} : { rewards })
	};
}

function normalizeCrimePage(payload: Record<string, unknown>): TornFactionOrganizedCrime[] {
	const { crimes } = payload;
	if (!Array.isArray(crimes)) return invalidCrimeData();
	return crimes.map(normalizeCrime);
}

async function requestCrimeItemNames(apiKey: string, itemIds: number[]): Promise<Map<number, string>> {
	if (itemIds.length === 0) return new Map();

	const url = new URL(`https://api.torn.com/v2/torn/${itemIds.join(',')}/items`);
	url.searchParams.set('key', apiKey);
	const payload = await requestTornPayload(url);
	const { items } = payload;
	if (!Array.isArray(items)) return invalidCrimeData();

	const itemNames = new Map<number, string>();
	for (const item of items) {
		if (!isRecord(item)) return invalidCrimeData();
		itemNames.set(requiredNumber(item, 'id'), requiredString(item, 'name'));
	}
	return itemNames;
}

function readNextOffset(payload: Record<string, unknown>, offset: number, category: TornCrimeCategory): number | undefined {
	const { _metadata } = payload;
	if (_metadata === undefined) return undefined;
	if (!isRecord(_metadata)) return invalidCrimeData();
	const { links } = _metadata;
	if (links === undefined) return undefined;
	if (!isRecord(links)) return invalidCrimeData();
	const { next } = links;
	if (next === undefined || next === null || next === '') return undefined;
	if (typeof next !== 'string') return invalidCrimeData();

	let nextUrl: URL;
	try {
		nextUrl = new URL(next, 'https://api.torn.com');
	} catch {
		return invalidCrimeData();
	}
	const nextOffset = Number(nextUrl.searchParams.get('offset'));
	const nextCategory = nextUrl.searchParams.get('cat');
	if (
		nextUrl.origin !== 'https://api.torn.com' ||
		nextUrl.pathname !== '/v2/faction/crimes' ||
		(nextCategory !== null && nextCategory !== category) ||
		!Number.isSafeInteger(nextOffset) ||
		nextOffset <= offset
	) {
		return invalidCrimeData();
	}
	return nextOffset;
}

async function requestCrimePage(apiKey: string, category: TornCrimeCategory, offset: number): Promise<Record<string, unknown>> {
	const url = new URL('https://api.torn.com/v2/faction/crimes');
	url.searchParams.set('cat', category);
	url.searchParams.set('limit', String(CRIME_PAGE_SIZE));
	url.searchParams.set('offset', String(offset));
	url.searchParams.set('key', apiKey);
	try {
		return await requestTornPayload(url);
	} catch (error) {
		if (error instanceof TornApiError && (error.code === 7 || error.code === 16)) {
			throw new TornApiError(
				"The registered faction leader's API key needs Faction API Access. Ask the leader to enable it or pair a key that has it.",
				error.code
			);
		}
		throw error;
	}
}

async function countCrimesInCategory(apiKey: string, category: Exclude<TornCrimeCategory, 'available'>): Promise<number> {
	let count = 0;
	let offset = 0;

	while (true) {
		const payload = await requestCrimePage(apiKey, category, offset);
		const { crimes } = payload;
		if (!Array.isArray(crimes)) return invalidCrimeData();
		for (const crime of crimes) {
			if (!isRecord(crime)) return invalidCrimeData();
			requiredNumber(crime, 'id');
		}
		count += crimes.length;

		const nextOffset = readNextOffset(payload, offset, category);
		if (nextOffset !== undefined) {
			offset = nextOffset;
		} else if (crimes.length === CRIME_PAGE_SIZE) {
			offset += CRIME_PAGE_SIZE;
		} else {
			break;
		}
	}

	return count;
}

export async function getTornFactionOrganizedCrimes(storage: TornStorage | null, discordUserId: string): Promise<TornFactionOrganizedCrimes> {
	if (storage === null) {
		throw new TornApiError('Torn account pairing is not configured by the bot administrator. Please contact them for help.');
	}
	const faction = await getTornFactionApiContext(storage, discordUserId);
	let membersPayload: Record<string, unknown>;
	try {
		membersPayload = await requestFactionEndpoint(faction.apiKey, 'members');
	} catch (error) {
		if (error instanceof TornApiError && (error.code === 7 || error.code === 16)) {
			throw new TornApiError('Your paired API key needs faction access to identify the registered faction leader.', error.code);
		}
		throw error;
	}

	const factionMembers = normalizeFactionMembers(membersPayload);
	const leader = factionMembers.find((member) => member.position.trim().toLowerCase() === 'leader');
	if (!leader) throw new TornApiError('Torn did not return a faction leader. Please try again later.');
	const memberNames = new Map(factionMembers.map((member) => [member.id, member.name]));

	const leaderApiKey = await getTornApiKeyForPlayerId(storage, leader.id);
	if (!leaderApiKey) {
		throw new TornApiError('The faction leader must pair a Torn API key with the bot before crimes can be listed.');
	}

	const crimesById = new Map<number, TornFactionOrganizedCrime>();
	let offset = 0;

	while (true) {
		const payload = await requestCrimePage(leaderApiKey, 'available', offset);
		const crimes = normalizeCrimePage(payload);
		for (const crime of crimes) crimesById.set(crime.id, crime);

		const nextOffset = readNextOffset(payload, offset, 'available');
		if (nextOffset !== undefined) {
			offset = nextOffset;
		} else if (crimes.length === CRIME_PAGE_SIZE) {
			offset += CRIME_PAGE_SIZE;
		} else {
			break;
		}
	}

	const crimes = [...crimesById.values()];
	const itemIds = [
		...new Set(crimes.flatMap((crime) => crime.slots?.flatMap((slot) => (slot.itemRequirement ? [slot.itemRequirement.id] : [])) ?? []))
	];
	const itemNames = await requestCrimeItemNames(faction.apiKey, itemIds);
	for (const crime of crimes) {
		for (const slot of crime.slots ?? []) {
			if (slot.user) slot.user.name = memberNames.get(slot.user.id);
			if (slot.itemRequirement) slot.itemRequirement.name = itemNames.get(slot.itemRequirement.id);
		}
	}

	const recruiting = await countCrimesInCategory(leaderApiKey, 'recruiting');
	const ongoing = await countCrimesInCategory(leaderApiKey, 'planning');
	const completed = await countCrimesInCategory(leaderApiKey, 'completed');

	return {
		faction: faction.faction,
		crimes,
		counts: {
			recruiting,
			ongoing,
			completed,
			lastUpdatedAt: Math.floor(Date.now() / 1000)
		}
	};
}
