import { ConfigError } from './config';

const JSON_HEADERS = {
	'Content-Type': 'application/json; charset=utf-8',
	'Cache-Control': 'no-store',
};

export function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function apiError(
	status: number,
	message: string,
	extra?: Record<string, unknown>
): Response {
	return json({ error: message, ...extra }, status);
}

export function assertMethod(request: Request, methods: string[]): void {
	if (!methods.includes(request.method.toUpperCase())) {
		const error = new Error(`Method ${request.method} not allowed`) as Error & { status?: number };
		error.status = 405;
		throw error;
	}
}

function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/** Block cross-site browser writes while still allowing curl and same-origin requests. */
export function assertSameOrigin(request: Request, url: URL): void {
	if (request.method === 'GET' || request.method === 'HEAD') return;
	const origin = request.headers.get('origin');
	if (!origin) return;
	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		const error = new Error('Invalid Origin header') as Error & { status?: number };
		error.status = 403;
		throw error;
	}
	if (parsed.host === url.host) return;
	if (isLoopback(parsed.hostname) && isLoopback(url.hostname)) return;
	const error = new Error('Cross-site requests are not allowed') as Error & { status?: number };
	error.status = 403;
	throw error;
}

export async function readJson<T>(request: Request): Promise<T> {
	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) {
		const error = new Error('Expected an application/json request body') as Error & {
			status?: number;
		};
		error.status = 415;
		throw error;
	}
	const text = await request.text();
	if (text.length > 16 * 1024 * 1024) {
		const error = new Error('Request body is too large') as Error & { status?: number };
		error.status = 413;
		throw error;
	}
	try {
		return JSON.parse(text) as T;
	} catch {
		const error = new Error('Could not parse JSON request body') as Error & { status?: number };
		error.status = 400;
		throw error;
	}
}

export function handleApiError(error: unknown): Response {
	if (error instanceof ConfigError) {
		return apiError(400, error.message, { details: error.details, code: error.code });
	}
	const err = error as Error & { status?: number; code?: string; details?: unknown };
	const status = err.status ?? (err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500);
	if (status >= 500) console.error('[storelight] API error:', error);
	return apiError(status, err.message || 'Internal error', {
		code: err.code,
		details: err.details,
	});
}
