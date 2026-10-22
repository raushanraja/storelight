import mime from 'mime-types';
import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import { getRoot } from '../../lib/config';
import { resolveAssetPath } from '../../lib/files';
import { apiError, assertMethod, handleApiError } from '../../lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
	try {
		assertMethod(request, ['GET']);
		const rootId = url.searchParams.get('root') ?? '';
		const relPath = url.searchParams.get('path') ?? '';
		if (!rootId || !relPath) return apiError(400, 'root and path query parameters are required');
		const root = await getRoot(rootId);
		const { absPath, relPath: resolvedPath } = await resolveAssetPath(root, relPath);
		const stat = await fs.stat(absPath);
		if (!stat.isFile()) return apiError(404, 'Asset not found');
		if (stat.size > 32 * 1024 * 1024) return apiError(413, 'Asset is larger than 32 MB');
		const data = await fs.readFile(absPath);
		const contentType = mime.lookup(resolvedPath) || 'application/octet-stream';
		return new Response(data, {
			headers: {
				'Content-Type': contentType,
				'Content-Length': String(data.byteLength),
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff',
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
};
