import type { APIRoute } from 'astro';
import { getRoot } from '../../lib/config';
import { normalizeRelPath } from '../../lib/files';
import { renderMarkdown } from '../../lib/markdown';
import {
	apiError,
	assertMethod,
	assertSameOrigin,
	handleApiError,
	json,
	readJson,
} from '../../lib/http';

export const prerender = false;

interface PreviewBody {
	root?: string;
	path?: string;
	content?: string;
}

export const POST: APIRoute = async ({ request, url }) => {
	try {
		assertMethod(request, ['POST']);
		assertSameOrigin(request, url);
		const body = await readJson<PreviewBody>(request);
		const rootId = typeof body.root === 'string' ? body.root : '';
		const relPath = typeof body.path === 'string' ? body.path : '';
		const content = body.content;
		if (!rootId || !relPath) return apiError(400, 'root and path are required');
		if (typeof content !== 'string') return apiError(400, 'content must be a string');
		const root = await getRoot(rootId);
		const normalized = normalizeRelPath(relPath);
		const rendered = await renderMarkdown(root, normalized, content);
		return json({
			html: rendered.html,
			headings: rendered.headings,
			title: rendered.title,
		});
	} catch (error) {
		return handleApiError(error);
	}
};
