const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getTornFactionOrganizedCrimes } = require('../dist/features/torn/faction-oc.js');
const { pairTornAccount } = require('../dist/features/torn/service.js');

const apiKey = 'f'.repeat(16);
const discordUserId = 'discord-user-faction-oc';

function createStorage() {
	const values = new Map();
	return {
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

function createCrime(id, status) {
	return {
		id,
		name: `Crime ${id}`,
		status,
		slots: [
			{
				position: 'Thief',
				position_info: { id: 'P1', label: 'Thief' },
				item_requirement: { id: 556, is_reusable: true, is_available: false },
				user: { id: 2000 + id, joined_at: 1_700_000_000, progress: 0.5 }
			}
		]
	};
}

test('retrieves all available faction crimes across pages using the caller paired key', async () => {
	const originalFetch = global.fetch;
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	const storage = createStorage();
	const requests = [];
	const firstPageCrimes = Array.from({ length: 20 }, (_, index) => createCrime(index + 1, index === 0 ? 'Recruiting' : 'Planning'));
	process.env.TORN_ENCRYPTION_KEY = 'ab'.repeat(32);

	try {
		global.fetch = async (input) => {
			const url = new URL(input);
			assert.equal(url.origin, 'https://api.torn.com');
			assert.equal(url.searchParams.get('key'), apiKey);
			requests.push(url);

			if (url.pathname === '/v2/user/basic') return { ok: true, json: async () => ({ profile: { id: 123, name: 'Faction Leader' } }) };
			if (url.pathname === '/v2/user/faction')
				return { ok: true, json: async () => ({ faction: { id: 456, name: 'The Retreat', tag: 'RT' } }) };
			if (url.pathname !== '/v2/faction/crimes') throw new Error(`Unexpected Torn API request: ${url.pathname}`);

			assert.equal(url.searchParams.get('cat'), 'available');
			assert.equal(url.searchParams.get('limit'), '20');
			if (url.searchParams.get('offset') === '0') {
				return {
					ok: true,
					json: async () => ({
						crimes: firstPageCrimes,
						_metadata: { links: { next: 'https://api.torn.com/v2/faction/crimes?cat=available&limit=20&offset=20' } }
					})
				};
			}
			assert.equal(url.searchParams.get('offset'), '20');
			return { ok: true, json: async () => ({ crimes: [createCrime(21, 'Planning')] }) };
		};

		await pairTornAccount(storage, discordUserId, apiKey);
		const result = await getTornFactionOrganizedCrimes(storage, discordUserId);
		const crimeRequests = requests.filter((url) => url.pathname === '/v2/faction/crimes');

		assert.equal(crimeRequests.length, 2);
		assert.deepEqual(result.faction, { id: 456, name: 'The Retreat', tag: 'RT' });
		assert.equal(result.crimes.length, 21);
		assert.equal(result.crimes[0].status, 'Recruiting');
		assert.equal(result.crimes[0].slots[0].positionInfo.label, 'Thief');
		assert.equal(result.crimes[0].slots[0].itemRequirement.isAvailable, false);
		assert.equal(result.crimes[0].slots[0].user.id, 2001);
		assert.equal(result.crimes[20].id, 21);
		assert.equal('apiKey' in result, false);
	} finally {
		global.fetch = originalFetch;
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});

test('returns an empty crime list when Torn reports no available crimes', async () => {
	const originalFetch = global.fetch;
	const previousEncryptionKey = process.env.TORN_ENCRYPTION_KEY;
	const storage = createStorage();
	process.env.TORN_ENCRYPTION_KEY = 'cd'.repeat(32);

	try {
		global.fetch = async (input) => {
			const url = new URL(input);
			if (url.pathname === '/v2/user/basic') return { ok: true, json: async () => ({ profile: { id: 123 } }) };
			if (url.pathname === '/v2/user/faction') return { ok: true, json: async () => ({ faction: { id: 456 } }) };
			assert.equal(url.pathname, '/v2/faction/crimes');
			assert.equal(url.searchParams.get('cat'), 'available');
			return { ok: true, json: async () => ({ crimes: [] }) };
		};

		await pairTornAccount(storage, discordUserId, apiKey);
		const result = await getTornFactionOrganizedCrimes(storage, discordUserId);
		assert.deepEqual(result.crimes, []);
	} finally {
		global.fetch = originalFetch;
		if (previousEncryptionKey === undefined) delete process.env.TORN_ENCRYPTION_KEY;
		else process.env.TORN_ENCRYPTION_KEY = previousEncryptionKey;
	}
});
