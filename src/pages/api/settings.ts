import fs from 'node:fs/promises';
import type { APIRoute } from 'astro';
import {
	ConfigError,
	CONFIG_PATH,
	loadConfig,
	parseConfig,
	readConfigFile,
	resolveRootPath,
	writeConfigFile,
} from '../../lib/config';
import {
	assertMethod,
	assertSameOrigin,
	handleApiError,
	json,
	readJson,
} from '../../lib/http';
import type { StorelightConfig } from '../../lib/types';

export const prerender = false;

async function resolvedRootInfo() {
	const resolved = await loadConfig();
	return Promise.all(
		resolved.roots.map(async (root) => {
			let exists = false;
			let isDirectory = false;
			try {
				const stat = await fs.stat(root.absPath);
				exists = true;
				isDirectory = stat.isDirectory();
			} catch {
				exists = false;
			}
			return {
				id: root.id,
				label: root.label,
				path: root.path,
				absPath: root.absPath,
				exists,
				isDirectory,
			};
		})
	);
}

export const GET: APIRoute = async ({ request }) => {
	try {
		assertMethod(request, ['GET']);
		const config = await readConfigFile();
		return json({
			config,
			resolvedRoots: await resolvedRootInfo(),
			configPath: CONFIG_PATH,
		});
	} catch (error) {
		return handleApiError(error);
	}
};

export const PUT: APIRoute = async ({ request, url }) => {
	try {
		assertMethod(request, ['PUT']);
		assertSameOrigin(request, url);
		const body = await readJson<{ config?: StorelightConfig }>(request);
		if (!body.config || typeof body.config !== 'object') {
			return json({ error: 'config is required', code: 'INVALID_CONFIG' }, 400);
		}
		const config = parseConfig(body.config);

		for (const root of config.roots) {
			const absPath = resolveRootPath(root.path);
			let stat;
			try {
				stat = await fs.stat(absPath);
			} catch {
				throw new ConfigError(
					`Root “${root.label}” does not exist at ${absPath}. Create the folder first or fix the path.`,
					{ rootId: root.id, path: absPath }
				);
			}
			if (!stat.isDirectory()) {
				throw new ConfigError(`Root “${root.label}” is not a directory: ${absPath}`, {
					rootId: root.id,
					path: absPath,
				});
			}
		}

		await writeConfigFile(config);
		return json({
			ok: true,
			config: await readConfigFile(),
			resolvedRoots: await resolvedRootInfo(),
			configPath: CONFIG_PATH,
		});
	} catch (error) {
		return handleApiError(error);
	}
};
