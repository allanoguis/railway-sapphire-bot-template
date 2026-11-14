const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getTornProfile, pairTornAccount, unpairTornAccount, verifyTornAccount } = require('../dist/features/torn/service.js');

function createStorage() {
	const values = new Map();
	return {
		values,
		async get(scope, key) {
			return values.get(`${scope}:${key}`);
		},
		async set(scope, key, value) {
			values.set(`${scope}:${key}`, structuredClone(value));
		},
		async delete(scope, key) {
			return values.delete(`${scope}:${key}`);
		}
	};
}

test('links Torn keys encrypted to the Discord user and fetches that user profile without an ID', async () => {
	const originalFetch = global.fetch;
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	const apiKey = 'a'.repeat(16);
	const discordUserId = 'discord-user-1';
	const storage = createStorage();
	process.env.TORN_ENCRYPTION_KEY = 'ab'.repeat(32);

	try {
		global.fetch = async (input) => {
			const url = new URL(input);
			if (url.searchParams.get('selections') === 'basic') {
				assert.equal(url.searchParams.get('key'), apiKey);
				return { ok: true, json: async () => ({ player_id: 123, name: 'Profile Owner' }) };
			}

			assert.equal(url.pathname, '/user/');
			assert.equal(url.searchParams.get('key'), apiKey);
			return {
				ok: true,
				json: async () => ({
					player_id: 123,
					name: 'Profile Owner',
					level: 50,
					energy: { current: 100, maximum: 100 }
				})
			};
		};

		assert.deepEqual(await pairTornAccount(storage, discordUserId, apiKey), { playerId: 123, name: 'Profile Owner' });
		const credential = storage.values.get('user:discord-user-1:torn-api-credential');
		assert.equal(credential.playerId, 123);
		assert.notEqual(credential.ciphertext, apiKey);
		assert.equal(JSON.stringify(credential).includes(apiKey), false);

		const result = await getTornProfile(storage, discordUserId);
		assert.equal(result.isLinkedProfile, true);
		assert.equal(result.profile.name, 'Profile Owner');

		credential.authTag = Buffer.alloc(16).toString('base64');
		await assert.rejects(getTornProfile(storage, discordUserId), /could not be decrypted/);
	} finally {
		global.fetch = originalFetch;
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});

test('allows public profile lookup without database configuration', async () => {
	const originalFetch = global.fetch;
	const previousApiKey = process.env.TORN_API_KEY;
	const apiKey = 'b'.repeat(16);
	process.env.TORN_API_KEY = apiKey;

	try {
		global.fetch = async (input) => {
			const url = new URL(input);
			assert.equal(url.pathname, '/user/123');
			assert.equal(url.searchParams.get('key'), apiKey);
			return { ok: true, json: async () => ({ player_id: 123, name: 'Public Profile' }) };
		};

		const result = await getTornProfile(null, 'discord-user-1', 123);
		assert.equal(result.isLinkedProfile, false);
		assert.equal(result.profile.name, 'Public Profile');
		await assert.rejects(getTornProfile(null, 'discord-user-1'), /bot administrator/);
	} finally {
		global.fetch = originalFetch;
		if (previousApiKey === undefined) delete process.env.TORN_API_KEY;
		else process.env.TORN_API_KEY = previousApiKey;
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
	await storage.set('user:discord-user-1', 'torn-api-credential', { playerId: 123 });
	await storage.set('user:discord-user-2', 'torn-api-credential', { playerId: 456 });

	assert.equal(await unpairTornAccount(storage, 'discord-user-1'), true);
	assert.equal(await unpairTornAccount(storage, 'discord-user-1'), false);
	assert.equal(storage.values.has('user:discord-user-2:torn-api-credential'), true);
});
