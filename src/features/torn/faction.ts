import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { TornFactionMember, TornFactionOverview, TornFactionWar } from './service';

function displayText(value: string | undefined, fallback = 'Unavailable'): string {
	const text = value?.trim();
	return text ? escapeMarkdown(text).replace(/\s+/g, ' ').slice(0, 100) : fallback;
}

function displayTimestamp(value: number | undefined): string {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? `<t:${value}:R>` : 'Unavailable';
}

function displayChain(chain: TornFactionOverview['chain']): string {
	if (typeof chain?.current !== 'number' || chain.current <= 0) return 'No active chain';
	const maximum = typeof chain.max === 'number' ? ` / ${chain.max.toLocaleString()}` : '';
	const timeout = typeof chain.timeout === 'number' ? `${chain.timeout}s` : 'Unavailable';
	return `${chain.current.toLocaleString()}${maximum} hits; timeout ${timeout}`;
}

function displayMemberStatus(member: TornFactionMember): string {
	const { status } = member;
	if (!status) return 'Unavailable';
	const values = [status.description, status.details, status.state]
		.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
		.map((value) => displayText(value));
	return [...new Set(values)].join(' / ') || 'Unavailable';
}

function displayMemberLastAction(member: TornFactionMember): string {
	const lastAction = member.last_action;
	if (!lastAction) return 'Unavailable';
	const timestamp = displayTimestamp(lastAction.timestamp);
	if (timestamp !== 'Unavailable') return `${timestamp} (${displayText(lastAction.status)})`;
	return displayText(lastAction.relative ?? lastAction.status);
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

function displayWar(war: TornFactionWar): string {
	const factions = war.factions.map((faction) => {
		const name = displayText(faction.name, typeof faction.id === 'number' ? `Faction ${faction.id}` : 'Faction');
		const score = typeof faction.score === 'number' ? ` ${faction.score.toLocaleString()}` : '';
		return `${name}${score}`;
	});
	const territory = war.territory ? ` - ${displayText(war.territory)}` : '';
	const status = war.end === null ? ' (ongoing)' : typeof war.end === 'number' ? ` (ended <t:${war.end}:d>)` : '';
	return `${war.kind}${territory}${status}: ${factions.length > 0 ? factions.join(' vs ') : 'Details unavailable'}`;
}

function displayPact(pact: TornFactionOverview['pacts'][number]): string {
	const name = displayText(pact.factionName, typeof pact.factionId === 'number' ? `Faction ${pact.factionId}` : 'Faction');
	return `${name} - until ${displayTimestamp(pact.until)}`;
}

function buildRosterLine(member: TornFactionMember): string {
	return `**${displayText(member.name)}** (ID ${member.id}) | ${displayText(member.position)} | Level ${
		member.level
	}\nStatus: ${displayMemberStatus(member)} | Last action: ${displayMemberLastAction(member)}`;
}

export function buildTornFactionInfoEmbeds(overview: TornFactionOverview): EmbedBuilder[] {
	const { basic } = overview;
	const leader = overview.members.find((member) => member.id === basic.leader_id);
	const title = `${displayText(basic.name, 'Torn faction')}${basic.tag ? ` [${displayText(basic.tag)}]` : ''}`;
	const fields = [
		{
			name: 'Faction details',
			value: [
				`Leader: ${leader ? `${displayText(leader.name)} (ID ${leader.id})` : `Unavailable (ID ${basic.leader_id})`}`,
				`Members: ${basic.members.toLocaleString()}`,
				`Respect: ${basic.respect.toLocaleString()}`,
				`Age: ${basic.days_old.toLocaleString()} days`,
				`Best chain: ${basic.best_chain.toLocaleString()}`
			].join('\n'),
			inline: true
		},
		{ name: 'Current chain', value: displayChain(overview.chain), inline: true },
		...chunkLines(
			overview.territories.map((territory) => displayText(territory)),
			800
		).map((page, index, pages) => ({
			name: `Territories${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ''}`,
			value: page.join(', ')
		})),
		...chunkLines([...overview.wars.map(displayWar), ...overview.pacts.map((pact) => `Pact: ${displayPact(pact)}`)], 800).map(
			(page, index, pages) => ({
				name: `Wars and pacts${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ''}`,
				value: page.join('\n')
			})
		),
		{
			name: 'War History Summary',
			value: [
				`Current Rank: ${displayText(overview.warHistorySummary.currentRank)}`,
				`Wars Won: ${overview.warHistorySummary.warsWon.toLocaleString()}`,
				`Wars Lost: ${overview.warHistorySummary.warsLost.toLocaleString()}`
			].join('\n')
		}
	];
	if (overview.territories.length === 0) fields.push({ name: 'Territories', value: 'None', inline: false });
	if (overview.wars.length === 0 && overview.pacts.length === 0) {
		fields.push({ name: 'Wars and pacts', value: 'None', inline: false });
	}

	const embeds: EmbedBuilder[] = [];
	for (let index = 0; index < fields.length; index += 5) {
		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle(title)
			.setURL(`https://www.torn.com/factions.php?step=profile&ID=${basic.id}`)
			.addFields(fields.slice(index, index + 5));
		if (index === 0) {
			embed.setDescription(`Faction ID: ${basic.id}`).setTimestamp();
		}
		embeds.push(embed);
	}
	return embeds;
}

export function buildTornFactionMemberEmbeds(overview: TornFactionOverview): EmbedBuilder[] {
	const { basic } = overview;
	const factionTitle = `${displayText(basic.name, 'Torn faction')}${basic.tag ? ` [${displayText(basic.tag)}]` : ''}`;
	const rosterLines = overview.members.map(buildRosterLine);
	const rosterPages = chunkLines(rosterLines);
	const factionUrl = `https://www.torn.com/factions.php?step=profile&ID=${basic.id}`;
	if (rosterPages.length > 0) {
		return rosterPages.map((page, index) =>
			new EmbedBuilder()
				.setColor(0x5865f2)
				.setTitle(
					`Faction roster for ${factionTitle} (${overview.members.length} members)${
						rosterPages.length > 1 ? ` - ${index + 1}/${rosterPages.length}` : ''
					}`
				)
				.setURL(factionUrl)
				.setDescription(page.join('\n\n'))
		);
	}

	return [
		new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle(`Faction roster for ${factionTitle}`)
			.setURL(factionUrl)
			.setDescription('No members were returned.')
	];
}
