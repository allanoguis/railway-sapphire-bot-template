import { ApplyOptions } from '@sapphire/decorators';
import { Precondition } from '@sapphire/framework';
import type { ChatInputCommandInteraction } from 'discord.js';
import { hasStaffPermissions } from '../lib/permissions';

@ApplyOptions<Precondition.Options>({
	name: 'StaffOnly'
})
export class StaffOnlyPrecondition extends Precondition {
	public override chatInputRun(interaction: ChatInputCommandInteraction) {
		if (hasStaffPermissions(interaction.memberPermissions)) {
			return this.ok();
		}

		return this.error({ message: 'You need the Manage Messages permission to use this command.' });
	}
}
