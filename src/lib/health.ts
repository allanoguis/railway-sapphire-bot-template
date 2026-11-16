import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';

export function createHealthServer(isReady: () => boolean, website?: RequestListener): Server {
	return createServer((request, response) => {
		const path = new URL(request.url ?? '/', 'http://localhost').pathname;
		if (website && path !== '/healthz' && path !== '/readyz') {
			website(request, response);
			return;
		}
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('Content-Type', 'application/json; charset=utf-8');

		if (request.method !== 'GET') {
			response.setHeader('Allow', 'GET');
			response.statusCode = 405;
			response.end(JSON.stringify({ status: 'method_not_allowed' }));
			return;
		}

		if (path === '/healthz') {
			response.statusCode = 200;
			response.end(JSON.stringify({ status: 'ok' }));
			return;
		}

		if (path === '/readyz') {
			const ready = isReady();
			response.statusCode = ready ? 200 : 503;
			response.end(JSON.stringify({ status: ready ? 'ready' : 'not_ready' }));
			return;
		}

		response.statusCode = 404;
		response.end(JSON.stringify({ status: 'not_found' }));
	});
}

export function listenHealthServer(server: Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => {
			server.removeListener('listening', onListening);
			reject(error);
		};
		const onListening = () => {
			server.removeListener('error', onError);
			resolve();
		};

		server.once('error', onError);
		server.once('listening', onListening);
		server.listen(port, '0.0.0.0');
	});
}

export function closeHealthServer(server: Server): Promise<void> {
	if (!server.listening) return Promise.resolve();

	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}
