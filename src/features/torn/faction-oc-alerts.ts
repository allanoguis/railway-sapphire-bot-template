import type { EmbedBuilder } from 'discord.js';
import {
	buildTornFactionOrganizedCrimeEmbeds,
	buildTornFactionOrganizedCrimeMissingItemEmbeds,
	buildTornFactionOrganizedCrimeSummaryEmbed,
	getTornFactionOrganizedCrimes
} from './faction-oc';
import type { TornStorage } from './service';
import { TornApiError } from './service';
import type { PostgresStorage } from '../../lib/postgres-storage';

const DELETE_PAGE_SIZE = 100;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const ORGANIZED_CRIME_REFRESH_INTERVAL_MS = 3_600_000;

export interface OrganizedCrimeAlertMessage {
	id: string;
	createdTimestamp: number;
	delete(): Promise<unknown>;
}

export interface OrganizedCrimeAlertChannel {
	guildId: string;
	messages: {
		fetch(options: { before?: string; limit: number }): Promise<{ values(): IterableIterator<OrganizedCrimeAlertMessage> }>;
	};
	bulkDelete(messageIds: readonly string[], filterOld?: boolean): Promise<{ size: number }>;
	send(options: { embeds: EmbedBuilder[]; allowedMentions: { parse: [] } }): Promise<unknown>;
}

export function isOrganizedCrimeAlertChannel(value: unknown): value is OrganizedCrimeAlertChannel {
	if (typeof value !== 'object' || value === null) return false;
	if (!('guildId' in value) || typeof value.guildId !== 'string') return false;
	if (!('messages' in value) || typeof value.messages !== 'object' || value.messages === null || !('fetch' in value.messages)) {
		return false;
	}
	return (
		typeof value.messages.fetch === 'function' &&
		'bulkDelete' in value &&
		typeof value.bulkDelete === 'function' &&
		'send' in value &&
		typeof value.send === 'function'
	);
}

export async function clearOrganizedCrimeAlertChannel(channel: OrganizedCrimeAlertChannel, now = Date.now()): Promise<number> {
	let deletedCount = 0;
	let before: string | undefined;
	const cutoff = now - BULK_DELETE_MAX_AGE_MS;

	while (true) {
		const page = [...(await channel.messages.fetch({ limit: DELETE_PAGE_SIZE, ...(before ? { before } : {}) })).values()].sort(
			(left, right) => right.createdTimestamp - left.createdTimestamp
		);
		if (page.length === 0) return deletedCount;

		const recentMessages = page.filter((message) => message.createdTimestamp > cutoff);
		if (recentMessages.length > 1) {
			const deleted = await channel.bulkDelete(
				recentMessages.map((message) => message.id),
				true
			);
			if (deleted.size !== recentMessages.length) {
				throw new Error(`Discord deleted ${deleted.size} of ${recentMessages.length} recent alert-channel messages.`);
			}
			deletedCount += deleted.size;
		} else if (recentMessages.length === 1) {
			await recentMessages[0].delete();
			deletedCount += 1;
		}

		for (const message of page) {
			if (message.createdTimestamp <= cutoff) {
				await message.delete();
				deletedCount += 1;
			}
		}

		const oldestMessage = page[page.length - 1];
		if (oldestMessage.id === before) throw new Error('Alert-channel message pagination did not advance.');
		if (page.length < DELETE_PAGE_SIZE) return deletedCount;
		before = oldestMessage.id;
	}
}

export async function refreshOrganizedCrimeAlert(
	channel: OrganizedCrimeAlertChannel,
	storage: TornStorage | null,
	discordUserId: string
): Promise<number> {
	const report = await getTornFactionOrganizedCrimes(storage, discordUserId);
	const embeds = [
		...buildTornFactionOrganizedCrimeEmbeds(report),
		...buildTornFactionOrganizedCrimeMissingItemEmbeds(report),
		buildTornFactionOrganizedCrimeSummaryEmbed(report)
	];
	await clearOrganizedCrimeAlertChannel(channel);

	for (const embed of embeds) {
		await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
	}

	return embeds.length;
}

interface AlertRefreshLogger {
	error(error: unknown, message: string): void;
}

interface ScheduledAlert {
	discordUserId: string;
	refresh: (discordUserId: string) => Promise<void>;
	logger: AlertRefreshLogger;
	timer?: ReturnType<typeof setInterval>;
	pending?: Promise<void>;
}

export class OrganizedCrimeAlertScheduler {
	private readonly jobs = new Map<string, ScheduledAlert>();
	private readonly restorationTimers = new Map<string, ReturnType<typeof setInterval>>();

	public has(channelId: string): boolean {
		return this.jobs.has(channelId);
	}

	public retryRestoration(channelId: string, restore: () => Promise<void>, logger: AlertRefreshLogger): void {
		if (this.restorationTimers.has(channelId)) return;
		let pending = false;
		const timer = setInterval(() => {
			if (pending) return;
			pending = true;
			void restore()
				.then(() => {
					clearInterval(timer);
					this.restorationTimers.delete(channelId);
				})
				.catch((error: unknown) => {
					logger.error(error, 'Failed to restore the organized-crime alert');
					if (this.has(channelId)) {
						clearInterval(timer);
						this.restorationTimers.delete(channelId);
					}
				})
				.finally(() => {
					pending = false;
				});
		}, ORGANIZED_CRIME_REFRESH_INTERVAL_MS);
		timer.unref();
		this.restorationTimers.set(channelId, timer);
	}

