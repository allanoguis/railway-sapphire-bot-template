import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { JsonValue } from '../lib/postgres-storage';

export type ConsentKind = 'profile' | 'crimes';
export interface WebsiteConsent {
	profile: boolean;
	crimes: boolean;
}
export interface WebsiteSession {
	user: { id: string; username: string };
	csrfToken: string;
	expiresAt: Date;
}

type Database = Pick<Pool, 'query'>;

function envelope(credential: JsonValue | undefined): Record<string, string | number> | undefined {
	if (!credential || typeof credential !== 'object' || Array.isArray(credential)) return undefined;
	const { version, playerId, iv, authTag, ciphertext } = credential;
	if (
		version !== 1 ||
		typeof playerId !== 'number' ||
		!Number.isSafeInteger(playerId) ||
		playerId <= 0 ||
		typeof iv !== 'string' ||
		typeof authTag !== 'string' ||
		typeof ciphertext !== 'string' ||
		!iv ||
		!authTag ||
		!ciphertext
	)
		return undefined;
	return { version, playerId, iv, authTag, ciphertext };
}

function fingerprint(discordId: string, value: Record<string, string | number>): string {
	return createHash('sha256')
		.update(JSON.stringify([discordId, value.version, value.playerId, value.iv, value.authTag, value.ciphertext]))
		.digest('hex');
}

export function hashSessionToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export class WebsiteStorage {
	public constructor(private readonly pool: Database) {}

	/** Call only when the website is enabled, after verified_users has been initialized. */
	public async initialize(): Promise<void> {
		await this.pool.query(`CREATE TABLE IF NOT EXISTS website_sessions (
			session_hash TEXT PRIMARY KEY,
			discord_id TEXT NOT NULL,
			username TEXT NOT NULL,
			csrf_token TEXT NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL
		)`);
		await this.pool.query('CREATE INDEX IF NOT EXISTS website_sessions_expires_at_idx ON website_sessions (expires_at)');
		await this.pool.query(`CREATE TABLE IF NOT EXISTS website_consents (
			discord_id TEXT PRIMARY KEY REFERENCES verified_users(discord_id) ON DELETE CASCADE,
			credential_fingerprint TEXT NOT NULL,
			profile BOOLEAN NOT NULL DEFAULT FALSE,
			crimes BOOLEAN NOT NULL DEFAULT FALSE,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`);
		await this.pool.query(`CREATE OR REPLACE FUNCTION website_clear_consent_on_repair() RETURNS trigger AS $$
			BEGIN
				DELETE FROM website_consents WHERE discord_id = OLD.discord_id;
				RETURN NEW;
			END
		$$ LANGUAGE plpgsql`);
		await this.pool.query(`DO $$
			BEGIN
				PERFORM pg_advisory_xact_lock(hashtext('website-consent-trigger')::bigint);
				IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'verified_users'::regclass
					AND tgname = 'website_clear_consent_on_repair' AND NOT tgisinternal) THEN
					CREATE TRIGGER website_clear_consent_on_repair AFTER UPDATE OF torn_api ON verified_users
					FOR EACH ROW EXECUTE FUNCTION website_clear_consent_on_repair();
				END IF;
			END
		$$`);
		await this.cleanupExpiredSessions();
	}

	public async createSession(token: string, session: WebsiteSession): Promise<void> {
		await this.pool.query(
			'INSERT INTO website_sessions (session_hash, discord_id, username, csrf_token, expires_at) VALUES ($1, $2, $3, $4, $5)',
			[hashSessionToken(token), session.user.id, session.user.username, session.csrfToken, session.expiresAt]
		);
	}

	public async getSession(token: string): Promise<WebsiteSession | null> {
		const result = await this.pool.query<{ discord_id: string; username: string; csrf_token: string; expires_at: Date }>(
			'SELECT discord_id, username, csrf_token, expires_at FROM website_sessions WHERE session_hash = $1 AND expires_at > NOW()',
			[hashSessionToken(token)]
		);
		const row = result.rows[0];
		return row ? { user: { id: row.discord_id, username: row.username }, csrfToken: row.csrf_token, expiresAt: row.expires_at } : null;
	}

	public async deleteSession(token: string): Promise<void> {
		await this.pool.query('DELETE FROM website_sessions WHERE session_hash = $1', [hashSessionToken(token)]);
	}

	public async cleanupExpiredSessions(): Promise<void> {
		await this.pool.query('DELETE FROM website_sessions WHERE expires_at <= NOW()');
	}

	public async getConsent(discordId: string): Promise<WebsiteConsent> {
		const result = await this.pool.query<{
			torn_api: JsonValue;
			credential_fingerprint: string | null;
			profile: boolean | null;
			crimes: boolean | null;
		}>(
			`SELECT v.torn_api, c.credential_fingerprint, c.profile, c.crimes
			FROM verified_users v LEFT JOIN website_consents c ON c.discord_id = v.discord_id
			WHERE v.discord_id = $1`,
			[discordId]
		);
		const row = result.rows[0];
		const value = envelope(row?.torn_api);
		if (!row || !value || row.credential_fingerprint !== fingerprint(discordId, value)) return { profile: false, crimes: false };
		return { profile: row.profile === true, crimes: row.crimes === true };
	}

	public async setConsent(discordId: string, credential: JsonValue, consent: WebsiteConsent): Promise<boolean> {
		const value = envelope(credential);
		if (!value || typeof consent.profile !== 'boolean' || typeof consent.crimes !== 'boolean') return false;
		const result = await this.pool.query(
			`INSERT INTO website_consents (discord_id, credential_fingerprint, profile, crimes)
			SELECT discord_id, $3, $4, $5 FROM verified_users
			WHERE discord_id = $1 AND torn_api = $2::jsonb
			ON CONFLICT (discord_id) DO UPDATE SET credential_fingerprint = EXCLUDED.credential_fingerprint,
			profile = EXCLUDED.profile, crimes = EXCLUDED.crimes, updated_at = NOW()`,
			[discordId, JSON.stringify(credential), fingerprint(discordId, value), consent.profile, consent.crimes]
		);
		return (result.rowCount ?? 0) > 0;
	}

	public async checkConsentForCredential(discordId: string, credential: JsonValue, kind: ConsentKind): Promise<boolean> {
		if (kind !== 'profile' && kind !== 'crimes') return false;
		const value = envelope(credential);
		if (!value) return false;
		const result = await this.pool.query<{ profile: boolean; crimes: boolean }>(
			`SELECT c.profile, c.crimes FROM website_consents c
			JOIN verified_users v ON v.discord_id = c.discord_id
			WHERE c.discord_id = $1 AND v.torn_api = $2::jsonb AND c.credential_fingerprint = $3`,
			[discordId, JSON.stringify(credential), fingerprint(discordId, value)]
		);
		return result.rows[0]?.[kind] ?? false;
	}
}
