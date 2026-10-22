import path from 'node:path';
import fs from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import rehypeShiki from '@shikijs/rehype';
import GithubSlugger from 'github-slugger';
import { visit } from 'unist-util-visit';
import { toString as mdastToString } from 'mdast-util-to-string';
import { splitFrontmatter } from './frontmatter';
import { hashContent } from './files';
import type { ResolvedRoot } from './types';

export interface RenderedHeading {
	depth: number;
	slug: string;
	text: string;
}

export interface RenderedDoc {
	title: string;
	description?: string;
	headings: RenderedHeading[];
	html: string;
	frontmatter: Record<string, unknown>;
	frontmatterError?: string;
	head: string;
	body: string;
	bodyOffset: number;
	hash: string;
}

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'code', 'table', 'math']);

/** Add the exact source offset of block nodes so the browser can edit them. */
function remarkSourceData(options: { body: string; bodyOffset: number }) {
	return (tree: any) => {
		visit(tree, (node: any) => {
			if (!node.position || typeof node.position.start.offset !== 'number') return;
			const start = node.position.start.offset;
			const end = node.position.end.offset;
			if (typeof end !== 'number') return;

			if (BLOCK_TYPES.has(node.type)) {
				node.data = node.data ?? {};
				node.data.hProperties = {
					...(node.data.hProperties ?? {}),
					'data-src-start': options.bodyOffset + start,
					'data-src-end': options.bodyOffset + end,
					'data-src-kind': node.type,
				};
			}

			if (node.type === 'listItem' && typeof node.checked === 'boolean') {
				const head = options.body.slice(start, Math.min(end, start + 24));
				const match = /\[[ xX]\]/.exec(head);
				if (match) {
					node.data = node.data ?? {};
					node.data.hProperties = {
						...(node.data.hProperties ?? {}),
						'data-task-offset': options.bodyOffset + start + match.index,
						'data-task-checked': node.checked ? 'true' : 'false',
					};
				}
			}
		});
	};
}

function textContent(node: any): string {
	if (!node) return '';
	if (node.type === 'text') return node.value ?? '';
	if (node.type === 'element' && Array.isArray(node.children)) {
		return node.children.map(textContent).join('');
	}
	return '';
}

const ANCHOR_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

function hastText(node: any): string {
	if (!node) return '';
	if (node.type === 'text') return node.value ?? '';
	if (Array.isArray(node.children)) return node.children.map(hastText).join('');
	return '';
}

function rehypeWrapMathBlocks() {
	return (tree: any) => {
		visit(tree, 'element', (node: any, index: number | undefined, parent: any) => {
			if (node.tagName !== 'pre' || !parent || typeof index !== 'number') return;
			const code = node.children?.find(
				(child: any) => child.type === 'element' && child.tagName === 'code'
			);
			const classes = Array.isArray(code?.properties?.className) ? code.properties.className : [];
			if (!classes.includes('math-display')) return;
			const start = node.properties?.dataSrcStart ?? node.properties?.['data-src-start'];
			const end = node.properties?.dataSrcEnd ?? node.properties?.['data-src-end'];
			parent.children[index] = {
				type: 'element',
				tagName: 'div',
				properties: {
					class: ['sl-math'],
					...(start != null ? { dataSrcStart: start } : {}),
					...(end != null ? { dataSrcEnd: end } : {}),
					dataSrcKind: 'math',
				},
				children: [node],
			};
		});
	};
}

