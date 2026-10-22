import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import type { ResolvedConfig, ResolvedRoot, StorelightConfig } from './types';

export const CONFIG_FILENAME = 'storelight.config.json';
export const CONFIG_PATH = path.resolve(process.cwd(), CONFIG_FILENAME);
export const CONFIG_DIR = path.dirname(CONFIG_PATH);

export const DEFAULT_EXCLUDES = [
	'node_modules/**',
	'.git/**',
	'.astro/**',
	'dist/**',
	'**/node_modules/**',
	'**/.git/**',
	'**/.astro/**',
	'**/dist/**',
];

const idSchema = z
	.string()
	.trim()
	.min(1, 'Root id is required')
	.max(48)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Use letters, numbers, dashes and underscores only');

const rootSchema = z.object({
	id: idSchema,
	label: z.string().trim().min(1, 'Label is required').max(100),
	path: z.string().trim().min(1, 'Path is required'),
	include: z.array(z.string().trim().min(1)).min(1).default(['**/*.md']),
	exclude: z.array(z.string().trim().min(1)).default([]),
});

const configSchema = z.object({
	roots: z.array(rootSchema).default([]),
	git: z
		.object({
			autoCommit: z.boolean().default(true),
			debounceMs: z.number().int().min(250).max(60_000).default(2500),
			commitPrefix: z.string().trim().min(1).max(80).default('docs(storelight)'),
		})
		.default({ autoCommit: true, debounceMs: 2500, commitPrefix: 'docs(storelight)' }),
	editor: z
		.object({
			autosaveMs: z.number().int().min(200).max(10_000).default(900),
		})
		.default({ autosaveMs: 900 }),
});

export class ConfigError extends Error {
	code = 'CONFIG_ERROR';
	details?: unknown;
	constructor(message: string, details?: unknown) {
		super(message);
		this.details = details;
	}
}

export function expandHome(input: string): string {
	if (input === '~') return os.homedir();
	if (input.startsWith('~/') || input.startsWith('~\\')) {
		return path.join(os.homedir(), input.slice(2));
	}
	return input;
}

export function resolveRootPath(rootPath: string, configDir = CONFIG_DIR): string {
	const expanded = expandHome(rootPath);
	return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(configDir, expanded);
}

export function parseConfig(value: unknown): StorelightConfig {
	const parsed = configSchema.safeParse(value);
	if (!parsed.success) {
		throw new ConfigError('Invalid Storelight configuration', parsed.error.issues);
	}
	const roots = parsed.data.roots;
	const seen = new Set<string>();
	for (const root of roots) {
		if (seen.has(root.id)) {
			throw new ConfigError(`Duplicate root id: ${root.id}`);
		}
		seen.add(root.id);
	}
	return parsed.data;
}

export async function readConfigFile(): Promise<StorelightConfig> {
	let raw: string;
	try {
		raw = await fs.readFile(CONFIG_PATH, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return parseConfig({
				roots: [
					{
						id: 'demo',
						label: 'Demo docs',
						path: './content/demo',
						include: ['**/*.md'],
						exclude: ['drafts/**'],
					},
				],
			});
		}
		throw error;
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (error) {
		throw new ConfigError(`Could not parse ${CONFIG_FILENAME}: ${(error as Error).message}`);
	}
	return parseConfig(json);
}

export async function loadConfig(): Promise<ResolvedConfig> {
	const config = await readConfigFile();
	const roots: ResolvedRoot[] = config.roots.map((root) => ({
		...root,
		absPath: resolveRootPath(root.path),
	}));
	return { ...config, roots, configPath: CONFIG_PATH, configDir: CONFIG_DIR };
}

export async function writeConfigFile(config: StorelightConfig): Promise<void> {
	const parsed = parseConfig(config);
	const body = JSON.stringify({ $schema: './storelight.config.schema.json', ...parsed }, null, 2) + '\n';
	await fs.writeFile(CONFIG_PATH, body, 'utf8');
	invalidateConfigCaches();
}

// ---------------------------------------------------------------------------
// Small caches. Kept on globalThis so Astro's dev server HMR does not reset them
// on every request.
// ---------------------------------------------------------------------------

type Cache = {
	config?: { expires: number; value: ResolvedConfig };
};

const globalCache = globalThis as typeof globalThis & { __storelightCache?: Cache };
const cache: Cache = (globalCache.__storelightCache ??= {});

const CONFIG_TTL = 500;

export async function getConfig(): Promise<ResolvedConfig> {
	const now = Date.now();
	if (cache.config && cache.config.expires > now) return cache.config.value;
	const value = await loadConfig();
	cache.config = { expires: now + CONFIG_TTL, value };
	return value;
}

export function invalidateConfigCaches(): void {
	cache.config = undefined;
}

export async function getRoot(rootId: string): Promise<ResolvedRoot> {
	const config = await getConfig();
	const root = config.roots.find((entry) => entry.id === rootId);
	if (!root) throw new ConfigError(`Unknown content root: ${rootId}`);
	return root;
}
