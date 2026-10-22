import type { APIRoute } from 'astro';
import { getConfig, getRoot } from '../../lib/config';
import { prettyName, readDoc, writeDoc } from '../../lib/files';
import { splitFrontmatter, titleFromSource } from '../../lib/frontmatter';
import { commitMessageFor } from '../../lib/git';
import { commitNow, flushCommit, scheduleCommit } from '../../lib/commits';
import {
	apiError,
	assertMethod,
	assertSameOrigin,
	handleApiError,
	json,
	readJson,
} from '../../lib/http';
import type { EditAction } from '../../lib/types';

export const prerender = false;

const ACTIONS: EditAction[] = ['wysiwyg', 'raw', 'frontmatter'];

interface SaveBody {
	root?: string;
	path?: string;
	content?: string;
	baseHash?: string | null;
	action?: EditAction;
	kind?: string;
	flush?: boolean;
}

export const GET: APIRoute = async ({ request, url }) => {
	try {
		assertMethod(request, ['GET']);
		const rootId = url.searchParams.get('root') ?? '';
		const relPath = url.searchParams.get('path') ?? '';
		if (!rootId || !relPath) return apiError(400, 'root and path query parameters are required');
		const root = await getRoot(rootId);
		const doc = await readDoc(root, relPath);
		const split = splitFrontmatter(doc.source);
		const title = titleFromSource(
			doc.source,
			prettyName(relPath.split('/').pop() ?? relPath)
		);
		return json({
			root: { id: root.id, label: root.label },
			path: doc.relPath,
			title,
			source: doc.source,
			hash: doc.hash,
			mtimeMs: doc.mtimeMs,
			size: doc.size,
			head: split.head,
			yaml: split.yaml,
			body: split.body,
			bodyOffset: split.bodyOffset,
			frontmatter: split.data,
			frontmatterError: split.error,
		});
	} catch (error) {
		return handleApiError(error);
	}
};

export const PUT: APIRoute = async ({ request, url }) => {
	try {
		assertMethod(request, ['PUT']);
		assertSameOrigin(request, url);
		const body = await readJson<SaveBody>(request);
		const rootId = typeof body.root === 'string' ? body.root : '';
		const relPath = typeof body.path === 'string' ? body.path : '';
		const content = body.content;
		if (!rootId || !relPath) return apiError(400, 'root and path are required');
		if (typeof content !== 'string') return apiError(400, 'content must be a string');
		const action: EditAction = ACTIONS.includes(body.action as EditAction)
			? (body.action as EditAction)
			: 'wysiwyg';
		const kind =
			typeof body.kind === 'string'
				? body.kind.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 32)
				: undefined;

		const config = await getConfig();
		const root = await getRoot(rootId);
		const current = await readDoc(root, relPath);

		if (body.baseHash && body.baseHash !== current.hash) {
			return json(
				{
					error: 'This file changed on disk since you opened it.',
					code: 'CONFLICT',
					current: { source: current.source, hash: current.hash },
				},
				409
			);
		}

		let hash = current.hash;
		let size = Buffer.byteLength(current.source, 'utf8');
		let unchanged = current.source === content;

		if (!unchanged) {
			const written = await writeDoc(root, relPath, content);
			hash = written.hash;
			size = written.size;
		}

		let commit:
			| {
					mode: 'disabled' | 'unavailable' | 'scheduled' | 'committed' | 'failed' | 'clean';
					message?: string;
					hash?: string;
					error?: string;
			  }
			| undefined;

		if (unchanged && !body.flush) {
			return json({
				ok: true,
				unchanged,
				hash,
				size,
				savedAt: new Date().toISOString(),
				commit: { mode: 'clean' },
			});
		}

		const { message, repo } = await commitMessageFor(
			current.absPath,
			config.git.commitPrefix,
			action,
			kind
		);

		if (!config.git.autoCommit) {
			commit = { mode: 'disabled' };
		} else if (!repo) {
			commit = { mode: 'unavailable', error: 'Not inside a git repository', message };
		} else if (body.flush) {
			const result = await (unchanged
				? flushCommit(current.absPath)
				: commitNow(current.absPath, message));
			if (!result) {
				commit = { mode: 'clean', message };
			} else {
				commit = {
					mode: result.committed ? 'committed' : 'failed',
					hash: result.hash,
					error: result.error,
					message,
				};
			}
		} else {
			scheduleCommit(current.absPath, message, config.git.debounceMs);
			commit = { mode: 'scheduled', message };
		}

		return json({
			ok: true,
			unchanged,
			hash,
			size,
			savedAt: new Date().toISOString(),
			commit,
		});
	} catch (error) {
		return handleApiError(error);
	}
};
