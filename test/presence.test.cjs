const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setBotPresence } = require('../dist/lib/presence.js');

test('sets the healthy activity while keeping the bot online', () => {
	let presence;
	setBotPresence(
		{
			user: {
				setPresence(value) {
					presence = value;
				}
			}
		},
		false
	);

	assert.deepEqual(presence, {
		activities: [{ name: 'brewing coffee' }],
		status: 'online'
	});
});

test('sets the service error activity when an error is reported', () => {
	let presence;
	setBotPresence({ user: null }, true);
	setBotPresence(
		{
			user: {
				setPresence(value) {
					presence = value;
				}
			}
		},
		false
	);

	assert.deepEqual(presence, {
		activities: [{ name: 'service error' }],
		status: 'online'
	});
});
