import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebsiteStorage, type WebsiteSession } from './storage';

export interface WebsiteConfig {
	origin: string;
	clientId: string;
	clientSecret: string;
	ownerId: string;
}

export type WebAuthConfig = { enabled: false } | (WebsiteConfig & { enabled: true; sessionTtlSeconds?: number });
type EnabledWebAuthConfig = Extract<WebAuthConfig, { enabled: true }>;

export interface AuthResponse {
	data: { user: { id: string; username: string } | null; csrfToken: string | null };
}

export class WebAuthError extends Error {
	public readonly status: number;

	public constructor(status: number, message: string) {
		super(message);
		this.name = 'WebAuthError';
		this.status = status;
	}
}

interface PendingAuthorization {
	state: string;
	verifier: string;
	expiresAt: number;
}

const SESSION_COOKIE = '__Host-website_session';
const STATE_COOKIE = '__Host-website_oauth';
const STATE_TTL_SECONDS = 600;
const RANDOM_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function randomToken(): string {
	return randomBytes(32).toString('base64url');
}

function sameToken(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
}

function readCookie(request: IncomingMessage, name: string): string | null {
	const matches = (request.headers.cookie ?? '')
		.split(';')
		.map((part) => part.trim())
		.filter((part) => part.startsWith(`${name}=`));
	if (matches.length !== 1) return null;
	const value = matches[0].slice(name.length + 1);
	return RANDOM_TOKEN.test(value) ? value : null;
}

