import type { Pool, QueryResultRow } from 'pg';
import { tornFeatures, type TornFeature } from '../features/torn/switches';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface VerifiedUserRow extends QueryResultRow {
	torn_api: JsonValue;
}

interface RegisteredPlayerIdRow extends QueryResultRow {
	player_id: string;
}

interface RegisteredTornApiRow extends QueryResultRow {
	discord_id: string;
	torn_api: JsonValue;
}

export class PostgresStorage {
	private closed = false;

	public constructor(private readonly pool: Pick<Pool, 'query' | 'end'>) {}

	public async initialize(): Promise<boolean> {
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS torn_feature_settings (
				feature TEXT PRIMARY KEY,
				enabled BOOLEAN NOT NULL,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS verified_users (
				discord_id TEXT PRIMARY KEY,
				torn_api JSONB NOT NULL,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await this.pool.query(`
			DO $$
			BEGIN
				PERFORM pg_advisory_xact_lock(hashtext('railway-sapphire-bot:verified-users-migration')::bigint);

				IF to_regclass('bot_settings') IS NOT NULL THEN
					INSERT INTO verified_users (discord_id, torn_api, updated_at)
					SELECT substring(scope FROM 6), value, updated_at
					FROM bot_settings
					WHERE setting_key = 'torn-api-credential'
						AND scope LIKE 'user:%'
						AND length(scope) > 5
					ON CONFLICT (discord_id) DO NOTHING;

					IF NOT EXISTS (
						SELECT 1
						FROM bot_settings
						WHERE setting_key <> 'torn-api-credential'
							OR scope NOT LIKE 'user:%'
							OR length(scope) <= 5
					) THEN
						DROP TABLE bot_settings;
					END IF;
				END IF;
			END
			$$;
		`);

		const result = await this.pool.query<{ legacy_settings_remain: boolean }>(
			"SELECT to_regclass('bot_settings') IS NOT NULL AS legacy_settings_remain"
		);
		return result.rows[0]?.legacy_settings_remain ?? false;
	}

	public async getTornApi(discordId: string): Promise<JsonValue | undefined> {
		const result = await this.pool.query<VerifiedUserRow>('SELECT torn_api FROM verified_users WHERE discord_id = $1', [discordId]);
		return result.rows[0]?.torn_api;
	}

	public async isTornFeatureEnabled(feature: TornFeature): Promise<boolean> {
		const result = await this.pool.query<{ enabled: boolean }>('SELECT enabled FROM torn_feature_settings WHERE feature = $1', [feature]);
		return result.rows[0]?.enabled ?? true;
	}

	public async getTornFeatureSettings(): Promise<Record<TornFeature, boolean>> {
		const result = await this.pool.query<{ feature: string; enabled: boolean }>('SELECT feature, enabled FROM torn_feature_settings');
		const values = new Map(result.rows.map((row) => [row.feature, row.enabled]));
		return Object.fromEntries(tornFeatures.map((feature) => [feature, values.get(feature) ?? true])) as Record<TornFeature, boolean>;
	}

	public async setTornFeatureEnabled(feature: TornFeature, enabled: boolean): Promise<void> {
		await this.pool.query(
			`INSERT INTO torn_feature_settings (feature, enabled) VALUES ($1, $2)
			ON CONFLICT (feature) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
			[feature, enabled]
		);
	}

	public async getTornApiByPlayerId(playerId: number): Promise<{ discordId: string; tornApi: JsonValue } | undefined> {
		if (!Number.isSafeInteger(playerId) || playerId <= 0) {
			throw new RangeError('Torn player ID must be a positive safe integer.');
		}

		const result = await this.pool.query<RegisteredTornApiRow>(
			`SELECT discord_id, torn_api
			FROM verified_users
			WHERE torn_api ->> 'playerId' = $1
			ORDER BY updated_at DESC
			LIMIT 1`,
			[String(playerId)]
		);
		const row = result.rows[0];
		return row ? { discordId: row.discord_id, tornApi: row.torn_api } : undefined;
	}

	public async getRegisteredTornPlayerIds(playerIds: readonly number[]): Promise<Set<number>> {
		if (playerIds.length === 0) return new Set();

		const result = await this.pool.query<RegisteredPlayerIdRow>(
			`SELECT DISTINCT torn_api ->> 'playerId' AS player_id
			FROM verified_users
			WHERE torn_api ->> 'playerId' = ANY($1::text[])`,
			[playerIds.map(String)]
		);
		return new Set(result.rows.map((row) => Number(row.player_id)).filter((playerId) => Number.isSafeInteger(playerId) && playerId > 0));
	}

	public async setTornApi(discordId: string, tornApi: JsonValue): Promise<void> {
		const serialized = JSON.stringify(tornApi);
		if (serialized === undefined) {
			throw new TypeError('Torn credential must be JSON serializable.');
		}

		await this.pool.query(
			`INSERT INTO verified_users (discord_id, torn_api)
			VALUES ($1, $2::jsonb)
			ON CONFLICT (discord_id)
			DO UPDATE SET torn_api = EXCLUDED.torn_api, updated_at = NOW()`,
			[discordId, serialized]
		);
	}

	public async deleteTornApi(discordId: string): Promise<boolean> {
		const result = await this.pool.query('DELETE FROM verified_users WHERE discord_id = $1', [discordId]);
		return (result.rowCount ?? 0) > 0;
	}

	public async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.pool.end();
	}
}
