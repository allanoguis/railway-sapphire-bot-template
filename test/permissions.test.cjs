const assert = require('node:assert/strict');
const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { test } = require('node:test');
const { hasStaffPermissions } = require('../dist/lib/permissions.js');

test('allows members with Manage Messages', () => {
	const permissions = new PermissionsBitField(PermissionFlagsBits.ManageMessages);

	assert.equal(hasStaffPermissions(permissions), true);
});

test('rejects members without Manage Messages or without guild permissions', () => {
	assert.equal(hasStaffPermissions(new PermissionsBitField()), false);
	assert.equal(hasStaffPermissions(null), false);
});
