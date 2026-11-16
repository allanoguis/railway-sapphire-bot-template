import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { getTornFactionApiContext, normalizeFactionBasic, normalizeFactionMembers, requestFactionEndpoint, TornApiError } from './service';
import type { TornFactionMember, TornStorage } from './service';
import type { PostgresStorage } from '../../lib/postgres-storage';

type TornFactionRegistrationStorage = TornStorage & Pick<PostgresStorage, 'getRegisteredTornPlayerIds'>;

export interface TornFactionUnregisteredReport {
	faction: { id: number; name?: string; tag?: string };
	factionMemberCount: number;
	members: TornFactionMember[];
}

export async function getTornFactionUnregisteredReport(
	storage: TornFactionRegistrationStorage | null,
	discordUserId: string
): Promise<TornFactionUnregisteredReport> {
	if (storage === null) {
		throw new TornApiError('Torn account pairing is not configured by the bot administrator. Please contact them for help.');
	}

	const { apiKey, faction } = await getTornFactionApiContext(storage, discordUserId);
	const [basicPayload, membersPayload] = await Promise.all([requestFactionEndpoint(apiKey, 'basic'), requestFactionEndpoint(apiKey, 'members')]);
	const basic = normalizeFactionBasic(basicPayload);
	if (basic.id !== faction.id) throw new TornApiError('Torn returned inconsistent faction data. Please try again later.');
	const factionMembers = normalizeFactionMembers(membersPayload);
	const registeredIds = await storage.getRegisteredTornPlayerIds(factionMembers.map((member) => member.id));

	return {
		faction: { id: basic.id, name: basic.name, tag: basic.tag },
		factionMemberCount: factionMembers.length,
		members: factionMembers.filter((member) => !registeredIds.has(member.id))
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
	const pageTitle = `Unverified faction members for ${factionTitle}`;

	if (report.members.length === 0) {
		const description =
			report.factionMemberCount === 0
				? 'No faction members were returned.'
				: `All ${report.factionMemberCount} returned faction members have paired a Torn API key with the bot.`;
		return [new EmbedBuilder().setColor(0x5865f2).setTitle(pageTitle).setURL(factionUrl).setDescription(description)];
	}

	const lines = report.members.map((member) => `**${displayText(member.name)}** (ID ${member.id})`);
	const pages = chunkLines(lines);
	return pages.map((page, index) => {
		const pageLabel = pages.length > 1 ? ` - ${index + 1}/${pages.length}` : '';
		const description = [`${report.members.length} faction members have not paired a Torn API key with the bot.`, page.join('\n')]
			.filter(Boolean)
			.join('\n\n');

		return new EmbedBuilder().setColor(0x5865f2).setTitle(`${pageTitle}${pageLabel}`).setURL(factionUrl).setDescription(description);
	});
}
