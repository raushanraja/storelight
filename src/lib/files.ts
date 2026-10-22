import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import fg from 'fast-glob';
import type { Entry } from 'fast-glob';
import micromatch from 'micromatch';
import { DEFAULT_EXCLUDES, ConfigError } from './config';
import { titleFromSource } from './frontmatter';
import type { FileEntry, ResolvedConfig, ResolvedRoot, TreeNode } from './types';

const MAX_DOC_BYTES = 12 * 1024 * 1024;

const manifests = new Map<string, { expires: number; files: FileEntry[] }>();
const titleCache = new Map<string, string>();
const MANIFEST_TTL = 800;

export function hashContent(content: string): string {
	return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function prettyName(name: string): string {
	const withoutExt = name.replace(/\.md$/i, '');
	const words = withoutExt.replace(/[-_]+/g, ' ').trim();
	if (!words) return name;
	return words.charAt(0).toUpperCase() + words.slice(1);
}

async function readTitle(absPath: string, stat: { mtimeMs: number; size: number }): Promise<string> {
	const cacheKey = `${absPath}:${stat.mtimeMs}:${stat.size}`;
	const cached = titleCache.get(cacheKey);
	if (cached !== undefined) return cached;

	let title = prettyName(path.basename(absPath));
	try {
		const handle = await fs.open(absPath, 'r');
		try {
			const buffer = Buffer.alloc(8192);
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
			const head = buffer.subarray(0, bytesRead).toString('utf8');
			title = titleFromSource(head, title);
		} finally {
			await handle.close();
		}
	} catch {
		// Keep the filename-based fallback.
	}

	if (titleCache.size > 5000) titleCache.clear();
	titleCache.set(cacheKey, title);
	return title;
}

function rootCacheKey(root: ResolvedRoot): string {
	return `${root.id}:${root.absPath}:${root.include.join(',')}:${root.exclude.join(',')}`;
}

export async function scanRoot(root: ResolvedRoot, force = false): Promise<FileEntry[]> {
	const key = rootCacheKey(root);
	const now = Date.now();
	if (!force) {
		const cached = manifests.get(key);
		if (cached && cached.expires > now) return cached.files;
	}

	let entries: Entry[];
	try {
		entries = (await fg(root.include.length ? root.include : ['**/*.md'], {
			cwd: root.absPath,
			ignore: [...DEFAULT_EXCLUDES, ...root.exclude],
			onlyFiles: true,
			dot: false,
			stats: true,
			unique: true,
			followSymbolicLinks: true,
		})) as Entry[];
	} catch (error) {
		throw new ConfigError(
			`Could not scan root “${root.label}” at ${root.absPath}: ${(error as Error).message}`,
			{ rootId: root.id }
		);
	}

	const files: FileEntry[] = [];
	const chunkSize = 32;
	for (let index = 0; index < entries.length; index += chunkSize) {
		const chunk = entries.slice(index, index + chunkSize);
		const resolved = await Promise.all(
			chunk.map(async (entry) => {
				const rel = entry.path.split(path.sep).join('/');
				const stat = entry.stats;
				if (!stat || !rel.toLowerCase().endsWith('.md')) return null;
				const absPath = path.resolve(root.absPath, rel);
				return {
					path: rel,
					title: await readTitle(absPath, { mtimeMs: stat.mtimeMs, size: stat.size }),
					size: stat.size,
					mtimeMs: stat.mtimeMs,
				} satisfies FileEntry;
			})
		);
		for (const file of resolved) if (file) files.push(file);
	}

	files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
	manifests.set(key, { expires: now + MANIFEST_TTL, files });
	return files;
}

export function invalidateRootManifest(root: ResolvedRoot): void {
	manifests.delete(rootCacheKey(root));
}

export function buildTree(files: FileEntry[]): TreeNode[] {
	const rootNodes: TreeNode[] = [];

	function getDirNode(parts: string[]): TreeNode[] {
		let current = rootNodes;
		let currentPath = '';
		let node: TreeNode | undefined;
		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			node = current.find((entry) => entry.type === 'dir' && entry.name === part);
			if (!node) {
				node = { type: 'dir', name: part, path: currentPath, children: [] };
				current.push(node);
			}
			current = node.children!;
		}
		return current;
	}

	for (const file of files) {
		const parts = file.path.split('/');
		const filename = parts.pop()!;
		const parent = getDirNode(parts);
		parent.push({
			type: 'file',
			name: filename,
			path: file.path,
			title: file.title,
		});
	}

	function sortNodes(nodes: TreeNode[]): void {
		nodes.sort((a, b) => {
			if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
		});
		for (const node of nodes) if (node.children) sortNodes(node.children);
	}
	sortNodes(rootNodes);
	return rootNodes;
}

