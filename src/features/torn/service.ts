import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { JsonValue, PostgresStorage } from '../../lib/postgres-storage';
import { getTornEncryptionKey } from '../../config';

export type TornStorage = Pick<PostgresStorage, 'getTornApi' | 'setTornApi' | 'deleteTornApi'>;

interface TornBar {
	current?: number;
	maximum?: number;
}

export interface TornProfile {
	player_id?: number;
	name?: string;
	level?: number;
	faction?: {
		id?: number;
		name?: string;
		tag?: string;
		tag_image?: string;
		position?: string;
		days_in_faction?: number;
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

export interface TornFactionBasic {
	id: number;
	name: string;
	tag: string;
	tag_image: string;
	leader_id: number;
	respect: number;
	days_old: number;
	members: number;
	best_chain: number;
}

export interface TornFactionMember {
	id: number;
	name: string;
	position: string;
	level: number;
	status?: {
		description?: string;
		details?: string | null;
		state?: string;
	};
	last_action?: {
		status?: string;
		timestamp?: number;
		relative?: string;
	};
}

export interface TornFactionWar {
	kind: string;
	territory?: string;
	end?: number | null;
	factions: Array<{ id: number; name: string; score: number }>;
}

export interface TornFactionOverview {
	basic: TornFactionBasic;
	members: TornFactionMember[];
	chain: { current?: number; max?: number; timeout?: number } | undefined;
	wars: TornFactionWar[];
	pacts: Array<{ factionId: number; factionName: string; until: number }>;
	territories: string[];
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
			return 'Torn does not allow this key to access the requested data.';
		case 10:
			return 'This Torn API key cannot be used while its owner is in federal jail.';
		case 13:
		case 18:
			return 'This Torn API key is disabled. Please check it in Torn and pair a valid key with `/pair`.';
		case 16:
			return 'This Torn API key does not have sufficient access for the requested data.';
		default:
			return 'Torn could not provide the requested profile data. Please try again later.';
	}
}

function normalizeFaction(value: unknown): TornProfile['faction'] | undefined {
	if (!isRecord(value)) return undefined;

	const id = typeof value.id === 'number' ? value.id : value.faction_id;
	const name = typeof value.name === 'string' ? value.name : value.faction_name;
	const tag = typeof value.tag === 'string' ? value.tag : value.faction_tag;
	const tagImage = typeof value.tag_image === 'string' ? value.tag_image : value.faction_tag_image;
	const daysInFaction = value.days_in_faction;
	const { position } = value;
	const hasFactionText = (text: unknown): text is string =>
		typeof text === 'string' && text.trim().length > 0 && text.trim().toLowerCase() !== 'none';

	if (
		!(typeof id === 'number' && Number.isFinite(id) && id > 0) &&
		![name, tag, tagImage, position].some(hasFactionText) &&
		!(typeof daysInFaction === 'number' && daysInFaction > 0)
	) {
		return undefined;
	}

	const faction: NonNullable<TornProfile['faction']> = {};

	if (typeof id === 'number' && Number.isFinite(id) && id > 0) faction.id = id;
	if (hasFactionText(name)) faction.name = name.trim();
	if (hasFactionText(tag)) faction.tag = tag.trim();
	if (hasFactionText(tagImage)) faction.tag_image = tagImage.trim();
	if (hasFactionText(position)) faction.position = position.trim();
	if (typeof daysInFaction === 'number') faction.days_in_faction = daysInFaction;

	return faction;
}

function normalizeProfile(payload: Record<string, unknown>): TornProfile {
	const profile = { ...payload };
	const faction = normalizeFaction(payload.faction);
	if (typeof profile.player_id !== 'number' && typeof profile.id === 'number') profile.player_id = profile.id;
	delete profile.id;
	delete profile.faction;
	if (faction) profile.faction = faction;
	return profile as TornProfile;
}

type TornUserSelection = 'basic' | 'profile' | 'faction' | 'bars' | 'cooldowns' | 'battlestats';

export async function requestTornPayload(url: URL): Promise<Record<string, unknown>> {
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

	return payload;
}

async function requestSelection(apiKey: string, selection: TornUserSelection, playerId?: number): Promise<Record<string, unknown>> {
	const url = new URL(`https://api.torn.com/v2/user/${selection}`);
	if (playerId !== undefined) url.searchParams.set('id', String(playerId));
	url.searchParams.set('key', apiKey);
	return requestTornPayload(url);
}

export async function requestFactionEndpoint(apiKey: string, endpoint: string): Promise<Record<string, unknown>> {
	const url = new URL(`https://api.torn.com/v2/faction/${endpoint}`);
	url.searchParams.set('key', apiKey);
	return requestTornPayload(url);
}

function readSelection(payload: Record<string, unknown>, selection: string): Record<string, unknown> {
	const data = payload[selection];
	if (!isRecord(data)) throw new TornApiError('Torn returned an unexpected response. Please try again later.');
	return data;
}

function readPlayerId(profile: Record<string, unknown>): number | undefined {
	if (typeof profile.player_id === 'number') return profile.player_id;
	return typeof profile.id === 'number' ? profile.id : undefined;
}

async function requestBasicProfile(apiKey: string): Promise<{ playerId: number; name: string | undefined }> {
	const basic = readSelection(await requestSelection(apiKey, 'basic'), 'profile');
	const playerId = readPlayerId(basic);
	if (playerId === undefined) throw new TornApiError('Torn did not return a player profile for this API key.');
	return { playerId, name: typeof basic.name === 'string' ? basic.name : undefined };
}

async function requestProfile(apiKey: string, playerId?: number): Promise<TornProfile> {
	const profile = normalizeProfile(readSelection(await requestSelection(apiKey, 'profile', playerId), 'profile'));
	if (typeof profile.player_id !== 'number') {
		throw new TornApiError('Torn did not return a player profile for this API key.');
	}
	return profile;
}

async function requestFaction(apiKey: string, playerId?: number): Promise<TornProfile['faction']> {
	const payload = await requestSelection(apiKey, 'faction', playerId);
	const { faction } = payload;
	if (faction === undefined || faction === null) return undefined;
	if (!isRecord(faction)) throw new TornApiError('Torn returned an unexpected response. Please try again later.');
	return normalizeFaction(faction);
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
	}
	return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== 'string') {
		throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
	}
	return value;
}