function rehypeMermaidBlocks() {
	return (tree: any) => {
		visit(tree, 'element', (node: any, index: number | undefined, parent: any) => {
			if (node.tagName !== 'pre' || !parent || typeof index !== 'number') return;
			const code = node.children?.find(
				(child: any) => child.type === 'element' && child.tagName === 'code'
			);
			if (!code) return;
			const classes = Array.isArray(code.properties?.className) ? code.properties.className : [];
			const isMermaid =
				classes.includes('language-mermaid') || classes.includes('language-mmd');
			if (!isMermaid) return;
			const start = code.properties?.dataSrcStart ?? code.properties?.['data-src-start'];
			const end = code.properties?.dataSrcEnd ?? code.properties?.['data-src-end'];
			const source = hastText(code);
			const wrapper = {
				type: 'element',
				tagName: 'div',
				properties: {
					class: ['sl-mermaid'],
					...(start != null ? { dataSrcStart: start } : {}),
					...(end != null ? { dataSrcEnd: end } : {}),
					dataSrcKind: 'mermaid',
				},
				children: [
					{
						type: 'element',
						tagName: 'div',
						properties: { class: ['sl-mermaid-canvas'] },
						children: [
							{
								type: 'element',
								tagName: 'div',
								properties: { class: ['sl-mermaid-loading'] },
								children: [{ type: 'text', value: 'Rendering diagram…' }],
							},
						],
					},
					{
						type: 'element',
						tagName: 'div',
						properties: { class: ['sl-mermaid-error'], hidden: true },
						children: [],
					},
					{
						type: 'element',
						tagName: 'details',
						properties: { class: ['sl-mermaid-details'] },
						children: [
							{
								type: 'element',
								tagName: 'summary',
								properties: {},
								children: [{ type: 'text', value: 'Diagram source' }],
							},
							{
								type: 'element',
								tagName: 'code',
								properties: { class: ['sl-mermaid-source'] },
								children: [{ type: 'text', value: source }],
							},
						],
					},
				],
			};
			parent.children[index] = wrapper;
		});
	};
}

function rehypeWrapCodeBlocks() {
	return (tree: any) => {
		visit(tree, 'element', (node: any, index: number | undefined, parent: any) => {
			if (node.tagName !== 'pre' || !parent || typeof index !== 'number') return;
			const code = node.children?.find(
				(child: any) => child.type === 'element' && child.tagName === 'code'
			);
			const start = code?.properties?.['data-src-start'] ?? code?.properties?.dataSrcStart;
			const end = code?.properties?.['data-src-end'] ?? code?.properties?.dataSrcEnd;
			if (start == null || end == null) return;
			const wrapper = {
				type: 'element',
				tagName: 'div',
				properties: {
					class: ['sl-code-wrap'],
					dataSrcStart: start,
					dataSrcEnd: end,
					dataSrcKind: 'code',
				},
				children: [node],
			};
			parent.children[index] = wrapper;
		});
	};
}

function rehypeHeadingsAndAnchors(options: { headings: RenderedHeading[] }) {
	return (tree: any) => {
		const slugger = new GithubSlugger();
		visit(tree, 'element', (node: any, index: number | undefined, parent: any) => {
			if (!parent || typeof index !== 'number') return;
			const match = /^h([1-6])$/.exec(node.tagName);
			if (!match) return;
			const depth = Number(match[1]);
			const text = textContent(node).trim();
			if (!text) return;
			const id = slugger.slug(text);
			node.properties = node.properties ?? {};
			node.properties.id = id;

			if (depth >= 2) {
				options.headings.push({ depth, slug: id, text });
			}

			const anchor = {
				type: 'element',
				tagName: 'a',
				properties: {
					href: `#${id}`,
					class: ['sl-anchor-link'],
					ariaLabel: `Direct link to “${text}”`,
				},
				children: [
					{
						type: 'element',
						tagName: 'span',
						properties: { class: ['sl-anchor-icon'] },
						children: [{ type: 'raw', value: ANCHOR_SVG }],
					},
				],
			};

			const wrapper = {
				type: 'element',
				tagName: 'div',
				properties: { class: ['sl-heading-wrapper', `level-h${depth}`] },
				children: [node, anchor],
			};
			parent.children[index] = wrapper;
		});
	};
}

function safeDecodeURI(value: string): string | null {
	try {
		return decodeURI(value);
	} catch {
		return null;
	}
}

function isExternal(href: string): boolean {
	return (
		href.startsWith('#') ||
		href.startsWith('//') ||
		/^(?:[a-z][a-z0-9+.-]*:)/i.test(href) ||
		href.startsWith('/')
	);
}

