import type { APIRoute } from 'astro';
import { getConfig, getRoot } from '../../lib/config';
import { readDoc, writeDoc } from '../../lib/files';
import { commitOutcomeNow } from '../../lib/commits';
import {
	apiError,
	assertMethod,
	assertSameOrigin,
	handleApiError,
	json,
	readJson,
} from '../../lib/http';

export const prerender = false;

interface ToggleBody {
	root?: string;
	path?: string;
	offset?: number;
	checked?: boolean;
	baseHash?: string | null;
}

export const POST: APIRoute = async ({ request, url }) => {
	try {
		assertMethod(request, ['POST']);
		assertSameOrigin(request, url);
		const body = await readJson<ToggleBody>(request);
		const rootId = typeof body.root === 'string' ? body.root : '';
		const relPath = typeof body.path === 'string' ? body.path : '';
		if (!rootId || !relPath) return apiError(400, 'root and path are required');
		if (!Number.isInteger(body.offset) || (body.offset as number) < 0) {
			return apiError(400, 'offset must be a non-negative integer');
		}
		const offset = body.offset as number;
		const desired = body.checked === true;

		const config = await getConfig();
		const root = await getRoot(rootId);
		const current = await readDoc(root, relPath);

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

		const token = current.source.slice(offset, offset + 3);
		if (!/^\[[ xX]\]$/.test(token)) {
			return apiError(409, 'The task marker could not be found at the expected offset.', {
				code: 'STALE_OFFSET',
			});
		}
		const currentlyChecked = token[1].toLowerCase() === 'x';
		if (currentlyChecked === desired) {
			return json({ ok: true, unchanged: true, hash: current.hash, checked: desired });
		}

		const replacement = desired ? '[x]' : '[ ]';
		const source =
			current.source.slice(0, offset) + replacement + current.source.slice(offset + 3);
		const written = await writeDoc(root, relPath, source);
		const commit = await commitOutcomeNow(current.absPath, config.git, 'task');

		return json({
			ok: true,
			unchanged: false,
			hash: written.hash,
			checked: desired,
			commit,
			savedAt: new Date().toISOString(),
		});
	} catch (error) {
		return handleApiError(error);
	}
};