	public start(channelId: string, discordUserId: string, refresh: (discordUserId: string) => Promise<void>, logger: AlertRefreshLogger): boolean {
		const existing = this.jobs.get(channelId);
		if (existing) {
			existing.discordUserId = discordUserId;
			existing.refresh = refresh;
			existing.logger = logger;
			this.schedule(existing);
			return false;
		}

		const job: ScheduledAlert = { discordUserId, refresh, logger };
		this.jobs.set(channelId, job);
		this.schedule(job);
		return true;
	}

	public refreshNow(channelId: string, discordUserId: string): Promise<void> {
		const job = this.jobs.get(channelId);
		if (!job) throw new Error('The organized-crime alert refresh has not been started.');
		job.discordUserId = discordUserId;
		return this.execute(job, discordUserId);
	}

	public activate(
		channelId: string,
		discordUserId: string,
		refresh: (discordUserId: string) => Promise<void>,
		save: () => Promise<void>,
		logger: AlertRefreshLogger
	): Promise<void> {
		let job = this.jobs.get(channelId);
		if (!job) {
			job = { discordUserId, refresh, logger };
			this.jobs.set(channelId, job);
		}
		const current = job;
		if (current.timer) this.schedule(current);
		const previous = current.pending?.catch(() => undefined) ?? Promise.resolve();
		const pending = previous.then(async () => {
			await refresh(discordUserId);
			await save();
			if (this.jobs.get(channelId) !== current) return;
			current.discordUserId = discordUserId;
			current.refresh = refresh;
			current.logger = logger;
			if (!current.timer) this.schedule(current);
		});
		current.pending = pending;
		void pending.then(
			() => {
				if (current.pending === pending) current.pending = undefined;
			},
			() => {
				if (current.pending === pending) {
					current.pending = undefined;
					if (!current.timer && this.jobs.get(channelId) === current) this.jobs.delete(channelId);
				}
			}
		);
		return pending;
	}

	public stop(channelId: string): void {
		const job = this.jobs.get(channelId);
		if (!job) return;
		if (job.timer) clearInterval(job.timer);
		this.jobs.delete(channelId);
	}

	public stopAll(): void {
		for (const channelId of this.jobs.keys()) this.stop(channelId);
		for (const timer of this.restorationTimers.values()) clearInterval(timer);
		this.restorationTimers.clear();
	}

	private schedule(job: ScheduledAlert): void {
		if (job.timer) clearInterval(job.timer);
		job.timer = setInterval(() => {
			if (job.pending) return;
			void this.execute(job, job.discordUserId).catch((error: unknown) =>
				job.logger.error(error, 'Failed to refresh the organized-crime alert')
			);
		}, ORGANIZED_CRIME_REFRESH_INTERVAL_MS);
		job.timer.unref();
	}

	private execute(job: ScheduledAlert, discordUserId: string): Promise<void> {
		const previous = job.pending?.catch(() => undefined) ?? Promise.resolve();
		const pending = previous.then(() => job.refresh(discordUserId));
		job.pending = pending;
		void pending.then(
			() => {
				if (job.pending === pending) job.pending = undefined;
			},
			() => {
				if (job.pending === pending) job.pending = undefined;
			}
		);
		return pending;
	}
}

export const organizedCrimeAlertScheduler = new OrganizedCrimeAlertScheduler();

interface AlertClient {
	channels: { fetch(channelId: string): Promise<unknown> };
}

export async function getOrganizedCrimeAlertPlayerId(storage: PostgresStorage, discordUserId: string): Promise<number> {
	const credential = await storage.getTornApi(discordUserId);
	if (
		typeof credential !== 'object' ||
		credential === null ||
		Array.isArray(credential) ||
		typeof credential.playerId !== 'number' ||
		!Number.isSafeInteger(credential.playerId) ||
		credential.playerId <= 0
	) {
		throw new TornApiError('The alert owner needs a valid paired Torn account. Use `/pair` and run the organized-crimes command again.');
	}
	return credential.playerId;
}

export function createOrganizedCrimeAlertRefresh(
	client: AlertClient,
	storage: PostgresStorage,
	channelId: string,
	guildId: string,
	playerId: number
): (discordUserId: string) => Promise<void> {
	return async (discordUserId) => {
		if (!(await storage.isTornFeatureEnabled('faction-organized-crime'))) {
			throw new TornApiError('Organized-crime alerts are disabled by the bot administrator.');
		}
		if ((await getOrganizedCrimeAlertPlayerId(storage, discordUserId)) !== playerId) {
			throw new TornApiError('The alert owner changed Torn accounts. Run the organized-crimes command again to update the alert.');
		}
		const channel = await client.channels.fetch(channelId);
		if (!isOrganizedCrimeAlertChannel(channel) || channel.guildId !== guildId) {
			throw new TornApiError('The configured organized-crime alert channel is unavailable in the original server.');
		}
		await refreshOrganizedCrimeAlert(channel, storage, discordUserId);
	};
}

export async function restoreOrganizedCrimeAlert(
	client: AlertClient,
	storage: PostgresStorage,
	channelId: string,
	logger: AlertRefreshLogger
): Promise<boolean> {
	const saved = await storage.getOrganizedCrimeAlert(channelId);
	if (!saved) return false;
	if (organizedCrimeAlertScheduler.has(channelId)) return false;
	const refresh = createOrganizedCrimeAlertRefresh(client, storage, channelId, saved.guildId, saved.playerId);
	organizedCrimeAlertScheduler.start(channelId, saved.discordUserId, refresh, logger);
	await organizedCrimeAlertScheduler.refreshNow(channelId, saved.discordUserId);
	return true;
}
