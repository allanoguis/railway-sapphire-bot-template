import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import {
	getTornFactionApiContext,
	normalizeFactionBasic,
	normalizeFactionMembers,
	requestFactionEndpoint,
	requestTornPayload,
	TornApiError
} from './service';
import type { TornFactionMember, TornStorage } from './service';

export interface TornFactionUnregisteredReport {
	faction: { id: number; name?: string; tag?: string };
	availableCrimeCount: number;
	factionMemberCount: number;
	members: TornFactionMember[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestFactionCrimesPage(apiKey: string, offset: number): Promise<Record<string, unknown>> {
	const url = new URL('https://api.torn.com/v2/faction/crimes');
	url.searchParams.set('cat', 'available');
	url.searchParams.set('limit', '20');
	url.searchParams.set('offset', String(offset));
	url.searchParams.set('key', apiKey);
	return requestTornPayload(url);
}

function normalizeFactionCrimePage(payload: Record<string, unknown>): { crimeCount: number; memberIds: Set<number> } {
	const { crimes } = payload;
	if (crimes === undefined) return { crimeCount: 0, memberIds: new Set() };
	if (!Array.isArray(crimes)) throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');

	const memberIds = new Set<number>();
	for (const crime of crimes) {
		if (!isRecord(crime)) throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');
		if (crime.slots === undefined || crime.slots === null) continue;
		if (!Array.isArray(crime.slots)) throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');

		for (const slot of crime.slots) {
			if (!isRecord(slot)) throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');
			if (slot.user === undefined || slot.user === null) continue;
			if (!isRecord(slot.user)) throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');

			const memberId = slot.user.id;
			if (typeof memberId !== 'number' || !Number.isSafeInteger(memberId) || memberId <= 0) {
				throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');
			}
			memberIds.add(memberId);
		}
	}

	return { crimeCount: crimes.length, memberIds };
}

function readNextFactionCrimeOffset(payload: Record<string, unknown>, offset: number): number | undefined {
	const { _metadata } = payload;
	if (_metadata === undefined) return undefined;
	if (!isRecord(_metadata)) throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');
	const { links } = _metadata;
	if (links === undefined) return undefined;
	if (!isRecord(links)) throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');

	const { next } = links;
	if (next === undefined || next === null || next === '') return undefined;
	if (typeof next !== 'string') throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');

	let nextUrl: URL;
	try {
		nextUrl = new URL(next, 'https://api.torn.com');
	} catch {
		throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');
	}
	const nextOffset = Number(nextUrl.searchParams.get('offset'));
	if (
		nextUrl.origin !== 'https://api.torn.com' ||
		nextUrl.pathname !== '/v2/faction/crimes' ||
		!Number.isSafeInteger(nextOffset) ||
		nextOffset <= offset
	) {
		throw new TornApiError('Torn returned unexpected faction crime data. Please try again later.');
	}
	return nextOffset;
}

async function getAvailableFactionCrimeMembers(apiKey: string): Promise<{ crimeCount: number; memberIds: Set<number> }> {
	const memberIds = new Set<number>();
	let crimeCount = 0;
	let offset = 0;

	while (true) {
		const payload = await requestFactionCrimesPage(apiKey, offset);
		const page = normalizeFactionCrimePage(payload);
		crimeCount += page.crimeCount;
		for (const memberId of page.memberIds) memberIds.add(memberId);

		const nextOffset = readNextFactionCrimeOffset(payload, offset);
		if (nextOffset !== undefined) {
			offset = nextOffset;
		} else if (page.crimeCount === 20) {
			offset += 20;
		} else {
			break;
		}
	}

	return { crimeCount, memberIds };
}

export async function getTornFactionUnregisteredReport(storage: TornStorage | null, discordUserId: string): Promise<TornFactionUnregisteredReport> {
	const { apiKey, faction } = await getTornFactionApiContext(storage, discordUserId);
	const [basicPayload, membersPayload, crimeData] = await Promise.all([
		requestFactionEndpoint(apiKey, 'basic'),
		requestFactionEndpoint(apiKey, 'members'),
		getAvailableFactionCrimeMembers(apiKey)
	]);
	const basic = normalizeFactionBasic(basicPayload);
	if (basic.id !== faction.id) throw new TornApiError('Torn returned inconsistent faction data. Please try again later.');
	const factionMembers = normalizeFactionMembers(membersPayload);

	return {
		faction: { id: basic.id, name: basic.name, tag: basic.tag },
		availableCrimeCount: crimeData.crimeCount,
		factionMemberCount: factionMembers.length,
		members: factionMembers.filter((member) => !crimeData.memberIds.has(member.id))
	};
}

function displayText(value: string | undefined, fallback = 'Unavailable'): string {
	const text = value?.trim();
	return text ? escapeMarkdown(text).replace(/\s+/g, ' ').slice(0, 100) : fallback;
}

function chunkLines(lines: string[], maxCharacters = 3200): string[][] {
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

export function buildTornFactionUnregisteredEmbeds(report: TornFactionUnregisteredReport): EmbedBuilder[] {
	const factionTitle = `${displayText(report.faction.name, 'Torn faction')}${report.faction.tag ? ` [${displayText(report.faction.tag)}]` : ''}`;
	const factionUrl = `https://www.torn.com/factions.php?step=profile&ID=${report.faction.id}`;
	const pageTitle = `OC registration for ${factionTitle}`;

	if (report.members.length === 0) {
		const description =
			report.factionMemberCount === 0
				? 'No faction members were returned.'
				: `All ${report.factionMemberCount} returned faction members are registered in at least one available OC.`;
		return [new EmbedBuilder().setColor(0x5865f2).setTitle(pageTitle).setURL(factionUrl).setDescription(description)];
	}

	const lines = report.members.map((member) => `**${displayText(member.name)}** (ID ${member.id})`);
	const pages = chunkLines(lines);
	const noAvailableCrimes = report.availableCrimeCount === 0;
	return pages.map((page, index) => {
		const pageLabel = pages.length > 1 ? ` - ${index + 1}/${pages.length}` : '';
		const description = [
			`${report.members.length} faction members are not registered in any available OC.`,
			noAvailableCrimes ? 'No recruiting or planning OCs are currently available.' : '',
			page.join('\n')
		]
			.filter(Boolean)
			.join('\n\n');

		return new EmbedBuilder().setColor(0x5865f2).setTitle(`${pageTitle}${pageLabel}`).setURL(factionUrl).setDescription(description);
	});
}
