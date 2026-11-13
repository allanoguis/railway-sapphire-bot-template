const assert = require('node:assert/strict');
const { test } = require('node:test');
const { reportCommandError } = require('../dist/lib/command-error.js');

function createInteraction({ deferred = false, replied = false } = {}) {
	const interaction = { deferred, replied, followUpCalls: [], replyCalls: [] };
	interaction.followUp = async (response) => interaction.followUpCalls.push(response);
	interaction.reply = async (response) => interaction.replyCalls.push(response);
	return interaction;
}

function createLogger() {
	return {
		errors: [],
		error(...values) {
			this.errors.push(values);
		}
	};
}

test('replies privately to a command error before an interaction response', async () => {
	const interaction = createInteraction();
	const logger = createLogger();

	await reportCommandError(interaction, 'ping', new Error('secret details'), logger);

	assert.equal(interaction.replyCalls.length, 1);
	assert.equal(interaction.replyCalls[0].flags, 'Ephemeral');
	assert.equal(interaction.followUpCalls.length, 0);
	assert.match(interaction.replyCalls[0].content, /error while executing/);
	assert.equal(logger.errors.length, 1);
	assert.match(logger.errors[0][1], /\/ping command failed/);
});

test('follows up privately when the interaction was already acknowledged', async () => {
	const interaction = createInteraction({ replied: true });

	await reportCommandError(interaction, 'ping', new Error('failure'), createLogger());

	assert.equal(interaction.followUpCalls.length, 1);
	assert.equal(interaction.followUpCalls[0].flags, 'Ephemeral');
	assert.equal(interaction.replyCalls.length, 0);
});

test('logs a failed error response without leaking the underlying error', async () => {
	const interaction = createInteraction();
	interaction.reply = async () => {
		throw new Error('interaction expired');
	};
	const logger = createLogger();

	await reportCommandError(interaction, 'ping', new Error('secret details'), logger);

	assert.equal(logger.errors.length, 2);
	assert.match(logger.errors[1][1], /Failed to send an error response/);
});
