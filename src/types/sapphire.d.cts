import type { PostgresStorage } from '../lib/postgres-storage';

declare module '@sapphire/framework' {
	interface Container {
		storage: PostgresStorage | null;
		tornFactionChannelId: string | undefined;
		tornOcAlertChannelId: string;
	}
}
