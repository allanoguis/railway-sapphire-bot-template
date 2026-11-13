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

test('initializes the settings table and reads JSON values', async () => {
	const pool = createPool([
		{ rows: [], rowCount: 0 },
		{ rows: [{ value: { enabled: true } }], rowCount: 1 }
	]);
	const storage = new PostgresStorage(pool);

	await storage.initialize();
	const value = await storage.get('guild:123', 'welcome');

	assert.match(pool.calls[0].sql, /CREATE TABLE IF NOT EXISTS bot_settings/);
	assert.deepEqual(pool.calls[1].values, ['guild:123', 'welcome']);
	assert.deepEqual(value, { enabled: true });
});

test('upserts JSON settings with parameterized SQL', async () => {
	const pool = createPool();
	const storage = new PostgresStorage(pool);

	await storage.set('global', 'prefixes', ['!', '?']);

	assert.match(pool.calls[0].sql, /ON CONFLICT \(scope, setting_key\)/);
	assert.deepEqual(pool.calls[0].values, ['global', 'prefixes', '["!","?"]']);
});

test('deletes settings and reports whether a row was removed', async () => {
	const pool = createPool([
		{ rows: [], rowCount: 1 },
		{ rows: [], rowCount: 0 }
	]);
	const storage = new PostgresStorage(pool);

	assert.equal(await storage.delete('guild:123', 'welcome'), true);
	assert.equal(await storage.delete('guild:123', 'missing'), false);
});

test('closes the PostgreSQL pool once', async () => {
	const pool = createPool();
	const storage = new PostgresStorage(pool);

	await storage.close();
	await storage.close();

	assert.equal(pool.endCalls, 1);
});
