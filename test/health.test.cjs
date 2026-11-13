const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { loadConfig } = require('../dist/config.js');
const { closeHealthServer, createHealthServer, listenHealthServer } = require('../dist/lib/health.js');
const { createShutdownHandler } = require('../dist/lib/shutdown.js');

function request(port, path, method = 'GET') {
	return new Promise((resolve, reject) => {
		const outgoing = http.request({ hostname: '127.0.0.1', method, path, port }, (response) => {
			let body = '';
			response.setEncoding('utf8');
			response.on('data', (chunk) => (body += chunk));
			response.on('end', () => resolve({ body, statusCode: response.statusCode }));
		});
		outgoing.on('error', reject);
		outgoing.end();
	});
}

test('serves liveness, readiness, not-found, and method responses', async () => {
	let ready = false;
	const server = createHealthServer(() => ready);

	try {
		await listenHealthServer(server, 0);
		const address = server.address();
		assert.ok(address && typeof address !== 'string');

		assert.equal((await request(address.port, '/healthz')).statusCode, 200);
		assert.equal((await request(address.port, '/readyz')).statusCode, 503);
		ready = true;
		assert.equal((await request(address.port, '/readyz')).statusCode, 200);
		assert.equal((await request(address.port, '/unknown')).statusCode, 404);
		assert.equal((await request(address.port, '/healthz', 'POST')).statusCode, 405);
	} finally {
		await closeHealthServer(server);
	}
});

test('validates the health port from configuration', () => {
	assert.equal(loadConfig({ DISCORD_TOKEN: 'token', PORT: '43123' }).healthPort, 43123);
	assert.throws(() => loadConfig({ DISCORD_TOKEN: 'token', PORT: '70000' }), /PORT must be an integer/);
});

test('closes auxiliary services and the client before a successful shutdown', async () => {
	const closeOrder = [];
	const exitCodes = [];
	const shutdown = createShutdownHandler(
		{ destroy: async () => closeOrder.push('client') },
		{ error() {}, info() {} },
		(code) => exitCodes.push(code),
		async () => closeOrder.push('http')
	);

	await shutdown('SIGTERM');

	assert.deepEqual(closeOrder, ['http', 'client']);
	assert.deepEqual(exitCodes, [0]);
});

test('still destroys the client when auxiliary cleanup fails', async () => {
	let destroyed = false;
	const exitCodes = [];
	const logger = {
		errors: [],
		error(...values) {
			this.errors.push(values);
		},
		info() {}
	};
	const shutdown = createShutdownHandler(
		{
			destroy: async () => {
				destroyed = true;
			}
		},
		logger,
		(code) => exitCodes.push(code),
		async () => {
			throw new Error('server close failed');
		}
	);

	await shutdown('SIGINT');

	assert.equal(destroyed, true);
	assert.deepEqual(exitCodes, [1]);
	assert.equal(logger.errors.length, 1);
});