function rehypeRewriteUrls(options: { root: ResolvedRoot; relPath: string }) {
	return (tree: any) => {
		const docDir = path.posix.dirname(options.relPath);

		function resolve(target: string): { resolved: string; abs: string } | null {
			const decoded = safeDecodeURI(target);
			if (decoded == null) return null;
			const resolved = path.posix.normalize(path.posix.join(docDir, decoded));
			if (resolved.startsWith('../') || resolved === '..' || resolved.startsWith('/')) return null;
			const abs = path.resolve(options.root.absPath, resolved);
			const relative = path.relative(options.root.absPath, abs);
			if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
			return { resolved, abs };
		}

		visit(tree, 'element', (node: any) => {
			const tag = node.tagName;
			if (tag !== 'a' && tag !== 'img' && tag !== 'source' && tag !== 'video' && tag !== 'audio') return;
			const attr = tag === 'a' ? 'href' : 'src';
			const value = node.properties?.[attr];
			if (typeof value !== 'string' || isExternal(value)) return;

			const hashIndex = value.search(/[?#]/);
			const target = hashIndex === -1 ? value : value.slice(0, hashIndex);
			const suffix = hashIndex === -1 ? '' : value.slice(hashIndex);
			if (!target) return;

			const resolved = resolve(target);
			if (!resolved) return;
			let exists = false;
			try {
				exists = fs.statSync(resolved.abs).isFile();
			} catch {
				exists = false;
			}
			if (!exists) return;

			if (resolved.resolved.toLowerCase().endsWith('.md')) {
				const url = `/browse/${encodeURIComponent(options.root.id)}/${resolved.resolved
					.split('/')
					.map(encodeURIComponent)
					.join('/')}${suffix}`;
				node.properties[attr] = url;
			} else {
				const url = `/api/asset?root=${encodeURIComponent(options.root.id)}&path=${encodeURIComponent(
					resolved.resolved
				)}${suffix}`;
				node.properties[attr] = url;
			}
		});
	};
}

function basenameTitle(relPath: string): string {
	const name = path.posix.basename(relPath, '.md').replace(/[-_]+/g, ' ').trim();
	return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Untitled';
}

export async function renderMarkdown(
	root: ResolvedRoot,
	relPath: string,
	source: string
): Promise<RenderedDoc> {
	const split = splitFrontmatter(source);
	const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
	const mdast = parser.parse(split.body) as any;

	let h1Title: string | undefined;
	const firstNode = mdast.children[0];
	if (firstNode && firstNode.type === 'heading' && firstNode.depth === 1) {
		h1Title = mdastToString(firstNode).trim() || undefined;
		mdast.children.shift();
	}

	const sourceDataPlugin = remarkSourceData({ body: split.body, bodyOffset: split.bodyOffset });
	sourceDataPlugin(mdast);

	const headings: RenderedHeading[] = [];
	const processor = unified()
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw)
		.use(rehypeWrapMathBlocks)
		.use(rehypeKatex, { throwOnError: false, strict: false })
		.use(rehypeMermaidBlocks)
		.use(rehypeWrapCodeBlocks)
		.use(rehypeShiki, {
			themes: { light: 'github-light', dark: 'github-dark' },
			defaultColor: false,
			fallbackLanguage: 'text',
			addLanguageClass: true,
		})
		.use(rehypeHeadingsAndAnchors, { headings })
		.use(rehypeRewriteUrls, { root, relPath })
		.use(rehypeStringify, { allowDangerousHtml: true });

	const transformed = await processor.run(mdast);
	const html = processor.stringify(transformed);

	const frontmatterTitle =
		typeof split.data.title === 'string' && split.data.title.trim()
			? split.data.title.trim()
			: undefined;

	return {
		title: frontmatterTitle ?? h1Title ?? basenameTitle(relPath),
		description:
			typeof split.data.description === 'string' ? split.data.description : undefined,
		headings,
		html,
		frontmatter: split.data,
		frontmatterError: split.error,
		head: split.head,
		body: split.body,
		bodyOffset: split.bodyOffset,
		hash: hashContent(source),
	};
}
