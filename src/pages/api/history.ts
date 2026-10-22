import type { APIRoute } from 'astro';
import { getRoot } from '../../lib/config';
import { readDoc } from '../../lib/files';
import { findRepo, getDiff, getHistory } from '../../lib/git';
import { apiError, assertMethod, handleApiError, json } from '../../lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
	try {
		assertMethod(request, ['GET']);
		const rootId = url.searchParams.get('root') ?? '';
		const relPath = url.searchParams.get('path') ?? '';
		const hash = url.searchParams.get('hash');
		if (!rootId || !relPath) return apiError(400, 'root and path query parameters are required');
		const root = await getRoot(rootId);
		const doc = await readDoc(root, relPath);
		const repo = await findRepo(doc.absPath);
		if (!repo) {
			return json({ repo: null, entries: [], diff: null });
		}
		if (hash) {
			const diff = await getDiff(doc.absPath, hash);
			return json({ repo, entries: [], diff });
		}
		const entries = await getHistory(doc.absPath);
		return json({ repo, entries, diff: null });
	} catch (error) {
		return handleApiError(error);
	}
};
