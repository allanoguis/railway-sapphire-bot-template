export interface Session {
	user: { id: string; username: string } | null;
	csrfToken: string | null;
	paired: boolean;
	consent: { profile: boolean; crimes: boolean };
}

export async function request<T>(
	path: string,
	options: { signal: AbortSignal; token?: string; body?: unknown; method?: 'GET' | 'POST' }
): Promise<T> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (options.method === 'POST') {
		if (!options.token) throw new Error('Your session is missing a CSRF token. Refresh the session and try again.');
		headers['X-CSRF-Token'] = options.token;
	}
	if (options.body !== undefined) headers['Content-Type'] = 'application/json';
	let response: Response;
	try {
		response = await fetch(path, {
			method: options.method ?? 'GET',
			credentials: 'same-origin',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: options.signal
		});
	} catch (error) {
		if (options.signal.aborted) throw error;
		throw new Error('Unable to reach the server. Please try again.');
	}
	let result: unknown;
	try {
		result = await response.json();
	} catch {
		throw new Error('The server returned an invalid response. Please try again.');
	}
	if (!result || typeof result !== 'object') throw new Error('The server returned an invalid response. Please try again.');
	const envelope = result as Record<string, unknown>;
	if (!response.ok || typeof envelope.error === 'string') {
		throw new Error(typeof envelope.error === 'string' ? envelope.error : 'The request failed. Please try again.');
	}
	if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
		throw new Error('The server returned an invalid response. Please try again.');
	}
	return envelope.data as T;
}
