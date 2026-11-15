const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PairCommand } = require('../dist/commands/pair.js');
const { getTornProfile, pairTornAccount, unpairTornAccount, verifyTornAccount } = require('../dist/features/torn/service.js');
const { buildTornProfileEmbed } = require('../dist/features/torn/presentation.js');

function createStorage() {
	const values = new Map();
	return {
		values,
		async getTornApi(discordId) {
			return values.get(discordId);
		},
		async setTornApi(discordId, value) {
			values.set(discordId, structuredClone(value));
		},
		async deleteTornApi(discordId) {
			return values.delete(discordId);
		}
	};
}

test('/pair acknowledges immediately and replies with the private pairing disclosure', async () => {
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	process.env.TORN_ENCRYPTION_KEY = 'ab'.repeat(32);
	const command = Object.create(PairCommand.prototype);
	Object.defineProperty(command, 'container', {
		value: { storage: {}, logger: { debug() {}, error() {} } }
	});
	const calls = [];
	const interaction = {
		user: { id: 'discord-user-1' },
		deferred: false,
		replied: false,
		async deferReply(options) {
			calls.push(['defer', options]);
			this.deferred = true;
		},
		async editReply(payload) {
			calls.push(['edit', payload]);
			return payload;
		}
	};

	try {
		const response = await command.chatInputRun(interaction);

		assert.equal(calls[0][0], 'defer');
		assert.deepEqual(calls[0][1], { flags: 'Ephemeral' });
		assert.equal(calls[1][0], 'edit');
		assert.equal(response.embeds.length, 1);
		assert.equal(response.components.length, 1);
	} finally {
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});

test("pairs Torn keys to the Discord user and uses that user's key for profile requests", async () => {
	const originalFetch = global.fetch;
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	const apiKey = 'a'.repeat(16);
	const discordUserId = 'discord-user-1';
	const storage = createStorage();
	process.env.TORN_ENCRYPTION_KEY = 'ab'.repeat(32);

	try {
		global.fetch = async (input) => {
			const url = new URL(input);
			assert.equal(url.origin, 'https://api.torn.com');
			assert.equal(url.searchParams.get('key'), apiKey);
			assert.equal(url.searchParams.has('selections'), false);

			if (url.pathname === '/v2/user/basic') {
				assert.equal(url.searchParams.has('id'), false);
				return { ok: true, json: async () => ({ profile: { id: 123, name: 'Profile Owner' } }) };
			}
			if (url.pathname === '/v2/user/faction' && url.searchParams.get('id') === '456') {
				return {
					ok: true,
					json: async () => ({
						faction: {
							id: 57494,
							name: 'The Retreat',
							tag: 'RT',
							tag_image: '57494-55833.png',
							position: 'Intelligence Officer',
							days_in_faction: 75
						}
					})
				};
			}
			if (url.pathname === '/v2/user/faction' && url.searchParams.get('id') === '789') {
				return {
					ok: true,
					json: async () => ({
						faction: {
							id: 0,
							name: 'None',
							tag: null,
							tag_image: null,
							position: 'None',
							days_in_faction: 0
						}
					})
				};
			}
			if (url.pathname === '/v2/user/faction') {
				assert.equal(url.searchParams.has('id'), false);
				return {
					ok: true,
					json: async () => ({
						faction: {
							id: 57494,
							name: 'The Retreat',
							tag: 'RT',
							tag_image: '57494-55833.png',
							position: 'Intelligence Officer',
							days_in_faction: 75
						}
					})
				};
			}
			if (url.pathname === '/v2/user/profile' && url.searchParams.get('id') === '456') {
				return { ok: true, json: async () => ({ profile: { player_id: 456, name: 'Other Profile' } }) };
			}
			if (url.pathname === '/v2/user/profile' && url.searchParams.get('id') === '789') {
				return { ok: true, json: async () => ({ profile: { player_id: 789, name: 'Unaffiliated Profile' } }) };
			}
			if (url.pathname === '/v2/user/profile') {
				assert.equal(url.searchParams.has('id'), false);
				return {
					ok: true,
					json: async () => ({
						profile: {
							player_id: 123,
							name: 'Profile Owner',
							level: 50
						}
					})
				};
			}
			if (url.pathname === '/v2/user/bars') {
				return {
					ok: true,
					json: async () => ({
						bars: {
							energy: { current: 100, maximum: 100 },
							nerve: { current: 50, maximum: 50 },
							happy: { current: 500, maximum: 500 },
							life: { current: 1000, maximum: 1000 }
						}
					})
				};
			}
			if (url.pathname === '/v2/user/cooldowns') {
				return { ok: true, json: async () => ({ cooldowns: { drug: 0, medical: 0, booster: 0 } }) };
			}
			if (url.pathname === '/v2/user/battlestats') {
				return {
					ok: true,
					json: async () => ({
						battlestats: {
							strength: { value: 10, modifier: 0 },
							defense: { value: 20, modifier: 0 },
							speed: { value: 30, modifier: 0 },
							dexterity: { value: 40, modifier: 0 },
							total: 100
						}
					})
				};
			}
			assert.fail(`Unexpected Torn API request: ${url.pathname}`);
		};

		assert.deepEqual(await pairTornAccount(storage, discordUserId, apiKey), { playerId: 123, name: 'Profile Owner' });
		const credential = storage.values.get('discord-user-1');
		assert.equal(credential.playerId, 123);
		assert.notEqual(credential.ciphertext, apiKey);
		assert.equal(JSON.stringify(credential).includes(apiKey), false);

		const result = await getTornProfile(storage, discordUserId);
		assert.equal(result.isLinkedProfile, true);
		assert.equal(result.profile.name, 'Profile Owner');
		assert.equal(result.profile.energy.current, 100);
		assert.equal(result.profile.cooldowns.drug, 0);
		assert.equal(result.profile.battlestats.strength, 10);
		assert.deepEqual(result.profile.faction, {
			id: 57494,
			name: 'The Retreat',
			tag: 'RT',
			tag_image: '57494-55833.png',
			position: 'Intelligence Officer',
			days_in_faction: 75
		});
		const profileEmbed = buildTornProfileEmbed(result.profile, result.isLinkedProfile).toJSON();
		assert.equal(
			profileEmbed.fields.find((field) => field.name === 'Faction').value,
			'Id: 57494\nName: The Retreat\nPosition: Intelligence Officer\nDays in faction: 75'
		);

		const ownProfileById = await getTornProfile(storage, discordUserId, 123);
		assert.equal(ownProfileById.isLinkedProfile, true);
		assert.equal(ownProfileById.profile.name, 'Profile Owner');
		assert.equal(
			buildTornProfileEmbed(ownProfileById.profile, ownProfileById.isLinkedProfile)
				.toJSON()
				.fields.some((field) => field.name === 'Battle Stats'),
			true
		);

		const otherProfile = await getTornProfile(storage, discordUserId, 456);
		assert.equal(otherProfile.isLinkedProfile, false);
		assert.equal(otherProfile.profile.name, 'Other Profile');
		assert.deepEqual(otherProfile.profile.faction, result.profile.faction);
		assert.equal(otherProfile.profile.battlestats, undefined);
		assert.equal(otherProfile.profile.strength, undefined);
		const otherProfileEmbed = buildTornProfileEmbed(otherProfile.profile, otherProfile.isLinkedProfile).toJSON();
		assert.equal(
			otherProfileEmbed.fields.find((field) => field.name === 'Faction').value,
			'Id: 57494\nName: The Retreat\nPosition: Intelligence Officer\nDays in faction: 75'
		);
		assert.equal(
			otherProfileEmbed.fields.some((field) => field.name === 'Battle Stats'),
			false
		);

		const unaffiliatedProfile = await getTornProfile(storage, discordUserId, 789);
		assert.equal(unaffiliatedProfile.profile.faction, undefined);
		assert.equal(
			buildTornProfileEmbed(unaffiliatedProfile.profile, unaffiliatedProfile.isLinkedProfile)
				.toJSON()
				.fields.find((field) => field.name === 'Faction').value,
			'None'
		);

		credential.authTag = Buffer.alloc(16).toString('base64');
		await assert.rejects(getTornProfile(storage, discordUserId), /could not be decrypted/);
	} finally {
		global.fetch = originalFetch;
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});

test('requires a paired user key for player ID profile requests', async () => {
	const previousApiKey = process.env.TORN_API_KEY;
	process.env.TORN_API_KEY = 'b'.repeat(16);

	try {
		await assert.rejects(getTornProfile(createStorage(), 'discord-user-1', 123), /Pair your Torn API key/);
		await assert.rejects(getTornProfile(null, 'discord-user-1', 123), /bot administrator/);
	} finally {
		if (previousApiKey === undefined) delete process.env.TORN_API_KEY;
		else process.env.TORN_API_KEY = previousApiKey;
	}
});

test('surfaces Torn API key errors from non-success HTTP responses without storing the key', async () => {
	const originalFetch = global.fetch;
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	const storage = createStorage();
	process.env.TORN_ENCRYPTION_KEY = 'ef'.repeat(32);

	try {
		global.fetch = async () => ({
			ok: false,
			json: async () => ({ error: { code: 2 } })
		});

		await assert.rejects(pairTornAccount(storage, 'discord-user-3', 'd'.repeat(16)), /API key was rejected/);
		assert.equal(storage.values.has('discord-user-3'), false);
	} finally {
		global.fetch = originalFetch;
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});

test('verify revalidates a paired Torn key and reports when no key is paired', async () => {
	const originalFetch = global.fetch;
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	const apiKey = 'c'.repeat(16);
	const discordUserId = 'discord-user-2';
	const storage = createStorage();
	let requestCount = 0;
	let rejectNextRequest = false;
	process.env.TORN_ENCRYPTION_KEY = 'cd'.repeat(32);

	try {
		global.fetch = async (input) => {
			const url = new URL(input);
			assert.equal(url.pathname, '/v2/user/basic');
			assert.equal(url.searchParams.has('selections'), false);
			assert.equal(url.searchParams.get('key'), apiKey);
			requestCount += 1;
			if (rejectNextRequest) {
				return { ok: true, json: async () => ({ error: { code: 1 } }) };
			}
			return { ok: true, json: async () => ({ profile: { id: 456, name: 'Paired Profile' } }) };
		};

		assert.equal(await verifyTornAccount(storage, discordUserId), undefined);
		assert.equal(requestCount, 0);

		await pairTornAccount(storage, discordUserId, apiKey);
		assert.deepEqual(await verifyTornAccount(storage, discordUserId), { playerId: 456, name: 'Paired Profile' });
		assert.equal(requestCount, 2);

		rejectNextRequest = true;
		await assert.rejects(verifyTornAccount(storage, discordUserId), /API key was rejected/);
	} finally {
		global.fetch = originalFetch;
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});

test("unpair deletes only the requesting Discord user's credential", async () => {
	const storage = createStorage();
	await storage.setTornApi('discord-user-1', { playerId: 123 });
	await storage.setTornApi('discord-user-2', { playerId: 456 });

	assert.equal(await unpairTornAccount(storage, 'discord-user-1'), true);
	assert.equal(await unpairTornAccount(storage, 'discord-user-1'), false);
	assert.equal(storage.values.has('discord-user-2'), true);
});
