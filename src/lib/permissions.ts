import { PermissionFlagsBits } from 'discord.js';
import type { PermissionsBitField } from 'discord.js';

export function hasStaffPermissions(memberPermissions: PermissionsBitField | null): boolean {
	return memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
}