export async function listAllRoots(config: ResolvedConfig): Promise<
	Array<{
		id: string;
		label: string;
		path: string;
		absPath: string;
		files: FileEntry[];
		tree: TreeNode[];
		error?: string;
	}>
> {
	const results = await Promise.all(
		config.roots.map(async (root) => {
			try {
				const files = await scanRoot(root);
				return {
					id: root.id,
					label: root.label,
					path: root.path,
					absPath: root.absPath,
					files,
					tree: buildTree(files),
				};
			} catch (error) {
				return {
					id: root.id,
					label: root.label,
					path: root.path,
					absPath: root.absPath,
					files: [],
					tree: [],
					error: (error as Error).message,
				};
			}
		})
	);
	return results;
}

export function isInside(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate);
	return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function normalizeRelPath(input: string): string {
	const raw = input.replace(/\\/g, '/').trim();
	if (!raw || raw.startsWith('/') || raw.includes('\0')) {
		throw new ConfigError('Invalid document path');
	}
	const normalized = path.posix.normalize(raw);
	if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
		throw new ConfigError('Document path escapes its content root');
	}
	if (!normalized.toLowerCase().endsWith('.md')) {
		throw new ConfigError('Only Markdown (.md) documents are supported');
	}
	return normalized;
}

export async function resolveDocPath(
	root: ResolvedRoot,
	relInput: string
): Promise<{ relPath: string; absPath: string }> {
	const relPath = normalizeRelPath(relInput);
	const absPath = path.resolve(root.absPath, relPath);
	if (!isInside(root.absPath, absPath)) {
		throw new ConfigError('Document path escapes its content root');
	}
	let files = await scanRoot(root);
	if (!files.some((file) => file.path === relPath)) {
		files = await scanRoot(root, true);
		if (!files.some((file) => file.path === relPath)) {
			throw new ConfigError('Document is not part of this content root (check include/exclude patterns)', {
				rootId: root.id,
				path: relPath,
			});
		}
	}
	return { relPath, absPath };
}

export async function resolveAssetPath(
	root: ResolvedRoot,
	relInput: string
): Promise<{ relPath: string; absPath: string }> {
	const raw = relInput.replace(/\\/g, '/').trim();
	if (!raw || raw.startsWith('/') || raw.includes('\0')) {
		throw new ConfigError('Invalid asset path');
	}
	const relPath = path.posix.normalize(raw);
	if (relPath === '.' || relPath.startsWith('../') || relPath.includes('/../')) {
		throw new ConfigError('Asset path escapes its content root');
	}
	const exclude = [...DEFAULT_EXCLUDES, ...root.exclude];
	if (micromatch.isMatch(relPath, exclude, { dot: true })) {
		throw new ConfigError('Asset is excluded by this root’s configuration');
	}
	const absPath = path.resolve(root.absPath, relPath);
	if (!isInside(root.absPath, absPath)) {
		throw new ConfigError('Asset path escapes its content root');
	}
	return { relPath, absPath };
}

export async function readDoc(
	root: ResolvedRoot,
	relInput: string
): Promise<{ relPath: string; absPath: string; source: string; hash: string; mtimeMs: number; size: number }> {
	const { relPath, absPath } = await resolveDocPath(root, relInput);
	const stat = await fs.stat(absPath);
	if (stat.size > MAX_DOC_BYTES) throw new ConfigError('Document is larger than the 12 MB limit');
	const source = await fs.readFile(absPath, 'utf8');
	return { relPath, absPath, source, hash: hashContent(source), mtimeMs: stat.mtimeMs, size: stat.size };
}

export async function writeDoc(
	root: ResolvedRoot,
	relInput: string,
	content: string
): Promise<{ relPath: string; absPath: string; hash: string; size: number }> {
	if (Buffer.byteLength(content, 'utf8') > MAX_DOC_BYTES) {
		throw new ConfigError('Refusing to write a document larger than 12 MB');
	}
	const { relPath, absPath } = await resolveDocPath(root, relInput);
	await fs.writeFile(absPath, content, 'utf8');
	invalidateRootManifest(root);
	return { relPath, absPath, hash: hashContent(content), size: Buffer.byteLength(content, 'utf8') };
}
