import type { Pool, QueryResultRow } from 'pg';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface SettingRow extends QueryResultRow {
	value: JsonValue;
}

export class PostgresStorage {
	private closed = false;

	public constructor(private readonly pool: Pick<Pool, 'query' | 'end'>) {}

	public async initialize(): Promise<void> {
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS bot_settings (
				scope TEXT NOT NULL,
				setting_key TEXT NOT NULL,
				value JSONB NOT NULL,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				PRIMARY KEY (scope, setting_key)
			)
		`);
	}

	public async get(scope: string, key: string): Promise<JsonValue | undefined> {
		const result = await this.pool.query<SettingRow>('SELECT value FROM bot_settings WHERE scope = $1 AND setting_key = $2', [scope, key]);
		return result.rows[0]?.value;
	}

	public async set(scope: string, key: string, value: JsonValue): Promise<void> {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) {
			throw new TypeError('Setting value must be JSON serializable.');
		}

		await this.pool.query(
			`INSERT INTO bot_settings (scope, setting_key, value)
			VALUES ($1, $2, $3::jsonb)
			ON CONFLICT (scope, setting_key)
			DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
			[scope, key, serialized]
		);
	}

	public async delete(scope: string, key: string): Promise<boolean> {
		const result = await this.pool.query('DELETE FROM bot_settings WHERE scope = $1 AND setting_key = $2', [scope, key]);
		return (result.rowCount ?? 0) > 0;
	}

	public async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.pool.end();
	}
}
