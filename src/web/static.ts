import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const assets = join(process.cwd(), 'web', 'dist');
const contentTypes: Record<string, string> = {
	js: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8',
	svg: 'image/svg+xml',
	png: 'image/png',
	webp: 'image/webp',
	ico: 'image/x-icon'
};

export async function serveWebsite(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.writeHead(405, { Allow: 'GET, HEAD' });
		response.end();
		return;
	}

	let path: string;
	let contentType: string;
	if (pathname === '/' || /^\/[a-zA-Z0-9_-]+\/?$/.test(pathname)) {
		path = join(assets, 'index.html');
		contentType = 'text/html; charset=utf-8';
	} else {
		const match = /^\/assets\/([a-zA-Z0-9_-]+)\.(js|css|svg|png|webp|ico)$/.exec(pathname);
		if (!match) {
			response.writeHead(404);
			response.end();
			return;
		}
		path = join(assets, 'assets', `${match[1]}.${match[2]}`);
		contentType = contentTypes[match[2]];
	}

	try {
		const body = await readFile(path);
		response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
		response.end(request.method === 'HEAD' ? undefined : body);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			response.writeHead(path.endsWith('index.html') ? 503 : 404);
			response.end();
			return;
		}
		throw error;
	}
}