function setCookie(response: ServerResponse, name: string, value: string, maxAge: number): void {
	const cookie = `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
	const existing = response.getHeader('Set-Cookie');
	response.setHeader('Set-Cookie', existing ? [...(Array.isArray(existing) ? existing.map(String) : [String(existing)]), cookie] : [cookie]);
}

function sensitiveHeaders(response: ServerResponse): void {
	response.setHeader('Cache-Control', 'no-store');
	response.setHeader('Referrer-Policy', 'no-referrer');
	response.setHeader('X-Content-Type-Options', 'nosniff');
}

function configuredOrigin(input: string): string {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new Error('Website origin must be an HTTPS origin or an HTTP localhost origin.');
	}
	if (
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	)
		throw new Error('Website origin must be an HTTPS origin or an HTTP localhost origin.');
	return url.origin;
}

export class WebAuth {
	private readonly origin: string;
	private readonly redirectUri: string;
	private readonly sessionTtlSeconds: number;
	private readonly pending = new Map<string, PendingAuthorization>();
	private readonly clientId: string;
	private readonly clientSecret: string;
	private readonly ownerId: string;
	private readonly storage: WebsiteStorage;
	private cleanupTimer?: ReturnType<typeof setTimeout>;

	public constructor(config: EnabledWebAuthConfig, storage: WebsiteStorage) {
		this.storage = storage;
		this.origin = configuredOrigin(config.origin);
		this.redirectUri = `${this.origin}/auth/discord/callback`;
		this.sessionTtlSeconds = config.sessionTtlSeconds ?? 86400;
		if (
			!config.clientId ||
			!config.clientSecret ||
			!config.ownerId ||
			!Number.isSafeInteger(this.sessionTtlSeconds) ||
			this.sessionTtlSeconds < 1 ||
			this.sessionTtlSeconds > 2592000
		) {
			throw new Error('Invalid website authentication configuration.');
		}
		this.clientId = config.clientId;
		this.clientSecret = config.clientSecret;
		this.ownerId = config.ownerId;
	}

	public startOAuth(request: IncomingMessage, response: ServerResponse): void {
		if (request.method !== 'GET') throw new WebAuthError(405, 'Method not allowed.');
		this.prunePending();
		if (this.pending.size >= 10000) throw new WebAuthError(503, 'Authentication temporarily unavailable.');
		const previous = readCookie(request, STATE_COOKIE);
		if (previous) this.pending.delete(previous);
		const handle = randomToken();
		const state = randomToken();
		const verifier = randomToken();
		this.pending.set(handle, { state, verifier, expiresAt: Date.now() + STATE_TTL_SECONDS * 1000 });
		this.scheduleCleanup();
		const url = new URL('https://discord.com/oauth2/authorize');
		url.search = new URLSearchParams({
			response_type: 'code',
			client_id: this.clientId,
			redirect_uri: this.redirectUri,
			scope: 'identify',
			state,
			code_challenge: createHash('sha256').update(verifier).digest('base64url'),
			code_challenge_method: 'S256'
		}).toString();
		sensitiveHeaders(response);
		setCookie(response, STATE_COOKIE, handle, STATE_TTL_SECONDS);
		response.writeHead(302, { Location: url.toString() });
		response.end();
	}

	public async handleCallback(request: IncomingMessage, response: ServerResponse): Promise<void> {
		sensitiveHeaders(response);
		setCookie(response, STATE_COOKIE, '', 0);
		try {
			if (request.method !== 'GET' || !request.url?.startsWith('/auth/discord/callback?'))
				throw new WebAuthError(400, 'Authentication failed.');
			const handle = readCookie(request, STATE_COOKIE);
			const pending = handle ? this.pending.get(handle) : undefined;
			if (handle) this.pending.delete(handle);
			this.prunePending();
			const params = new URL(request.url, this.origin).searchParams;
			const one = (key: string): string | null => {
				const values = params.getAll(key);
				return values.length === 1 ? values[0] : null;
			};
			const state = one('state');
			const code = one('code');
			if (
				!pending ||
				pending.expiresAt <= Date.now() ||
				!state ||
				!sameToken(state, pending.state) ||
				!code ||
				params.has('error') ||
				one('iss') !== 'https://discord.com'
			)
				throw new WebAuthError(400, 'Authentication failed.');
			const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					client_id: this.clientId,
					client_secret: this.clientSecret,
					grant_type: 'authorization_code',
					code,
					redirect_uri: this.redirectUri,
					code_verifier: pending.verifier
				}),
				redirect: 'error',
				signal: AbortSignal.timeout(10000)
			});
			if (!tokenResponse.ok) throw new WebAuthError(400, 'Authentication failed.');
			const token = (await tokenResponse.json()) as { access_token?: unknown; token_type?: unknown };
			if (
				typeof token.access_token !== 'string' ||
				!token.access_token ||
				typeof token.token_type !== 'string' ||
				token.token_type.toLowerCase() !== 'bearer'
			)
				throw new WebAuthError(400, 'Authentication failed.');
			const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
				headers: { Authorization: `Bearer ${token.access_token}` },
				redirect: 'error',
				signal: AbortSignal.timeout(10000)
			});
			if (!userResponse.ok) throw new WebAuthError(400, 'Authentication failed.');
			const user = (await userResponse.json()) as { id?: unknown; username?: unknown };
			if (
				typeof user.id !== 'string' ||
				!/^[0-9]{1,32}$/.test(user.id) ||
				typeof user.username !== 'string' ||
				user.username.length < 1 ||
				user.username.length > 128
			)
				throw new WebAuthError(400, 'Authentication failed.');
			if (user.id !== this.ownerId) throw new WebAuthError(403, 'Only the bot owner can use the dashboard.');
			const oldToken = readCookie(request, SESSION_COOKIE);
			if (oldToken) await this.storage.deleteSession(oldToken);
			const sessionToken = randomToken();
			await this.storage.createSession(sessionToken, {
				user: { id: user.id, username: user.username },
				csrfToken: randomToken(),
				expiresAt: new Date(Date.now() + this.sessionTtlSeconds * 1000)
			});
			setCookie(response, SESSION_COOKIE, sessionToken, this.sessionTtlSeconds);
			response.writeHead(303, { Location: `${this.origin}/` });
			response.end();
		} catch (error) {
			response.statusCode = error instanceof WebAuthError ? error.status : 503;
			response.setHeader('Content-Type', 'application/json; charset=utf-8');
			response.end(JSON.stringify({ error: 'Authentication failed.' }));
		}
	}

	public async getSession(request: IncomingMessage): Promise<WebsiteSession | null> {
		const token = readCookie(request, SESSION_COOKIE);
		const session = token ? await this.storage.getSession(token) : null;
		return session?.user.id === this.ownerId ? session : null;
	}

	public async getAuthResponse(request: IncomingMessage): Promise<AuthResponse> {
		const session = await this.getSession(request);
		return { data: { user: session?.user ?? null, csrfToken: session?.csrfToken ?? null } };
	}

	public async requireCsrf(request: IncomingMessage): Promise<WebsiteSession> {
		if (request.headers.origin !== this.origin) throw new WebAuthError(403, 'Forbidden.');
		const session = await this.getSession(request);
		if (!session) throw new WebAuthError(401, 'Authentication required.');
		if (!this.checkCsrf(request, session)) {
			throw new WebAuthError(403, 'Forbidden.');
		}
		return session;
	}

	public checkCsrf(request: IncomingMessage, session: WebsiteSession): boolean {
		const token = request.headers['x-csrf-token'];
		return typeof token === 'string' && RANDOM_TOKEN.test(token) && sameToken(token, session.csrfToken);
	}

	public async logout(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (request.method !== 'POST') throw new WebAuthError(405, 'Method not allowed.');
		await this.requireCsrf(request);
		const token = readCookie(request, SESSION_COOKIE);
		if (token) await this.storage.deleteSession(token);
		sensitiveHeaders(response);
		setCookie(response, SESSION_COOKIE, '', 0);
	}

	private prunePending(): void {
		const now = Date.now();
		for (const [key, value] of this.pending) if (value.expiresAt <= now) this.pending.delete(key);
	}

	private scheduleCleanup(): void {
		if (this.cleanupTimer) return;
		this.cleanupTimer = setTimeout(() => {
			this.cleanupTimer = undefined;
			this.prunePending();
			if (this.pending.size) this.scheduleCleanup();
		}, 60000);
		this.cleanupTimer.unref();
	}
}

/** Returns null without inspecting configuration or touching PostgreSQL when disabled. */
export function createWebAuth(config: WebAuthConfig, storage?: WebsiteStorage): WebAuth | null {
	if (!config.enabled) return null;
	if (!storage) throw new Error('Website storage is required.');
	return new WebAuth(config, storage);
}
