import type { APIRoute } from 'astro';
import { getConfig } from '../../lib/config';
import { listAllRoots } from '../../lib/files';
import { assertMethod, handleApiError, json } from '../../lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		assertMethod(request, ['GET']);
		const config = await getConfig();
		const roots = await listAllRoots(config);
		return json({
			roots: roots.map((root) => ({
				id: root.id,
				label: root.label,
				path: root.path,
				absPath: root.absPath,
				files: root.files.map((file) => ({
					path: file.path,
					title: file.title,
					size: file.size,
					mtimeMs: file.mtimeMs,
				})),
				tree: root.tree,
				error: root.error,
			})),
			git: config.git,
			editor: config.editor,
		});
	} catch (error) {
		return handleApiError(error);
	}
};
