import type { InteractionReplyOptions } from 'discord.js';
import type { PostgresStorage } from '../../lib/postgres-storage';

export const tornFeatures = [
	'pair',
	'verify',
	'profile',
	'faction-info',
	'faction-members',
	'faction-unregistered',
	'faction-organized-crime',
	'faction-war-history'
] as const;

export type TornFeature = (typeof tornFeatures)[number];

export function isTornFeature(value: unknown): value is TornFeature {
	return typeof value === 'string' && tornFeatures.some((feature) => feature === value);
}

export async function requireTornFeature(
	feature: TornFeature,
	interaction: { reply(options: InteractionReplyOptions): Promise<unknown> },
	storage: PostgresStorage | null,
	logger: { error(error: unknown, message: string): void }
): Promise<boolean> {
	let enabled: boolean;
	try {
		if (!storage) throw new Error('PostgreSQL storage is unavailable.');
		enabled = await storage.isTornFeatureEnabled(feature);
	} catch (error) {
		logger.error(error, 'Failed to read Torn feature settings');
		await interaction.reply({ content: 'Feature settings are unavailable. Please try again later.', flags: 'Ephemeral' });
		return false;
	}
	if (!enabled) {
		await interaction.reply({ content: 'This Torn feature is currently disabled by the bot administrator.', flags: 'Ephemeral' });
		return false;
	}
	return true;
}
