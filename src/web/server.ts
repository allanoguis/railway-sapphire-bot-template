import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { Client } from 'discord.js';
import type { JsonValue, PostgresStorage } from '../lib/postgres-storage';
import { getTornFactionOrganizedCrimes } from '../features/torn/faction-oc';
import { getTornFactionUnregisteredReport } from '../features/torn/faction-unregistered';
import { isTornFeature } from '../features/torn/switches';
import {
	getTornFactionOverview,
	getTornProfile,
	pairTornAccount,
	TornApiError,
	unpairTornAccount,
	verifyTornAccount
} from '../features/torn/service';
import { FactionAccessError, requireFactionChannelAccess } from './permissions';
import { WebAuthError } from './auth';
import type { WebAuth } from './auth';
import type { WebsiteStorage } from './storage';

interface DashboardDependencies {
	auth: WebAuth;
	websiteStorage: WebsiteStorage;
	storage: PostgresStorage;
	client: Client;
	origin: string;
	ownerId: string;
	factionChannelId: string | undefined;
	logError: (message: string) => void;
}

class RequestError extends Error {
	public readonly status: number;
	public constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function json(response: ServerResponse, status: number, value: unknown): void {
	response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
	if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
		throw new RequestError(415, 'Use an application/json request.');
	}
	let raw = '';
	for await (const chunk of request) {
		raw += chunk.toString();
		if (Buffer.byteLength(raw) > 2048) throw new RequestError(413, 'Request is too large.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new RequestError(400, 'Invalid JSON request.');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestError(400, 'Expected a JSON object.');
	return parsed as Record<string, unknown>;
}

export function createDashboardServer(deps: DashboardDependencies): RequestListener {
	const requests = new Map<string, { started: number; count: number }>();
	function limit(key: string, maximum = 120): void {
		const now = Date.now();
		if (requests.size > 10_000) {
			for (const [entry, value] of requests) if (now - value.started >= 60_000) requests.delete(entry);
			if (requests.size > 10_000 && !requests.has(key)) throw new RequestError(429, 'Too many requests. Please try again later.');
		}
		const previous = requests.get(key);
		if (!previous || now - previous.started >= 60_000) requests.set(key, { started: now, count: 1 });
		else if (++previous.count > maximum) throw new RequestError(429, 'Too many requests. Please try again later.');
	}

	return (request, response) => {
		void (async () => {
			response.setHeader('Cache-Control', 'no-store');
			response.setHeader('X-Content-Type-Options', 'nosniff');
			response.setHeader('Referrer-Policy', 'no-referrer');
			response.setHeader('X-Frame-Options', 'DENY');
			if (deps.origin.startsWith('https://')) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
			response.setHeader(
				'Content-Security-Policy',
				"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
			);
			const url = new URL(request.url ?? '/', deps.origin);
			if (url.pathname === '/auth' || url.pathname === '/api') throw new RequestError(404, 'Not found.');
			if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/')) {
				limit(`client:${request.socket.remoteAddress ?? 'unknown'}`, 600);
			}
			if (url.pathname.startsWith('/auth/')) {
				limit(`auth:${request.socket.remoteAddress ?? 'unknown'}`);
				if (url.pathname === '/auth/discord') deps.auth.startOAuth(request, response);
				else if (url.pathname === '/auth/discord/callback') await deps.auth.handleCallback(request, response);
				else throw new RequestError(404, 'Not found.');
				return;
			}
			if (!url.pathname.startsWith('/api/')) {
				throw new RequestError(404, 'Not found.');
			}

			const session = await deps.auth.getSession(request);
			if (session && session.user.id !== deps.ownerId) throw new RequestError(403, 'Only the bot owner can use the dashboard.');
			if (url.pathname === '/api/session' && request.method === 'GET') {
				if (!session) {
					json(response, 200, {
						data: { user: null, csrfToken: null, paired: false, consent: { profile: false, crimes: false }, isOwner: false }
					});
					return;
				}
				limit(`user:${session.user.id}`);
				const paired = (await deps.storage.getTornApi(session.user.id)) !== undefined;
				const consent = paired ? await deps.websiteStorage.getConsent(session.user.id) : { profile: false, crimes: false };
				json(response, 200, {
					data: {
						user: session.user,
						csrfToken: session.csrfToken,
						paired,
						consent,
						isOwner: session.user.id === deps.ownerId
					}
				});
				return;
			}
			if (!session) throw new RequestError(401, 'Sign in with Discord to continue.');
			limit(`user:${session.user.id}`);
			if (url.pathname === '/api/owner/features' && session.user.id !== deps.ownerId) {
				throw new RequestError(403, 'Only the bot owner can manage feature switches.');
			}
			if (request.method === 'POST') {
				if (request.headers.origin !== deps.origin || !deps.auth.checkCsrf(request, session)) {
					throw new RequestError(403, 'The request could not be verified. Reload the page and try again.');
				}
				if (url.pathname === '/api/logout') {
					await deps.auth.logout(request, response);
					json(response, 200, { data: { loggedOut: true } });
					return;
				}
				if (url.pathname === '/api/owner/features') {
					const payload = await body(request);
					if (!isTornFeature(payload.feature) || typeof payload.enabled !== 'boolean') {
						throw new RequestError(400, 'Specify a valid feature and enabled state.');
					}
					await deps.storage.setTornFeatureEnabled(payload.feature, payload.enabled);
					json(response, 200, { data: await deps.storage.getTornFeatureSettings() });
					return;
				}
				if (url.pathname === '/api/pair') {
					const payload = await body(request);
					if (typeof payload.apiKey !== 'string') throw new RequestError(400, 'Enter a Torn API key.');
					json(response, 200, { data: await pairTornAccount(deps.storage, session.user.id, payload.apiKey) });
					return;
				}
				if (url.pathname === '/api/verify') {
					const result = await verifyTornAccount(deps.storage, session.user.id);
					if (!result) throw new RequestError(400, 'Pair a Torn API key first.');
					json(response, 200, { data: result });
					return;
				}
				if (url.pathname === '/api/unpair') {
					json(response, 200, { data: { unpaired: await unpairTornAccount(deps.storage, session.user.id) } });
					return;
				}
				if (url.pathname === '/api/consent') {
					const payload = await body(request);
					if (typeof payload.profile !== 'boolean' || typeof payload.crimes !== 'boolean') {
						throw new RequestError(400, 'Both website consent choices must be specified.');
					}
					const credential = await deps.storage.getTornApi(session.user.id);
					if (!credential) throw new RequestError(400, 'Pair a Torn API key first.');
					if (!(await deps.websiteStorage.setConsent(session.user.id, credential, { profile: payload.profile, crimes: payload.crimes }))) {
						throw new RequestError(409, 'Your paired key changed. Reload the page and try again.');
					}
					json(response, 200, { data: await deps.websiteStorage.getConsent(session.user.id) });
					return;
				}
			}
			if (request.method !== 'GET') throw new RequestError(405, 'Method not allowed.');
			if (url.pathname === '/api/owner/features') {
				json(response, 200, { data: await deps.storage.getTornFeatureSettings() });
				return;
			}
			if (url.pathname === '/api/profile') {
				const text = url.searchParams.get('playerId');
				if (text !== null && (!/^\d{1,15}$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < 1)) {
					throw new RequestError(400, 'Enter a valid positive Torn player ID.');
				}
				const check = async (owner: string, credential: JsonValue) => {
					if (!(await deps.websiteStorage.checkConsentForCredential(owner, credential, 'profile'))) {
						throw new RequestError(403, 'This player has not enabled private profile sharing on the website.');
					}
				};
				json(response, 200, { data: await getTornProfile(deps.storage, session.user.id, text === null ? undefined : Number(text), check) });
				return;
			}
			if (url.pathname.startsWith('/api/faction/')) {
				if (
					!['/api/faction/info', '/api/faction/members', '/api/faction/unregistered', '/api/faction/organized-crime'].includes(url.pathname)
				) {
					throw new RequestError(404, 'Not found.');
				}
				await requireFactionChannelAccess(deps.client, deps.factionChannelId, session.user.id);
				if (url.pathname === '/api/faction/unregistered') {
					json(response, 200, { data: await getTornFactionUnregisteredReport(deps.storage, session.user.id) });
					return;
				}
				if (url.pathname === '/api/faction/organized-crime') {
					const check = async (owner: string, credential: JsonValue) => {
						if (!(await deps.websiteStorage.checkConsentForCredential(owner, credential, 'crimes'))) {
							throw new RequestError(403, 'The faction leader has not enabled organized-crime access on the website.');
						}
					};
					json(response, 200, { data: await getTornFactionOrganizedCrimes(deps.storage, session.user.id, check) });
					return;
				}
				const overview = await getTornFactionOverview(deps.storage, session.user.id);
				const { tag_image: _tagImage, ...basic } = overview.basic;
				json(response, 200, { data: url.pathname === '/api/faction/members' ? overview.members : { ...overview, basic } });
				return;
			}
			throw new RequestError(404, 'Not found.');
		})().catch((error: unknown) => {
			if (response.headersSent) {
				response.destroy();
				return;
			}
			if (error instanceof RequestError) json(response, error.status, { error: error.message });
			else if (error instanceof WebAuthError) json(response, error.status, { error: error.message });
			else if (error instanceof FactionAccessError) json(response, 403, { error: error.message });
			else if (error instanceof TornApiError) json(response, error.code === 5 ? 429 : 400, { error: error.message });
			else {
				deps.logError('Website request failed unexpectedly.');
				json(response, 500, { error: 'Could not complete the request. Please try again later.' });
			}
		});
	};
}
