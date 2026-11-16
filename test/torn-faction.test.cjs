const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadConfig } = require('../dist/config.js');
const { runTornFactionCommand } = require('../dist/commands/torn.js');
const { buildTornFactionInfoEmbeds, buildTornFactionMemberEmbeds } = require('../dist/features/torn/faction.js');
const { getTornFactionOverview, pairTornAccount } = require('../dist/features/torn/service.js');

const apiKey = 'f'.repeat(16);
const discordUserId = 'discord-user-faction';
const channelId = '12345678901234567';
const factionId = 57494;

function createStorage() {
	const values = new Map();
	return {
		values,
		async getTornApi(id) {
			return values.get(id);
		},
		async setTornApi(id, value) {
			values.set(id, structuredClone(value));
		},
		async deleteTornApi(id) {
			return values.delete(id);
		}
	};
}

function createFactionResponses(memberCount = 40) {
	const members = Array.from({ length: memberCount }, (_, index) => ({
		id: 1000 + index,
		name: `Faction Member ${index + 1}`,
		position: index === 0 ? 'Leader' : 'Member',
		level: 50 + index,
		status: { description: 'Okay', details: null, state: 'Okay', until: null, color: 'green' },
		last_action: { status: 'Offline', timestamp: 1_700_000_000 + index, relative: '1 hour ago' },
		days_in_faction: 30,
		is_revivable: true,
		is_on_wall: false,
		is_in_oc: false,
		has_early_discharge: false,
		revive_setting: 'Unknown'
	}));
	members[0].id = 123;
	members[0].name = 'Faction Leader';

	const responses = {
		'/v2/user/basic': { profile: { id: 123, name: 'Faction Leader' } },
		'/v2/user/faction': {
			faction: { id: factionId, name: 'The Retreat', tag: 'RT', tag_image: 'faction-tag.png', position: 'Leader', days_in_faction: 100 }
		},
		'/v2/faction/basic': {
			basic: {
				id: factionId,
				name: 'The Retreat',
				tag: 'RT',
				tag_image: 'faction-tag.png',
				banner_image: '',
				leader_id: 123,
				co_leader_id: 456,
				respect: 123456,
				days_old: 2000,
				capacity: 100,
				members: memberCount,
				is_enlisted: null,
				rank: {},
				best_chain: 321
			}
		},
		'/v2/faction/members': { members },
		'/v2/faction/chain': { chain: { id: 12, current: 42, max: 100, timeout: 600, modifier: 1, cooldown: 0, start: 1, end: 0 } },
		'/v2/faction/wars': {
			pacts: [{ faction_id: 76543, faction_name: 'Allied Faction', until: 1_800_000_000 }],
			wars: {
				ranked: null,
				raids: [],
				territory: [
					{
						war_id: 99,
						territory: 'ABC',
						start: 1_700_000_000,
						end: null,
						target: 100,
						winner: null,
						factions: [
							{ id: factionId, name: 'The Retreat', score: 50, chain: 4, is_aggressor: true, playerIds: [] },
							{ id: 76543, name: 'Rival Faction', score: 25, chain: 1, is_aggressor: false, playerIds: [] }
						]
					}
				]
			}
		},
		'/v2/faction/territory': {
			territory: [{ id: 'ABC', acquired_at: 1, sector: 1, size: 2, density: 3, slots: 4, respect: 5, coordinates: {}, racket: null }]
		}
	};
	return { members, responses };
}

function createInteraction(channel, channelIdValue = channelId) {
	const calls = [];
	const interaction = {
		calls,
		user: { id: discordUserId },
		channelId: channelIdValue,
		channel,
		inGuild: () => true,
		async reply(payload) {
			calls.push(['reply', payload]);
			return payload;
		},
		async deferReply(payload) {
			calls.push(['defer', payload]);
		},
		async editReply(payload) {
			calls.push(['edit', payload]);
			return payload;
		}
	};
	return interaction;
}

test('requires a valid configured channel ID for faction publishing', () => {
	assert.equal(loadConfig({ DISCORD_TOKEN: 'token', TORN_FACTION_CHANNEL_ID: channelId }).tornFactionChannelId, channelId);
	assert.throws(
		() => loadConfig({ DISCORD_TOKEN: 'token', TORN_FACTION_CHANNEL_ID: 'not-a-channel' }),
		/TORN_FACTION_CHANNEL_ID must be a valid Discord channel ID/
	);
});

