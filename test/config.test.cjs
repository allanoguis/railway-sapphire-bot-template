const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadConfig } = require('../dist/config.js');

test('requires a non-blank Discord token', () => {
	for (const value of [undefined, '', ' \t ']) {
		assert.throws(() => loadConfig({ DISCORD_TOKEN: value }), /DISCORD_TOKEN/);
	}
});

test('trims the Discord token before returning config', () => {
	assert.deepEqual(loadConfig({ DISCORD_TOKEN: ' token-value ' }), { discordToken: 'token-value' });
});
