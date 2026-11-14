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
			if (url.pathname === '/user/' && url.searchParams.get('selections') === 'basic') {
				assert.equal(url.searchParams.get('key'), apiKey);
				return { ok: true, json: async () => ({ player_id: 123, name: 'Profile Owner' }) };
			}

			assert.equal(url.searchParams.get('key'), apiKey);
			if (url.pathname === '/user/') {
				assert.equal(url.searchParams.get('selections'), 'basic,profile,bars,cooldowns,battlestats');
				return {
					ok: true,
					json: async () => ({
						player_id: 123,
						name: 'Profile Owner',
						level: 50,
						energy: { current: 100, maximum: 100 },
						battlestats: { strength: 10, defense: 20, speed: 30, dexterity: 40, total: 100 }
					})
				};
			}

			assert.equal(url.pathname, '/user/456');
			assert.equal(url.searchParams.get('selections'), 'basic,profile');
			return {
				ok: true,
				json: async () => ({
					player_id: 456,
					name: 'Other Profile',
					battlestats: { strength: 10, defense: 20, speed: 30, dexterity: 40, total: 100 },
					strength: 10,
					defense: 20,
					speed: 30,
					dexterity: 40,
					total: 100
				})
			};
		};

		assert.deepEqual(await pairTornAccount(storage, discordUserId, apiKey), { playerId: 123, name: 'Profile Owner' });
		const credential = storage.values.get('discord-user-1');
		assert.equal(credential.playerId, 123);
		assert.notEqual(credential.ciphertext, apiKey);
		assert.equal(JSON.stringify(credential).includes(apiKey), false);

		const result = await getTornProfile(storage, discordUserId);
		assert.equal(result.isLinkedProfile, true);
		assert.equal(result.profile.name, 'Profile Owner');

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
		assert.equal(otherProfile.profile.battlestats, undefined);
		assert.equal(otherProfile.profile.strength, undefined);
		const otherProfileEmbed = buildTornProfileEmbed(
			{
				player_id: 456,
				name: 'Other Profile',
				battlestats: { strength: 10, defense: 20, speed: 30, dexterity: 40, total: 100 }
			},
			false
		);
		assert.equal(
			otherProfileEmbed.toJSON().fields.some((field) => field.name === 'Battle Stats'),
			false
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
			assert.equal(url.searchParams.get('selections'), 'basic');
			assert.equal(url.searchParams.get('key'), apiKey);
			requestCount += 1;
			if (rejectNextRequest) {
				return { ok: true, json: async () => ({ error: { code: 1 } }) };
			}
			return { ok: true, json: async () => ({ player_id: 456, name: 'Paired Profile' }) };
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