test('fetches faction details and the full roster using only v2 endpoints and the caller paired key', async () => {
	const originalFetch = global.fetch;
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	const storage = createStorage();
	const { members, responses } = createFactionResponses();
	const requestedPaths = [];
	process.env.TORN_ENCRYPTION_KEY = 'ab'.repeat(32);

	try {
		global.fetch = async (input) => {
			const url = new URL(input);
			assert.equal(url.origin, 'https://api.torn.com');
			assert.equal(url.searchParams.get('key'), apiKey);
			assert.equal(url.searchParams.has('selections'), false);
			requestedPaths.push(url.pathname);
			const payload = responses[url.pathname];
			assert.ok(payload, `Unexpected Torn API request: ${url.pathname}`);
			return { ok: true, json: async () => payload };
		};

		await pairTornAccount(storage, discordUserId, apiKey);
		const overview = await getTornFactionOverview(storage, discordUserId);

		assert.deepEqual(new Set(requestedPaths), new Set(Object.keys(responses)));
		assert.equal(overview.basic.id, factionId);
		assert.equal(overview.basic.leader_id, 123);
		assert.equal(overview.basic.best_chain, 321);
		assert.equal(overview.members.length, members.length);
		assert.equal(overview.members[0].last_action.timestamp, 1_700_000_000);
		assert.equal(overview.chain.current, 42);
		assert.equal(overview.wars[0].territory, 'ABC');
		assert.equal(overview.pacts[0].factionName, 'Allied Faction');
		assert.deepEqual(overview.territories, ['ABC']);

		const infoEmbeds = buildTornFactionInfoEmbeds(overview).map((embed) => embed.toJSON());
		const infoRendered = JSON.stringify(infoEmbeds);
		assert.match(infoRendered, /Faction Leader/);
		assert.match(infoRendered, /Faction ID: 57494/);
		assert.doesNotMatch(infoRendered, /faction-tag\.png/);
		assert.match(infoRendered, /https:\/\/www\.torn\.com\/factions\.php/);
		assert.match(infoRendered, /123,456/);
		assert.match(infoRendered, /Current chain/);
		assert.match(infoRendered, /Territory war - ABC/);
		assert.match(infoRendered, /Allied Faction/);
		assert.doesNotMatch(infoRendered, /Faction Member 2/);

		const memberEmbeds = buildTornFactionMemberEmbeds(overview).map((embed) => embed.toJSON());
		const memberRendered = JSON.stringify(memberEmbeds);
		assert.match(memberRendered, /Faction roster/);
		assert.match(memberRendered, /Status: Okay/);
		assert.match(memberRendered, /<t:1700000000:R>/);
		assert.doesNotMatch(memberRendered, /faction-tag\.png/);
		for (const member of members) assert.ok(memberRendered.includes(member.name), `Missing roster member ${member.name}`);
		assert.doesNotMatch(memberRendered, /Respect/);
		assert.ok(memberEmbeds.length > 1, 'Expected a large roster to be split across multiple messages.');
	} finally {
		global.fetch = originalFetch;
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});

test('rejects faction commands outside the configured channel without fetching or posting', async () => {
	const interaction = createInteraction(
		{
			isTextBased: () => true,
			async send() {
				assert.fail('Unexpected channel post');
			}
		},
		'98765432109876543'
	);
	const response = await runTornFactionCommand(
		interaction,
		{
			storage: createStorage(),
			tornFactionChannelId: channelId,
			logger: { error() {} }
		},
		'info'
	);

	assert.equal(response.content, 'Use `/torn faction info` or `/torn faction members` in the configured channel.');
	assert.deepEqual(response.flags, 'Ephemeral');
	assert.equal(interaction.calls.length, 1);
	assert.equal(interaction.calls[0][0], 'reply');
});

test('keeps faction publishing disabled when no destination channel is configured', async () => {
	const interaction = createInteraction({
		isTextBased: () => true,
		async send() {
			assert.fail('Unexpected channel post');
		}
	});
	const response = await runTornFactionCommand(
		interaction,
		{
			storage: createStorage(),
			tornFactionChannelId: undefined,
			logger: { error() {} }
		},
		'info'
	);

	assert.equal(response.content, 'The faction command is not configured by the bot administrator.');
	assert.equal(interaction.calls.length, 1);
	assert.equal(interaction.calls[0][0], 'reply');
});

test('posts faction info and member roster separately in the configured channel', async () => {
	const originalFetch = global.fetch;
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	const storage = createStorage();
	const { responses } = createFactionResponses(40);
	const posted = [];
	const channel = {
		isTextBased: () => true,
		async send(payload) {
			posted.push(payload);
		}
	};
	const interaction = createInteraction(channel);
	process.env.TORN_ENCRYPTION_KEY = 'cd'.repeat(32);

	try {
		global.fetch = async (input) => {
			const url = new URL(input);
			const payload = responses[url.pathname];
			assert.ok(payload, `Unexpected Torn API request: ${url.pathname}`);
			return { ok: true, json: async () => payload };
		};
		await pairTornAccount(storage, discordUserId, apiKey);

		const infoInteraction = createInteraction(channel);
		const infoResponse = await runTornFactionCommand(
			infoInteraction,
			{
				storage,
				tornFactionChannelId: channelId,
				logger: { error() {} }
			},
			'info'
		);

		assert.equal(posted.length, 1);
		assert.match(JSON.stringify(posted), /Faction details/);
		assert.doesNotMatch(JSON.stringify(posted), /Faction roster/);
		assert.doesNotMatch(JSON.stringify(posted), /faction-tag\.png/);
		assert.match(infoResponse, /Posted faction information/);
		assert.equal(infoInteraction.calls[0][0], 'defer');
		assert.deepEqual(infoInteraction.calls[0][1], { flags: 'Ephemeral' });
		assert.equal(infoInteraction.calls[1][0], 'edit');

		posted.length = 0;
		const membersInteraction = createInteraction(channel);
		const membersResponse = await runTornFactionCommand(
			membersInteraction,
			{
				storage,
				tornFactionChannelId: channelId,
				logger: { error() {} }
			},
			'members'
		);

		assert.ok(posted.length > 1);
		assert.ok(posted.every((message) => message.allowedMentions.parse.length === 0));
		assert.ok(posted.every((message) => message.embeds[0].data.title.includes('Faction roster')));
		assert.doesNotMatch(JSON.stringify(posted), /Respect/);
		assert.match(membersResponse, /Posted the faction roster/);
		assert.equal(membersInteraction.calls[0][0], 'defer');
		assert.deepEqual(membersInteraction.calls[0][1], { flags: 'Ephemeral' });
		assert.equal(membersInteraction.calls[1][0], 'edit');
	} finally {
		global.fetch = originalFetch;
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});

test('reports an unpaired account without posting faction data', async () => {
	const channel = {
		isTextBased: () => true,
		async send() {
			assert.fail('Unexpected channel post');
		}
	};
	const interaction = createInteraction(channel);

	const response = await runTornFactionCommand(
		interaction,
		{
			storage: createStorage(),
			tornFactionChannelId: channelId,
			logger: { error() {} }
		},
		'info'
	);

	assert.match(response, /Pair your Torn API key with `\/pair`/);
	assert.equal(interaction.calls.length, 2);
	assert.equal(interaction.calls[0][0], 'defer');
	assert.equal(interaction.calls[1][0], 'edit');
});

test('reports when the paired Torn account has no faction', async () => {
	const originalFetch = global.fetch;
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	const storage = createStorage();
	let factionRequests = 0;
	process.env.TORN_ENCRYPTION_KEY = 'ef'.repeat(32);

	try {
		global.fetch = async (input) => {
			const url = new URL(input);
			if (url.pathname === '/v2/user/basic') {
				return { ok: true, json: async () => ({ profile: { id: 123, name: 'Unaffiliated Player' } }) };
			}
			if (url.pathname === '/v2/user/faction') {
				factionRequests += 1;
				return { ok: true, json: async () => ({ faction: null }) };
			}
			assert.fail(`Faction details should not be requested without membership: ${url.pathname}`);
		};
		await pairTornAccount(storage, discordUserId, apiKey);

		await assert.rejects(getTornFactionOverview(storage, discordUserId), /not currently in a faction/);
		assert.equal(factionRequests, 1);
	} finally {
		global.fetch = originalFetch;
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});
