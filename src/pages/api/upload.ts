import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig, getRoot } from '../../lib/config';
import { normalizeRelPath, resolveAssetPath } from '../../lib/files';
import { commitOutcomeNow } from '../../lib/commits';
import {
	apiError,
	assertMethod,
	assertSameOrigin,
	handleApiError,
	json,
} from '../../lib/http';

export const prerender = false;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/avif': 'avif',
	'image/bmp': 'bmp',
};

function safeBaseName(name: string): string {
	const base = path.basename(name.replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
	const cleaned = base
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-.]+|[-.]+$/g, '')
		.slice(0, 80);
	return cleaned || 'image';
}

function extensionFor(file: File): string | null {
	const byMime = MIME_EXTENSIONS[file.type.toLowerCase()];
	if (byMime) return byMime;
	const raw = path.extname(file.name).slice(1).toLowerCase();
	const normalized = raw === 'jpeg' ? 'jpg' : raw;
	return Object.values(MIME_EXTENSIONS).includes(normalized) ? normalized : null;
}

export const POST: APIRoute = async ({ request, url }) => {
	try {
		assertMethod(request, ['POST']);
		assertSameOrigin(request, url);

		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return apiError(400, 'Expected a multipart form upload');
		}

		const rootId = String(form.get('root') ?? '');
		const relPath = String(form.get('path') ?? '');
		const file = form.get('file');
		if (!rootId || !relPath) return apiError(400, 'root and path are required');
		if (!file || typeof file === 'string') return apiError(400, 'file is required');
		if (!file.size) return apiError(400, 'The image is empty');
		if (file.size > MAX_IMAGE_BYTES)
			return apiError(413, 'Images must be smaller than 12 MB');

		const ext = extensionFor(file);
		if (!ext) {
			return apiError(
				415,
				'Only PNG, JPEG, GIF, WebP, SVG, AVIF, and BMP images are supported'
			);
		}

		const root = await getRoot(rootId);
		const docRel = normalizeRelPath(relPath);
		const docDir = path.posix.dirname(docRel);
		const assetsDir = docDir === '.' ? 'assets' : `${docDir}/assets`;
		const base = safeBaseName(file.name);

		let name = `${base}.${ext}`;
		let targetRel = `${assetsDir}/${name}`;
		for (let counter = 2; ; counter += 1) {
			if (counter > 999) return apiError(409, 'Could not allocate a unique image name');
			try {
				await fs.access(path.resolve(root.absPath, targetRel));
				name = `${base}-${counter}.${ext}`;
				targetRel = `${assetsDir}/${name}`;
			} catch {
				break;
			}
		}

		// resolveAssetPath enforces the root boundary and the exclude globs.
		const asset = await resolveAssetPath(root, targetRel);
		await fs.mkdir(path.dirname(asset.absPath), { recursive: true });
		await fs.writeFile(asset.absPath, Buffer.from(await file.arrayBuffer()), {
			flag: 'wx',
		});

		const config = await getConfig();
		const commit = await commitOutcomeNow(asset.absPath, config.git, 'upload');

		return json({
			ok: true,
			url: `./assets/${encodeURIComponent(name)}`,
			path: asset.relPath,
			name,
			size: file.size,
			mime: file.type || null,
			commit,
		});
	} catch (error) {
		return handleApiError(error);
	}
};
