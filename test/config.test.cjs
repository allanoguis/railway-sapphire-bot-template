const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadConfig } = require('../dist/config.js');

test('requires a non-blank Discord token', () => {
	for (const value of [undefined, '', ' \t ']) {
		assert.throws(() => loadConfig({ DISCORD_TOKEN: value }), /DISCORD_TOKEN/);
	}
});

test('trims the Discord token before returning config', () => {
	assert.deepEqual(loadConfig({ DISCORD_TOKEN: ' token-value ', COMMAND_COOLDOWN_DELAY_MS: '2000', COMMAND_COOLDOWN_LIMIT: '3' }), {
		discordToken: 'token-value',
		commandCooldownDelayMs: 2000,
		commandCooldownLimit: 3
	});
});

test('rejects invalid command cooldown values', () => {
	assert.throws(
		() => loadConfig({ DISCORD_TOKEN: 'token-value', COMMAND_COOLDOWN_DELAY_MS: '1.5' }),
		/COMMAND_COOLDOWN_DELAY_MS must be a positive integer/
	);
	assert.throws(
		() => loadConfig({ DISCORD_TOKEN: 'token-value', COMMAND_COOLDOWN_LIMIT: '0' }),
		/COMMAND_COOLDOWN_LIMIT must be a positive integer/
	);
});
