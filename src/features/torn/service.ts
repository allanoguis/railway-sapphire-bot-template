import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { JsonValue, PostgresStorage } from '../../lib/postgres-storage';
import { getTornEncryptionKey } from '../../config';

type TornStorage = Pick<PostgresStorage, 'getTornApi' | 'setTornApi' | 'deleteTornApi'>;

interface TornBar {
	current?: number;
	maximum?: number;
}

export interface TornProfile {
	player_id?: number;
	name?: string;
	level?: number;
	faction?: {
		faction_id?: number;
		name?: string;
		tag?: string;
	};
	status?: {
		description?: string;
		details?: string | null;
		state?: string;
		color?: string;
		until?: number;
	};
	last_action?: {
		status?: string;
		timestamp?: number;
		relative?: string;
	};
	energy?: TornBar;
	nerve?: TornBar;
	happy?: TornBar;
	life?: TornBar;
	cooldowns?: {
		drug?: number;
		medical?: number;
		booster?: number;
	};
	battlestats?: {
		strength?: number;
		defense?: number;
		speed?: number;
		dexterity?: number;
		total?: number;
	};
	strength?: number;
	defense?: number;
	speed?: number;
	dexterity?: number;
	total?: number;
}

interface StoredCredential {
	version: 1;
	playerId: number;
	iv: string;
	authTag: string;
	ciphertext: string;
}

export class TornApiError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'TornApiError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readStoredCredential(value: JsonValue | undefined): StoredCredential | undefined {
	if (!isRecord(value)) return undefined;
	if (
		value.version !== 1 ||
		typeof value.playerId !== 'number' ||
		typeof value.iv !== 'string' ||
		typeof value.authTag !== 'string' ||
		typeof value.ciphertext !== 'string'
	) {
		throw new TornApiError('Stored Torn account data is invalid. Unlink and pair the account again.');
	}
	return {
		version: 1,
		playerId: value.playerId,
		iv: value.iv,
		authTag: value.authTag,
		ciphertext: value.ciphertext
	};
}

function encryptApiKey(apiKey: string, encryptionKey: Buffer, discordUserId: string): Omit<StoredCredential, 'version' | 'playerId'> {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
	cipher.setAAD(Buffer.from(discordUserId));
	const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);

	return {
		iv: iv.toString('base64'),
		authTag: cipher.getAuthTag().toString('base64'),
		ciphertext: ciphertext.toString('base64')
	};
}

function decryptApiKey(credential: StoredCredential, encryptionKey: Buffer, discordUserId: string): string {
	try {
		const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(credential.iv, 'base64'));
		decipher.setAAD(Buffer.from(discordUserId));
		decipher.setAuthTag(Buffer.from(credential.authTag, 'base64'));
		return Buffer.concat([decipher.update(Buffer.from(credential.ciphertext, 'base64')), decipher.final()]).toString('utf8');
	} catch {
		throw new TornApiError('Stored Torn credentials could not be decrypted. Unlink and pair the account again.');
	}
}

function getApiErrorMessage(code: number | undefined): string {
	switch (code) {
		case 1:
		case 2:
			return 'The Torn API key was rejected. Check the key and try pairing again with `/pair`.';
		case 5:
			return 'Torn API rate limit reached. Please wait a minute and try again.';
		case 6:
			return 'That Torn player ID was not found.';
		case 7:
			return 'Torn does not allow this key to access that player data.';
		case 10:
			return 'This Torn API key cannot be used while its owner is in federal jail.';
		case 13:
		case 18:
			return 'This Torn API key is disabled. Please check it in Torn and pair a valid key with `/pair`.';
		case 16:
			return 'This Torn API key does not have sufficient access for the requested profile data.';
		default:
			return 'Torn could not provide the requested profile data. Please try again later.';
	}
}

