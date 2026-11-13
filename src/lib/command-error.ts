import type { ChatInputCommandInteraction } from 'discord.js';
import type { ILogger } from '@sapphire/framework';

type CommandErrorInteraction = Pick<ChatInputCommandInteraction, 'deferred' | 'replied' | 'reply' | 'followUp'>;

const errorResponse = {
	content: 'There was an error while executing this command.',
	flags: 'Ephemeral'
} as const;

export async function reportCommandError(
	interaction: CommandErrorInteraction,
	commandName: string,
	error: unknown,
	logger: Pick<ILogger, 'error'>
): Promise<void> {
	logger.error(error, `The /${commandName} command failed`);

	try {
		if (interaction.deferred || interaction.replied) {
			await interaction.followUp(errorResponse);
		} else {
			await interaction.reply(errorResponse);
		}
	} catch (responseError) {
		logger.error(responseError, `Failed to send an error response for /${commandName}`);
	}
}
