const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createShutdownHandler } = require('../dist/lib/shutdown.js');

function createLogger() {
	return {
		errors: [],
		infoMessages: [],
		error(...values) {
			this.errors.push(values);
		},
		info(message) {
			this.infoMessages.push(message);
		}
	};
}

test('destroys the client once and sets a successful exit code', async () => {
	let destroyCalls = 0;
	const exitCodes = [];
	const logger = createLogger();
	const shutdown = createShutdownHandler(
		{
			destroy: async () => {
				destroyCalls += 1;
			}
		},
		logger,
		(code) => exitCodes.push(code)
	);

	await Promise.all([shutdown('SIGINT'), shutdown('SIGTERM')]);

	assert.equal(destroyCalls, 1);
	assert.deepEqual(exitCodes, [0]);
	assert.equal(logger.infoMessages.length, 1);
});

test('logs destroy failures and sets a failing exit code', async () => {
	const failure = new Error('destroy failed');
	const exitCodes = [];
	const logger = createLogger();
	const shutdown = createShutdownHandler(
		{
			destroy: async () => {
				throw failure;
			}
		},
		logger,
		(code) => exitCodes.push(code)
	);

	await shutdown('SIGTERM');

	assert.deepEqual(exitCodes, [1]);
	assert.equal(logger.errors[0][0], failure);
});