async function requestProfile(apiKey: string, playerId?: number, selections = 'basic,profile,battlestats'): Promise<TornProfile> {
	const url = new URL(`https://api.torn.com/user/${playerId ?? ''}`);
	url.searchParams.set('selections', selections);
	url.searchParams.set('key', apiKey);

	let response: Response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	} catch {
		throw new TornApiError('Could not connect to the Torn API. Please try again later.');
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new TornApiError('Torn returned an unreadable response. Please try again later.');
	}

	if (!isRecord(payload)) throw new TornApiError('Torn returned an unexpected response. Please try again later.');

	const apiError = payload.error;
	if (isRecord(apiError)) {
		const code = typeof apiError.code === 'number' ? apiError.code : undefined;
		throw new TornApiError(getApiErrorMessage(code));
	}
	if (apiError !== undefined) throw new TornApiError(getApiErrorMessage(undefined));
	if (!response.ok) throw new TornApiError('Torn returned an unexpected response. Please try again later.');

	if (typeof payload.player_id !== 'number') {
		throw new TornApiError('Torn did not return a player profile for this API key.');
	}

	return payload as TornProfile;
}

async function loadCredential(storage: TornStorage, discordUserId: string): Promise<StoredCredential | undefined> {
	const value = await storage.getTornApi(discordUserId);
	return readStoredCredential(value);
}

export function hasTornPairingConfiguration(): boolean {
	return Boolean(getTornEncryptionKey(process.env));
}

export async function pairTornAccount(
	storage: TornStorage,
	discordUserId: string,
	apiKey: string
): Promise<{ playerId: number; name: string | undefined }> {
	const encryptionKey = getTornEncryptionKey(process.env);
	if (!encryptionKey) {
		throw new TornApiError('Torn account pairing is not configured by the bot administrator. Please contact them for help.');
	}
	if (!/^[a-zA-Z0-9]{16}$/.test(apiKey)) {
		throw new TornApiError('Torn API keys must be 16 characters long. No key was stored.');
	}

	const { player_id: playerId, name } = await requestProfile(apiKey, undefined, 'basic');
	if (typeof playerId !== 'number') throw new TornApiError('Torn did not return a player ID for this API key.');
	const encryptedKey = encryptApiKey(apiKey, encryptionKey, discordUserId);
	await storage.setTornApi(discordUserId, {
		version: 1 as const,
		playerId,
		...encryptedKey
	} satisfies JsonValue);
	return { playerId, name };
}

export async function verifyTornAccount(
	storage: TornStorage,
	discordUserId: string
): Promise<{ playerId: number; name: string | undefined } | undefined> {
	const credential = await loadCredential(storage, discordUserId);
	if (!credential) return undefined;

	const encryptionKey = getTornEncryptionKey(process.env);
	if (!encryptionKey) {
		throw new TornApiError('Torn account pairing is not configured by the bot administrator. Please contact them for help.');
	}

	const profile = await requestProfile(decryptApiKey(credential, encryptionKey, discordUserId), undefined, 'basic');
	if (profile.player_id !== credential.playerId) {
		throw new TornApiError('The saved Torn API key no longer matches the paired account. Use `/pair` to pair a valid key.');
	}

	return { playerId: credential.playerId, name: profile.name };
}

export async function unpairTornAccount(storage: TornStorage, discordUserId: string): Promise<boolean> {
	return storage.deleteTornApi(discordUserId);
}

export async function getTornProfile(
	storage: TornStorage | null,
	discordUserId: string,
	playerId?: number
): Promise<{ profile: TornProfile; isLinkedProfile: boolean }> {
	if (storage === null) {
		throw new TornApiError('Torn account pairing is not configured by the bot administrator. Please contact them for help.');
	}

	const credential = await loadCredential(storage, discordUserId);
	if (!credential) {
		throw new TornApiError('Pair your Torn API key with `/pair` to request Torn profiles.');
	}

	const encryptionKey = getTornEncryptionKey(process.env);
	if (!encryptionKey) {
		throw new TornApiError('Torn account pairing is not configured by the bot administrator. Please contact them for help.');
	}

	const apiKey = decryptApiKey(credential, encryptionKey, discordUserId);
	if (playerId !== undefined && credential.playerId !== playerId) {
		return { profile: await requestProfile(apiKey, playerId), isLinkedProfile: false };
	}

	return {
		profile: await requestProfile(apiKey, undefined, 'basic,profile,bars,cooldowns,battlestats'),
		isLinkedProfile: true
	};
}
