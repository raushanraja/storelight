import type { APIRoute } from 'astro';
import { getConfig, getRoot } from '../../lib/config';
import { readDoc, writeDoc } from '../../lib/files';
import { commitOutcomeNow } from '../../lib/commits';
import { splitFrontmatter } from '../../lib/frontmatter';
import {
	apiError,
	assertMethod,
	assertSameOrigin,
	handleApiError,
	json,
	readJson,
} from '../../lib/http';

export const prerender = false;

const MAX_BLOCK_BYTES = 2 * 1024 * 1024;

interface EditBody {
	root?: string;
	path?: string;
	start?: number;
	end?: number;
	text?: string;
	baseHash?: string | null;
	kind?: string;
}

export const POST: APIRoute = async ({ request, url }) => {
	try {
		assertMethod(request, ['POST']);
		assertSameOrigin(request, url);
		const body = await readJson<EditBody>(request);
		const rootId = typeof body.root === 'string' ? body.root : '';
		const relPath = typeof body.path === 'string' ? body.path : '';
		if (!rootId || !relPath) return apiError(400, 'root and path are required');
		if (!Number.isInteger(body.start) || !Number.isInteger(body.end)) {
			return apiError(400, 'start and end must be integers');
		}
		const start = body.start as number;
		const end = body.end as number;
		if (start < 0 || end < start) return apiError(400, 'Invalid source range');
		if (typeof body.text !== 'string') return apiError(400, 'text must be a string');
		if (Buffer.byteLength(body.text, 'utf8') > MAX_BLOCK_BYTES) {
			return apiError(413, 'Replacement block is too large');
		}
		const kind =
			typeof body.kind === 'string'
				? body.kind.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 32)
				: 'block';

		const config = await getConfig();
		const root = await getRoot(rootId);
		const current = await readDoc(root, relPath);
		if (end > current.source.length) return apiError(400, 'Source range is out of bounds');

		if (body.baseHash && body.baseHash !== current.hash) {
			return json(
				{
					error: 'This file changed on disk since the page was opened.',
					code: 'CONFLICT',
					current: { source: current.source, hash: current.hash },
				},
				409
			);
		}

		const source = current.source.slice(0, start) + body.text + current.source.slice(end);
		const split = splitFrontmatter(source);
		if (split.error && !splitFrontmatter(current.source).error) {
			return apiError(400, `That edit would break the frontmatter: ${split.error}`);
		}

		const written = await writeDoc(root, relPath, source);
		const commit = await commitOutcomeNow(current.absPath, config.git, 'inline', kind);

		return json({
			ok: true,
			hash: written.hash,
			kind,
			commit,
			savedAt: new Date().toISOString(),
		});
	} catch (error) {
		return handleApiError(error);
	}
};
