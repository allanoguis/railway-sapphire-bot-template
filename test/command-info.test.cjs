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

	assert.equal(formatCommandList(commands), '**Core**\n/about - Bot details.\n/ping - Pong.');
});

test('groups Core and Torn commands and lists their subcommands instead of parent commands', () => {
	const commands = [
		{
			name: 'torn',
			description: 'Torn command.',
			chatInputRun() {},
			helpCategory: 'torn',
			helpSubcommands: [
				{ name: 'profile', description: 'View a Torn profile.' },
				{ name: 'faction info', description: 'Post faction information.' },
				{ name: 'faction members', description: 'Post the faction roster.' }
			]
		},
		{
			name: 'clear',
			description: 'Clear messages.',
			chatInputRun() {},
			helpSubcommands: [
				{ name: 'user', description: "Delete a selected user's recent messages by amount." },
				{ name: 'amount', description: 'Delete a number of the latest messages from any author.' },
				{ name: 'all', description: 'Delete all removable recent messages in this channel.' }
			]
		},
		{ name: 'pair', description: 'Pair a Torn account.', chatInputRun() {}, helpCategory: 'torn' }
	];

	assert.equal(
		formatCommandList(commands),
		[
			'**Core**',
			'/clear all - Delete all removable recent messages in this channel.',
			'/clear amount - Delete a number of the latest messages from any author.',
			"/clear user - Delete a selected user's recent messages by amount.",
			'',
			'**Torn**',
			'/pair - Pair a Torn account.',
			'/torn faction info - Post faction information.',
			'/torn faction members - Post the faction roster.',
			'/torn profile - View a Torn profile.'
		].join('\n')
	);
});

test('reports when there are no slash commands', () => {
	assert.equal(formatCommandList([]), 'No slash commands are available.');
});

test('formats uptime as days, hours, minutes, and seconds', () => {
	assert.equal(formatUptime(90_061), '1d 1h 1m 1s');
	assert.equal(formatUptime(0), '0s');
});
