export interface RootConfig {
	/** Stable id used in URLs and API calls. */
	id: string;
	/** Human-friendly name shown in the tree and sidebar. */
	label: string;
	/** Directory path, absolute or relative to the config file. May start with `~`. */
	path: string;
	/** Glob patterns for Markdown files to include. */
	include: string[];
	/** Glob patterns to exclude. */
	exclude: string[];
}

export interface GitConfig {
	autoCommit: boolean;
	/** Wait this long after the last write before committing. */
	debounceMs: number;
	/** Subject prefix, e.g. `docs(storelight)`. */
	commitPrefix: string;
}

export interface EditorConfig {
	/** Client-side autosave delay. */
	autosaveMs: number;
}

export interface StorelightConfig {
	roots: RootConfig[];
	git: GitConfig;
	editor: EditorConfig;
}

export interface ResolvedRoot extends RootConfig {
	/** Absolute directory path. */
	absPath: string;
}

export interface ResolvedConfig extends Omit<StorelightConfig, 'roots'> {
	roots: ResolvedRoot[];
	configPath: string;
	configDir: string;
}

export interface FileEntry {
	/** POSIX path relative to the root. */
	path: string;
	title: string;
	size: number;
	mtimeMs: number;
}

export interface TreeNode {
	type: 'dir' | 'file';
	name: string;
	path: string;
	title?: string;
	children?: TreeNode[];
}

export interface DocMeta {
	root: ResolvedRoot;
	path: string;
	absPath: string;
	title: string;
	source: string;
	hash: string;
	head: string;
	frontmatter: Record<string, unknown>;
	body: string;
	bodyOffset: number;
}

export type EditAction = 'wysiwyg' | 'raw' | 'frontmatter' | 'inline' | 'task';

export interface CommitResult {
	committed: boolean;
	hash?: string;
	message?: string;
	repo?: string;
	error?: string;
}

export interface ApiError {
	error: string;
	code?: string;
	details?: unknown;
}
