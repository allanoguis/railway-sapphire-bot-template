const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('exits with a clear error when DISCORD_TOKEN is missing', () => {
	const result = spawnSync(process.execPath, ['dist/index.js'], {
		encoding: 'utf8',
		env: { ...process.env, DISCORD_TOKEN: '' }
	});

	assert.equal(result.status, 1);
	assert.match(`${result.stdout}\n${result.stderr}`, /Missing required environment variable: DISCORD_TOKEN/);
});
