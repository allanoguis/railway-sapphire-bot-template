const assert = require('node:assert/strict');
const { test } = require('node:test');
const { formatUptime } = require('../dist/lib/bot-info.js');
const { formatCommandList } = require('../dist/lib/command-list.js');

test('lists slash commands in a stable order and omits message-only commands', () => {
	const commands = [
		{ name: 'ping', description: 'Pong.', chatInputRun() {} },
		{ name: 'say', description: 'Message command only.' },
		{ name: 'about', description: 'Bot details.', chatInputRun() {} }
	];

	assert.equal(formatCommandList(commands), '/about - Bot details.\n/ping - Pong.');
});

test('lists Torn subcommands with their descriptions instead of the parent command', () => {
	const commands = [
		{
			name: 'torn',
			description: 'Torn command.',
			chatInputRun() {},
			helpSubcommands: [
				{ name: 'profile', description: 'View a Torn profile.' },
				{ name: 'faction', description: 'Post faction details and roster.' }
			]
		}
	];

	assert.equal(formatCommandList(commands), '/torn faction - Post faction details and roster.\n/torn profile - View a Torn profile.');
});

test('reports when there are no slash commands', () => {
	assert.equal(formatCommandList([]), 'No slash commands are available.');
});

test('formats uptime as days, hours, minutes, and seconds', () => {
	assert.equal(formatUptime(90_061), '1d 1h 1m 1s');
	assert.equal(formatUptime(0), '0s');
});
