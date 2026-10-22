import { parse as parseYaml } from 'yaml';

export interface SplitFrontmatter {
	/** Raw text up to and including the closing frontmatter delimiter and its newline. */
	head: string;
	/** YAML contents without delimiters. */
	yaml: string;
	/** Markdown body. */
	body: string;
	/** Byte/character offset where the body starts in the original source. */
	bodyOffset: number;
	data: Record<string, unknown>;
	error?: string;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(source: string): SplitFrontmatter {
	const match = FRONTMATTER_RE.exec(source);
	if (!match) {
		return { head: '', yaml: '', body: source, bodyOffset: 0, data: {} };
	}
	const head = source.slice(0, match[0].length);
	const yaml = match[1];
	let data: Record<string, unknown> = {};
	let error: string | undefined;
	try {
		const parsed = parseYaml(yaml);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			data = parsed as Record<string, unknown>;
		} else if (parsed != null) {
			error = 'Frontmatter must be a YAML mapping';
		}
	} catch (parseError) {
		error = (parseError as Error).message;
	}
	return {
		head,
		yaml,
		body: source.slice(match[0].length),
		bodyOffset: match[0].length,
		data,
		error,
	};
}

export function stringifyFrontmatter(yaml: string): string {
	const trimmed = yaml.replace(/\s+$/, '');
	return trimmed ? `---\n${trimmed}\n---\n\n` : '';
}

function stripInlineMarkdown(value: string): string {
	return value
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[*_~`]+/g, '')
		.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
		.trim();
}

/** Best-effort title for trees and API metadata: frontmatter, then first H1, then fallback. */
export function titleFromSource(source: string, fallback: string): string {
	const split = splitFrontmatter(source);
	if (typeof split.data.title === 'string' && split.data.title.trim()) {
		return split.data.title.trim();
	}
	let inFence = false;
	let firstHeadingSeen = false;
	for (const line of split.body.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (/^(```|~~~)/.test(trimmed)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const match = /^(#{1,6})\s+(.+)$/.exec(trimmed);
		if (match) {
			if (match[1].length === 1 && !firstHeadingSeen) {
				const title = stripInlineMarkdown(match[2]);
				if (title) return title;
			}
			firstHeadingSeen = true;
		}
	}
	return fallback;
}