export function normalizeFactionBasic(payload: Record<string, unknown>): TornFactionBasic {
	const basic = readSelection(payload, 'basic');
	return {
		id: requiredNumber(basic, 'id'),
		name: requiredString(basic, 'name'),
		tag: requiredString(basic, 'tag'),
		tag_image: requiredString(basic, 'tag_image'),
		leader_id: requiredNumber(basic, 'leader_id'),
		respect: requiredNumber(basic, 'respect'),
		days_old: requiredNumber(basic, 'days_old'),
		members: requiredNumber(basic, 'members'),
		best_chain: requiredNumber(basic, 'best_chain')
	};
}

export function normalizeFactionMembers(payload: Record<string, unknown>): TornFactionMember[] {
	const value = payload.members;
	if (!Array.isArray(value)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');

	return value.map((entry) => {
		if (!isRecord(entry)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
		const member: TornFactionMember = {
			id: requiredNumber(entry, 'id'),
			name: requiredString(entry, 'name'),
			position: requiredString(entry, 'position'),
			level: requiredNumber(entry, 'level')
		};
		if (isRecord(entry.status)) {
			member.status = {
				description: typeof entry.status.description === 'string' ? entry.status.description : undefined,
				details: typeof entry.status.details === 'string' || entry.status.details === null ? entry.status.details : undefined,
				state: typeof entry.status.state === 'string' ? entry.status.state : undefined
			};
		}
		if (isRecord(entry.last_action)) {
			member.last_action = {
				status: typeof entry.last_action.status === 'string' ? entry.last_action.status : undefined,
				timestamp: typeof entry.last_action.timestamp === 'number' ? entry.last_action.timestamp : undefined,
				relative: typeof entry.last_action.relative === 'string' ? entry.last_action.relative : undefined
			};
		}
		return member;
	});
}

function normalizeFactionWars(payload: Record<string, unknown>): {
	wars: TornFactionWar[];
	pacts: TornFactionOverview['pacts'];
} {
	const warsObject = readSelection(payload, 'wars');
	const wars: TornFactionWar[] = [];
	const addWar = (kind: string, value: unknown) => {
		if (!isRecord(value)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
		const { factions } = value;
		if (!Array.isArray(factions)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
		const normalizedFactions = factions.map((faction) => {
			if (!isRecord(faction)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
			return {
				id: requiredNumber(faction, 'id'),
				name: requiredString(faction, 'name'),
				score: requiredNumber(faction, 'score')
			};
		});
		wars.push({
			kind,
			...(typeof value.territory === 'string' ? { territory: value.territory } : {}),
			...(typeof value.end === 'number' || value.end === null ? { end: value.end } : {}),
			factions: normalizedFactions
		});
	};

	if (warsObject.ranked !== null && warsObject.ranked !== undefined) addWar('Ranked war', warsObject.ranked);
	for (const [key, label] of [
		['raids', 'Raid'],
		['territory', 'Territory war']
	] as const) {
		const entries = warsObject[key];
		if (!Array.isArray(entries)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
		for (const entry of entries) addWar(label, entry);
	}

	const pactEntries = payload.pacts;
	if (!Array.isArray(pactEntries)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
	const pacts = pactEntries.map((entry) => {
		if (!isRecord(entry)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
		return {
			factionId: requiredNumber(entry, 'faction_id'),
			factionName: requiredString(entry, 'faction_name'),
			until: requiredNumber(entry, 'until')
		};
	});
	return { wars, pacts };
}

function normalizeFactionChain(payload: Record<string, unknown>): TornFactionOverview['chain'] {
	const { chain } = payload;
	if (!isRecord(chain)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
	return {
		...(typeof chain.current === 'number' ? { current: chain.current } : {}),
		...(typeof chain.max === 'number' ? { max: chain.max } : {}),
		...(typeof chain.timeout === 'number' ? { timeout: chain.timeout } : {})
	};
}

function normalizeFactionTerritories(payload: Record<string, unknown>): string[] {
	const territories = payload.territory;
	if (!Array.isArray(territories)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
	return territories.map((territory) => {
		if (!isRecord(territory)) throw new TornApiError('Torn returned unexpected faction data. Please try again later.');
		return requiredString(territory, 'id');
	});
}

export interface TornFactionApiContext {
	apiKey: string;
	faction: { id: number; name?: string; tag?: string };
}

export async function getTornFactionApiContext(storage: TornStorage | null, discordUserId: string): Promise<TornFactionApiContext> {
	if (storage === null) {
		throw new TornApiError('Torn account pairing is not configured by the bot administrator. Please contact them for help.');
	}

	const credential = await loadCredential(storage, discordUserId);
	if (!credential) {
		throw new TornApiError('Pair your Torn API key with `/pair` to request faction information.');
	}

	const encryptionKey = getTornEncryptionKey(process.env);
	if (!encryptionKey) {
		throw new TornApiError('Torn account pairing is not configured by the bot administrator. Please contact them for help.');
	}

	const apiKey = decryptApiKey(credential, encryptionKey, discordUserId);
	const membershipPayload = await requestSelection(apiKey, 'faction');
	const membership = normalizeFaction(membershipPayload.faction);
	if (!membership?.id) {
		throw new TornApiError('Your paired Torn account is not currently in a faction.');
	}

	return {
		apiKey,
		faction: {
			id: membership.id,
			...(membership.name === undefined ? {} : { name: membership.name }),
			...(membership.tag === undefined ? {} : { tag: membership.tag })
		}
	};
}

function readBar(value: unknown): TornBar | undefined {
	if (!isRecord(value)) return undefined;
	const bar: TornBar = {};
	if (typeof value.current === 'number') bar.current = value.current;
	if (typeof value.maximum === 'number') bar.maximum = value.maximum;
	return bar;
}

function readCooldowns(payload: Record<string, unknown>): TornProfile['cooldowns'] {
	const cooldowns: NonNullable<TornProfile['cooldowns']> = {};
	for (const key of ['drug', 'medical', 'booster'] as const) {
		if (typeof payload[key] === 'number') cooldowns[key] = payload[key];
	}
	return cooldowns;
}

function readBattleStats(payload: Record<string, unknown>): TornProfile['battlestats'] {
	const stats: NonNullable<TornProfile['battlestats']> = {};
	for (const key of ['strength', 'defense', 'speed', 'dexterity', 'total'] as const) {
		const value = payload[key];
		if (typeof value === 'number') stats[key] = value;
		else if (isRecord(value) && typeof value.value === 'number') stats[key] = value.value;
	}
	return stats;
}

function withoutBattleStats(profile: TornProfile): TornProfile {
	const publicProfile = { ...profile };
	for (const key of ['battlestats', 'strength', 'defense', 'speed', 'dexterity', 'total'] as const) {
		delete publicProfile[key];
	}
	return publicProfile;
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

	const { playerId, name } = await requestBasicProfile(apiKey);
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

	const { playerId, name } = await requestBasicProfile(decryptApiKey(credential, encryptionKey, discordUserId));
	if (playerId !== credential.playerId) {
		throw new TornApiError('The saved Torn API key no longer matches the paired account. Use `/pair` to pair a valid key.');
	}

	return { playerId: credential.playerId, name };
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
		const [profile, faction] = await Promise.all([requestProfile(apiKey, playerId), requestFaction(apiKey, playerId)]);
		return { profile: withoutBattleStats({ ...profile, faction }), isLinkedProfile: false };
	}

	const [profile, faction, barsPayload, cooldownsPayload, battleStatsPayload] = await Promise.all([
		requestProfile(apiKey),
		requestFaction(apiKey),
		requestSelection(apiKey, 'bars'),
		requestSelection(apiKey, 'cooldowns'),
		requestSelection(apiKey, 'battlestats')
	]);
	const bars = readSelection(barsPayload, 'bars');
	const cooldowns = readCooldowns(readSelection(cooldownsPayload, 'cooldowns'));
	const battlestats = readBattleStats(readSelection(battleStatsPayload, 'battlestats'));

	return {
		profile: {
			...profile,
			faction,
			energy: readBar(bars.energy),
			nerve: readBar(bars.nerve),
			happy: readBar(bars.happy),
			life: readBar(bars.life),
			cooldowns,
			battlestats
		},
		isLinkedProfile: true
	};
}

export async function getTornFactionOverview(storage: TornStorage | null, discordUserId: string): Promise<TornFactionOverview> {
	const { apiKey, faction } = await getTornFactionApiContext(storage, discordUserId);

	const [basicPayload, membersPayload, chainPayload, warsPayload, territoriesPayload] = await Promise.all([
		requestFactionEndpoint(apiKey, 'basic'),
		requestFactionEndpoint(apiKey, 'members'),
		requestFactionEndpoint(apiKey, 'chain'),
		requestFactionEndpoint(apiKey, 'wars'),
		requestFactionEndpoint(apiKey, 'territory')
	]);
	const basic = normalizeFactionBasic(basicPayload);
	if (basic.id !== faction.id) {
		throw new TornApiError('Torn returned inconsistent faction data. Please try again later.');
	}
	const { wars, pacts } = normalizeFactionWars(warsPayload);

	return {
		basic,
		members: normalizeFactionMembers(membersPayload),
		chain: normalizeFactionChain(chainPayload),
		wars,
		pacts,
		territories: normalizeFactionTerritories(territoriesPayload)
	};
}
