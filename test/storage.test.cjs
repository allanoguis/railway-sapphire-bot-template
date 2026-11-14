const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadConfig } = require('../dist/config.js');
const { PostgresStorage } = require('../dist/lib/postgres-storage.js');

function createPool(results = []) {
	const calls = [];
	let endCalls = 0;
	return {
		calls,
		get endCalls() {
			return endCalls;
		},
		async query(sql, values) {
			calls.push({ sql, values });
			return results.shift() ?? { rows: [], rowCount: 0 };
		},
		async end() {
			endCalls += 1;
		}
	};
}

test('accepts PostgreSQL URLs and rejects other database URL schemes', () => {
	assert.equal(
		loadConfig({ DISCORD_TOKEN: 'token', DATABASE_URL: 'postgresql://user:password@localhost/bot' }).databaseUrl,
		'postgresql://user:password@localhost/bot'
	);
	assert.throws(() => loadConfig({ DISCORD_TOKEN: 'token', DATABASE_URL: 'https://example.test/db' }), /DATABASE_URL must use the postgres/);
});

test('initializes verified_users and migrates legacy per-user Torn credentials', async () => {
	const pool = createPool([
		{ rows: [], rowCount: 0 },
		{ rows: [], rowCount: 0 },
		{ rows: [{ legacy_settings_remain: false }], rowCount: 1 },
		{ rows: [{ torn_api: { enabled: true } }], rowCount: 1 }
	]);
	const storage = new PostgresStorage(pool);

	assert.equal(await storage.initialize(), false);
	const value = await storage.getTornApi('discord-123');

	assert.match(pool.calls[0].sql, /CREATE TABLE IF NOT EXISTS verified_users/);
	assert.match(pool.calls[0].sql, /discord_id TEXT PRIMARY KEY/);
	assert.match(pool.calls[0].sql, /torn_api JSONB NOT NULL/);
	assert.match(pool.calls[1].sql, /INSERT INTO verified_users/);
	assert.match(pool.calls[1].sql, /FROM bot_settings/);
	assert.match(pool.calls[1].sql, /DROP TABLE bot_settings/);
	assert.deepEqual(pool.calls[3].values, ['discord-123']);
	assert.deepEqual(value, { enabled: true });
});

test('reports when unrelated legacy settings are retained', async () => {
	const pool = createPool([
		{ rows: [], rowCount: 0 },
		{ rows: [], rowCount: 0 },
		{ rows: [{ legacy_settings_remain: true }], rowCount: 1 }
	]);
	const storage = new PostgresStorage(pool);

	assert.equal(await storage.initialize(), true);
	assert.match(pool.calls[1].sql, /setting_key <> 'torn-api-credential'/);
});

test('reads a verified-user Torn credential by Discord ID', async () => {
	const pool = createPool([{ rows: [{ torn_api: { ciphertext: 'encrypted' } }], rowCount: 1 }]);
	const storage = new PostgresStorage(pool);

	const value = await storage.getTornApi('discord-123');
	assert.deepEqual(value, { ciphertext: 'encrypted' });
	assert.match(pool.calls[0].sql, /FROM verified_users WHERE discord_id = \$1/);
	assert.deepEqual(pool.calls[0].values, ['discord-123']);
});

test('upserts JSON credentials with parameterized SQL', async () => {
	const pool = createPool();
	const storage = new PostgresStorage(pool);

	await storage.setTornApi('discord-123', { ciphertext: 'encrypted' });

	assert.match(pool.calls[0].sql, /ON CONFLICT \(discord_id\)/);
	assert.deepEqual(pool.calls[0].values, ['discord-123', '{"ciphertext":"encrypted"}']);
});

test('deletes verified-user credentials and reports whether a row was removed', async () => {
	const pool = createPool([
		{ rows: [], rowCount: 1 },
		{ rows: [], rowCount: 0 }
	]);
	const storage = new PostgresStorage(pool);

	assert.equal(await storage.deleteTornApi('discord-123'), true);
	assert.equal(await storage.deleteTornApi('discord-456'), false);
});

test('closes the PostgreSQL pool once', async () => {
	const pool = createPool();
	const storage = new PostgresStorage(pool);

	await storage.close();
	await storage.close();

	assert.equal(pool.endCalls, 1);
});
