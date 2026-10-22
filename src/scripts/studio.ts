import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { configureMermaid, mermaid } from './mermaid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
	path: string;
	title: string;
	size: number;
	mtimeMs: number;
}

interface TreeNode {
	type: 'dir' | 'file';
	name: string;
	path: string;
	title?: string;
	children?: TreeNode[];
}

interface RootInfo {
	id: string;
	label: string;
	path: string;
	absPath: string;
	files: FileEntry[];
	tree: TreeNode[];
	error?: string;
}

interface TreeResponse {
	roots: RootInfo[];
	git: { autoCommit: boolean; debounceMs: number; commitPrefix: string };
	editor: { autosaveMs: number };
}

interface DocResponse {
	root: { id: string; label: string };
	path: string;
	title: string;
	source: string;
	hash: string;
	mtimeMs: number;
	size: number;
	head: string;
	yaml: string;
	body: string;
	bodyOffset: number;
	frontmatter: Record<string, unknown>;
	frontmatterError?: string;
}

interface CommitOutcome {
	mode: 'disabled' | 'unavailable' | 'scheduled' | 'committed' | 'failed' | 'clean';
	message?: string;
	hash?: string;
	error?: string;
}

interface SaveResponse {
	ok: boolean;
	unchanged?: boolean;
	hash: string;
	size: number;
	savedAt: string;
	commit?: CommitOutcome;
}

interface HistoryEntry {
	hash: string;
	shortHash: string;
	author: string;
	relativeDate: string;
	date: string;
	subject: string;
}

interface ApiFailure extends Error {
	status?: number;
	code?: string;
	payload?: any;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function byId<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing #${id}`);
	return element as T;
}

function make<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text != null) element.textContent = text;
	return element;
}

function icon(id: string, className = 'icon'): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('class', className);
	const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
	use.setAttribute('href', `#${id}`);
	svg.append(use);
	return svg;
}

function encodePath(relPath: string): string {
	return relPath
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
}

function docUrl(rootId: string, relPath: string): string {
	return `/browse/${encodeURIComponent(rootId)}/${encodePath(relPath)}`;
}

function prettyName(name: string): string {
	const withoutExt = name.replace(/\.md$/i, '');
	const words = withoutExt.replace(/[-_]+/g, ' ').trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

function splitContent(source: string): { yaml: string; body: string } {
	const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
	if (!match) return { yaml: '', body: source };
	return { yaml: match[1], body: source.slice(match[0].length) };
}

function buildHead(yaml: string): string {
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

function documentTitle(yaml: string, body: string, path: string): string {
	const frontmatterMatch = /^title:\s*(.+)$/m.exec(yaml);
	if (frontmatterMatch) {
		let value = frontmatterMatch[1].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		value = value.replace(/\s+#.*$/, '').trim();
		if (value) return value;
	}
	let inFence = false;
	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (/^(```|~~~)/.test(trimmed)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const match = /^#\s+(.+)$/.exec(trimmed);
		if (match) {
			const title = stripInlineMarkdown(match[1]);
			if (title) return title;
		}
	}
	return prettyName(path.split('/').pop() ?? path);
}

function frontmatterLabel(yaml: string): string {
	const count = yaml.split('\n').filter((line) => line.trim()).length;
	if (!count) return 'empty';
	return `${count} ${count === 1 ? 'key' : 'keys'}`;
}

function wordCount(text: string): number {
	const stripped = text
		.replace(/^---[\s\S]*?---\s*/m, '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/[#>*_`~[\]()!-]/g, ' ');
	return stripped.trim().split(/\s+/).filter(Boolean).length;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		...init,
		headers: {
			...(init?.body ? { 'Content-Type': 'application/json' } : {}),
			...(init?.headers ?? {}),
		},
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		const failure = new Error(payload.error || `Request failed (${response.status})`) as ApiFailure;
		failure.status = response.status;
		failure.code = payload.code;
		failure.payload = payload;
		throw failure;
	}
	return payload as T;
}

// ---------------------------------------------------------------------------
// Studio
// ---------------------------------------------------------------------------

export function initStudio(): void {
	const treeEl = byId('file-tree');
	const filterEl = byId<HTMLInputElement>('file-filter');
	const rootSummary = byId('root-summary');
	const loadingState = byId('loading-state');
	const emptyState = byId('empty-state');
	const emptyMessage = byId('empty-message');
	const editorPanel = byId('editor-panel');
	const saveButton = byId<HTMLButtonElement>('save-button');
	const historyButton = byId<HTMLButtonElement>('history-button');
	const themeToggle = byId<HTMLButtonElement>('theme-toggle');
	const sidebarToggle = byId<HTMLButtonElement>('sidebar-toggle');
	const sidebarBackdrop = byId<HTMLButtonElement>('sidebar-backdrop');
	const crumbRoot = byId('crumb-root');
	const crumbTitle = byId('crumb-title');
	const docTitle = byId('doc-title');
	const docPath = byId('doc-path');
	const saveState = byId('save-state');
	const wordCountEl = byId('word-count');
	const charCountEl = byId('char-count');
	const frontmatterPanel = byId<HTMLDetailsElement>('frontmatter-panel');
	const frontmatterHint = byId('frontmatter-hint');
	const frontmatterInput = byId<HTMLTextAreaElement>('frontmatter-input');
	const richEditor = byId('rich-editor');
	const rawEditor = byId('raw-editor');
	const viewLink = byId<HTMLAnchorElement>('view-link');
	const statusSave = byId('status-save');
	const statusCommit = byId('status-commit');
	const statusPosition = byId('status-position');
	const statusSavedAt = byId('status-saved-at');
	const statusDot = byId('status-dot');
	const toastEl = byId('toast');
	const modeButtons = Array.from(
		document.querySelectorAll<HTMLButtonElement>('[data-mode]')
	);
	const modeCaption = byId('mode-caption');

	const state = {
		roots: [] as RootInfo[],
		git: { autoCommit: true, debounceMs: 2500, commitPrefix: 'docs(storelight)' },
		autosaveMs: 900,
		rootId: '',
		path: '',
		doc: null as DocResponse | null,
		mode: 'wysiwyg' as 'wysiwyg' | 'raw',
		yaml: '',
		body: '',
		baseHash: '',
		lastSaved: '',
		dirty: false,
		saving: false,
		pauseAutosave: false,
		pendingAction: 'wysiwyg' as 'wysiwyg' | 'raw' | 'frontmatter',
		saveTimer: undefined as ReturnType<typeof setTimeout> | undefined,
		savedAt: '',
		crepe: null as Crepe | null,
		rawView: null as EditorView | null,
		richReady: false,
		rawReady: false,
		richBaseline: '',
		userInteracted: false,
		loadToken: 0,
		filter: '',
		conflict: null as null | { currentSource: string; currentHash: string },
		saveQueue: Promise.resolve(true) as Promise<boolean>,
	};

	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let mermaidPreviewId = 0;

	function ensureMermaid(): void {
		configureMermaid();
	}

	function toast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
		toastEl.textContent = message;
		toastEl.dataset.tone = tone;
		toastEl.classList.add('is-visible');
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 4800);
	}

	// -----------------------------------------------------------------------
	// Theme & chrome
	// -----------------------------------------------------------------------

	function applyTheme(theme: 'dark' | 'light'): void {
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem('storelight:theme', theme);
		} catch {}
	}

	applyTheme(
		document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
	);
	themeToggle.addEventListener('click', () => {
		applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
		ensureMermaid();
	});

	function closeSidebar(): void {
		document.body.classList.remove('sidebar-open');
	}
	sidebarToggle.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
	sidebarBackdrop.addEventListener('click', closeSidebar);

	// -----------------------------------------------------------------------
	// Save status
	// -----------------------------------------------------------------------

	function setStatus(
		text: string,
		tone: 'clean' | 'dirty' | 'saving' | 'error' = 'clean'
	): void {
		saveState.textContent = text;
		saveState.dataset.tone = tone;
		statusSave.textContent = text;
		statusDot.dataset.tone = tone;
	}

	function commitLabel(commit?: CommitOutcome): string {
		if (!commit) return '';
		switch (commit.mode) {
			case 'scheduled':
				return 'Commit queued';
			case 'committed':
				return commit.hash ? `Committed ${commit.hash}` : 'Committed';
			case 'disabled':
				return 'Auto-commit off';
			case 'unavailable':
				return 'No git repo';
			case 'clean':
				return 'Nothing new to commit';
			case 'failed':
				return 'Commit failed';
			default:
				return '';
		}
	}

	function setCommitStatus(commit: CommitOutcome | undefined, error?: string): void {
		statusCommit.textContent = commitLabel(commit) || error || 'Auto-commit enabled';
		statusCommit.title = commit?.message ?? error ?? '';
		statusCommit.dataset.tone =
			commit?.mode === 'failed' || error ? 'error' : commit?.mode === 'committed' ? 'success' : 'muted';
	}

	function updateStats(content: string): void {
		const words = wordCount(content);
		wordCountEl.textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`;
		charCountEl.textContent = `${content.length.toLocaleString()} chars`;
	}

	// -----------------------------------------------------------------------
	// Sidebar
	// -----------------------------------------------------------------------

	function fileButton(rootId: string, path: string, title: string): HTMLButtonElement {
		const button = make('button', 'file-item');
		button.type = 'button';
		button.dataset.root = rootId;
		button.dataset.path = path;
		button.title = path;
		button.append(icon('i-file'));
		const label = make('span', 'file-label', title || prettyName(path.split('/').pop() ?? path));
		button.append(label);
		if (state.rootId === rootId && state.path === path) button.classList.add('is-active');
		return button;
	}

	function treeChildren(rootId: string, nodes: TreeNode[]): DocumentFragment {
		const fragment = document.createDocumentFragment();
		for (const node of nodes) {
			if (node.type === 'file') {
				fragment.append(fileButton(rootId, node.path, node.title ?? node.name));
				continue;
			}
			const details = make('details', 'tree-dir');
			details.open = true;
			const summary = make('summary', 'tree-dir-summary');
			summary.append(icon('i-chevron', 'icon tree-chevron'), icon('i-folder', 'icon'));
			summary.append(make('span', 'tree-dir-label', prettyName(node.name)));
			details.append(summary);
			const kids = make('div', 'tree-dir-children');
			kids.append(treeChildren(rootId, node.children ?? []));
			details.append(kids);
			fragment.append(details);
		}
		return fragment;
	}

	function renderTree(): void {
		treeEl.replaceChildren();
		const filter = state.filter.trim().toLowerCase();

		if (filter) {
			let total = 0;
			for (const root of state.roots) {
				const matches = root.files.filter(
					(file) =>
						file.title.toLowerCase().includes(filter) ||
						file.path.toLowerCase().includes(filter)
				);
				if (!matches.length) continue;
				total += matches.length;
				const group = make('section', 'filter-group');
				group.append(make('div', 'filter-heading', `${root.label} · ${matches.length}`));
				for (const file of matches) group.append(fileButton(root.id, file.path, file.title));
				treeEl.append(group);
			}
			if (!total) {
				treeEl.append(make('p', 'tree-empty', 'No files match that filter.'));
			}
			return;
		}

		for (const root of state.roots) {
			const group = make('details', 'root-group');
			group.open = root.id === state.rootId;
			const summary = make('summary', 'root-head');
			const left = make('span', 'root-head-left');
			left.append(icon('i-folder'), make('span', 'root-label', root.label));
			summary.append(left);
			summary.append(make('span', 'root-count', String(root.files.length)));
			group.append(summary);

			if (root.error) {
				const error = make('div', 'root-error');
				error.append(icon('i-alert', 'icon'));
				error.append(make('span', '', root.error));
				group.append(error);
				const link = make('a', 'root-error-link', 'Open settings');
				link.href = '/studio/settings';
				group.append(link);
			} else if (!root.files.length) {
				group.append(make('p', 'tree-empty', 'No Markdown files match this root.'));
			} else {
				const children = make('div', 'root-children');
				children.append(treeChildren(root.id, root.tree));
				group.append(children);
			}
			treeEl.append(group);
		}

		if (!state.roots.length) {
			treeEl.append(
				make('p', 'tree-empty', 'No roots configured. Add one in Roots & settings.')
			);
		}

		requestAnimationFrame(() => {
			treeEl.querySelector('.file-item.is-active')?.scrollIntoView({ block: 'nearest' });
		});
	}

	async function loadTree(): Promise<void> {
		const data = await api<TreeResponse>('/api/tree');
		state.roots = data.roots;
		state.git = data.git;
		state.autosaveMs = data.editor.autosaveMs;
		const totalFiles = state.roots.reduce((sum, root) => sum + root.files.length, 0);
		rootSummary.textContent = `${state.roots.length} ${
			state.roots.length === 1 ? 'root' : 'roots'
		} · ${totalFiles} files`;
		statusCommit.textContent = data.git.autoCommit
			? `Auto-commit on · ${(data.git.debounceMs / 1000).toFixed(1)}s`
			: 'Auto-commit off';
		renderTree();
	}

	treeEl.addEventListener('click', (event) => {
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.file-item');
		if (!button?.dataset.root || !button.dataset.path) return;
		void selectFile(button.dataset.root, button.dataset.path);
	});

	filterEl.addEventListener('input', () => {
		state.filter = filterEl.value;
		renderTree();
	});
	filterEl.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			filterEl.value = '';
			state.filter = '';
			renderTree();
			filterEl.blur();
		}
	});

	// -----------------------------------------------------------------------
	// Document loading / editors
	// -----------------------------------------------------------------------

	async function destroyEditors(): Promise<void> {
		state.richReady = false;
		state.rawReady = false;
		if (state.crepe) {
			const crepe = state.crepe;
			state.crepe = null;
			try {
				await crepe.destroy();
			} catch {}
		}
		if (state.rawView) {
			state.rawView.destroy();
			state.rawView = null;
		}
		richEditor.replaceChildren();
		rawEditor.replaceChildren();
	}

	function updateUrl(): void {
		if (!state.rootId || !state.path) return;
		const url = `/studio?root=${encodeURIComponent(state.rootId)}&path=${encodeURIComponent(
			state.path
		)}`;
		history.replaceState(null, '', url);
	}

	function updateHeader(): void {
		const doc = state.doc;
		if (!doc) return;
		const root = state.roots.find((entry) => entry.id === state.rootId);
		docTitle.textContent = doc.title;
		docPath.textContent = `${root?.label ?? doc.root.label} / ${doc.path}`;
		crumbRoot.textContent = root?.label ?? doc.root.label;
		crumbTitle.textContent = doc.path.split('/').pop() ?? doc.path;
		viewLink.href = docUrl(state.rootId, doc.path);
		viewLink.title = `View ${doc.title}`;
		document.title = `${doc.title} — Storelight Studio`;
	}

	function setModeUi(): void {
		for (const button of modeButtons) {
			const active = button.dataset.mode === state.mode;
			button.classList.toggle('is-active', active);
			button.setAttribute('aria-pressed', String(active));
		}
		modeCaption.textContent = state.mode === 'wysiwyg' ? 'Visual editor' : 'Raw Markdown';
		frontmatterPanel.hidden = state.mode === 'raw';
		richEditor.hidden = state.mode !== 'wysiwyg';
		rawEditor.hidden = state.mode !== 'raw';
	}

	async function mountRich(body: string, token: number): Promise<void> {
		if (token !== state.loadToken) return;
		richEditor.hidden = false;
		rawEditor.hidden = true;
		frontmatterPanel.hidden = false;
		richEditor.replaceChildren();
		ensureMermaid();
		const crepe = new Crepe({
			root: richEditor,
			defaultValue: body,
			featureConfigs: {
				[Crepe.Feature.CodeMirror]: {
					renderPreview(language, content, applyPreview) {
						if (language !== 'mermaid' && language !== 'mmd') return null;
						const loading = document.createElement('div');
						loading.className = 'sl-mermaid-preview-loading';
						loading.textContent = 'Rendering diagram…';
						applyPreview(loading);
						const id = `sl-crepe-mermaid-${++mermaidPreviewId}`;
						void mermaid
							.render(id, content)
							.then(({ svg }) => applyPreview(svg))
							.catch((error: unknown) => {
								const failure = document.createElement('div');
								failure.className = 'sl-mermaid-preview-error';
								failure.textContent = `Mermaid error: ${(error as Error).message}`;
								applyPreview(failure);
							});
						return undefined;
					},
				},
			},
		});
		state.crepe = crepe;
		crepe.on((listener) => {
			listener.markdownUpdated((_ctx, markdownText) => {
				if (!state.richReady || state.mode !== 'wysiwyg') return;
				state.body = markdownText;
				// Crepe can emit normalization events right after mounting (bullet style,
				// table padding, etc.). Treat those as the new baseline, not as edits.
				if (!state.userInteracted) {
					state.richBaseline = markdownText;
					return;
				}
				if (markdownText === state.richBaseline) return;
				markChanged('wysiwyg');
			});
		});
		await crepe.create();
		if (token !== state.loadToken) return;
		state.richBaseline = crepe.getMarkdown();
		state.userInteracted = false;
		state.richReady = true;
	}

	function mountRaw(content: string, token: number): void {
		if (token !== state.loadToken) return;
		state.rawView?.destroy();
		rawEditor.replaceChildren();
		state.rawReady = false;
		const view = new EditorView({
			state: EditorState.create({
				doc: content,
				extensions: [
					basicSetup,
					markdown(),
					EditorView.lineWrapping,
					syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
					placeholder('Write Markdown…'),
					EditorView.theme({
						'&': {
							backgroundColor: 'transparent',
							color: 'var(--text)',
							height: '100%',
						},
						'.cm-scroller': {
							fontFamily: 'var(--font-mono)',
							fontSize: '13.5px',
							lineHeight: '1.7',
							overflow: 'auto',
						},
						'.cm-content': { padding: '26px 0 120px', caretColor: 'var(--accent)' },
						'.cm-gutters': {
							backgroundColor: 'transparent',
							color: 'var(--faint)',
							border: 'none',
							paddingLeft: '8px',
						},
						'.cm-activeLine': { backgroundColor: 'var(--line-hover)' },
						'.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
						'&.cm-focused': { outline: 'none' },
						'.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
							backgroundColor: 'var(--selection)',
						},
						'.cm-cursor': { borderLeftColor: 'var(--accent)' },
						'.cm-tooltip': {
							backgroundColor: 'var(--panel-2)',
							border: '1px solid var(--border)',
							color: 'var(--text)',
						},
					}),
					EditorView.updateListener.of((update) => {
						if (update.selectionSet || update.docChanged) {
							const head = update.state.selection.main.head;
							const line = update.state.doc.lineAt(head);
							statusPosition.textContent = `Ln ${line.number}, Col ${head - line.from + 1}`;
						}
						if (!update.docChanged || !state.rawReady || state.mode !== 'raw') return;
						markChanged('raw');
					}),
				],
			}),
			parent: rawEditor,
		});
		state.rawView = view;
		state.rawReady = true;
	}

	async function loadDoc(rootId: string, path: string): Promise<void> {
		const token = ++state.loadToken;
		editorPanel.classList.add('is-loading');
		saveButton.disabled = true;
		historyButton.disabled = true;
		setStatus('Loading…', 'saving');
		try {
			const doc = await api<DocResponse>(
				`/api/doc?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`
			);
			if (token !== state.loadToken) return;
			state.rootId = rootId;
			state.path = path;
			state.doc = doc;
			state.yaml = doc.yaml;
			state.body = doc.body;
			state.baseHash = doc.hash;
			state.lastSaved = doc.source;
			state.dirty = false;
			state.pauseAutosave = false;
			state.savedAt = new Date(doc.mtimeMs).toISOString();
			state.rootId = rootId;
			frontmatterInput.value = doc.yaml;
			frontmatterHint.textContent = frontmatterLabel(doc.yaml);
			frontmatterPanel.open = false;
			if (doc.frontmatterError) {
				toast(`Frontmatter warning: ${doc.frontmatterError}`, 'error');
			}
			updateHeader();
			setModeUi();
			updateStats(doc.source);
			statusSavedAt.textContent = '';
			editorPanel.hidden = false;
			loadingState.hidden = true;
			emptyState.hidden = true;
			saveButton.disabled = false;
			historyButton.disabled = false;
			for (const button of modeButtons) button.disabled = false;
			updateUrl();
			renderTree();
			await destroyEditors();
			if (token !== state.loadToken) return;
			if (state.mode === 'wysiwyg') {
				frontmatterPanel.hidden = false;
				await mountRich(doc.body, token);
			} else {
				frontmatterPanel.hidden = true;
				mountRaw(doc.source, token);
			}
			if (token !== state.loadToken) return;
			setStatus('Saved', 'clean');
			setCommitStatus(undefined, undefined);
			statusCommit.textContent = state.git.autoCommit
				? `Auto-commit on · ${(state.git.debounceMs / 1000).toFixed(1)}s`
				: 'Auto-commit off';
		} catch (error) {
			if (token !== state.loadToken) return;
			const failure = error as ApiFailure;
			toast(failure.message || 'Could not load that document', 'error');
			editorPanel.hidden = true;
			loadingState.hidden = true;
			emptyState.hidden = false;
			emptyMessage.textContent = failure.message || 'Could not load that document.';
			setStatus('Load failed', 'error');
		} finally {
			editorPanel.classList.remove('is-loading');
		}
	}

	async function selectFile(rootId: string, path: string): Promise<void> {
		if (rootId === state.rootId && path === state.path) {
			closeSidebar();
			return;
		}
		if (state.dirty || state.saving) {
			const saved = await requestSave(true);
			if (!saved) {
				toast('Save the current file before switching.', 'error');
				return;
			}
		}
		closeSidebar();
		await loadDoc(rootId, path);
	}

	// -----------------------------------------------------------------------
	// Change tracking and autosave
	// -----------------------------------------------------------------------

	function buildContent(): string {
		if (state.mode === 'raw') return state.rawView?.state.doc.toString() ?? state.lastSaved;
		const body =
			state.crepe && state.richReady ? state.crepe.getMarkdown() : state.body;
		return `${buildHead(state.yaml)}${body}`;
	}

	function markChanged(action: 'wysiwyg' | 'raw' | 'frontmatter'): void {
		state.pendingAction = action;
		state.pauseAutosave = false;
		const content = buildContent();
		if (content === state.lastSaved) {
			state.dirty = false;
			setStatus('Saved', 'clean');
			updateStats(content);
			return;
		}
		state.dirty = true;
		setStatus('Unsaved changes', 'dirty');
		updateStats(content);
		scheduleAutosave();
	}

	function scheduleAutosave(): void {
		if (state.pauseAutosave) return;
		if (state.saveTimer) clearTimeout(state.saveTimer);
		state.saveTimer = setTimeout(() => {
			state.saveTimer = undefined;
			void requestSave(false);
		}, state.autosaveMs);
	}

	frontmatterInput.addEventListener('input', () => {
		if (state.mode === 'raw') return;
		state.yaml = frontmatterInput.value;
		frontmatterHint.textContent = frontmatterLabel(state.yaml);
		markChanged('frontmatter');
	});

	function requestSave(flush = false): Promise<boolean> {
		if (state.saveTimer) {
			clearTimeout(state.saveTimer);
			state.saveTimer = undefined;
		}
		const run = () => doSave(flush);
		state.saveQueue = state.saveQueue.then(run, run).catch(() => false);
		return state.saveQueue;
	}

	async function doSave(flush: boolean): Promise<boolean> {
		if (!state.doc) return true;
		if (!state.dirty && !flush) {
			setStatus('Saved', 'clean');
			return true;
		}
		if (state.pauseAutosave && !flush) return false;
		const content = state.dirty ? buildContent() : state.lastSaved;
		const action = state.mode === 'raw' ? 'raw' : state.pendingAction;

		state.saving = true;
		const token = state.loadToken;
		saveButton.disabled = true;
		setStatus('Saving…', 'saving');
		try {
			const result = await api<SaveResponse>('/api/doc', {
				method: 'PUT',
				body: JSON.stringify({
					root: state.rootId,
					path: state.path,
					content,
					baseHash: state.baseHash,
					action,
					flush,
				}),
			});
			if (token !== state.loadToken) return true;
			state.baseHash = result.hash;
			state.lastSaved = content;
			state.richBaseline = state.crepe && state.richReady ? state.crepe.getMarkdown() : state.richBaseline;
			state.savedAt = result.savedAt;
			state.dirty = state.mode === 'raw'
				? (state.rawView?.state.doc.toString() ?? content) !== content
				: buildContent() !== content;
			state.pauseAutosave = false;
			statusSavedAt.textContent = `saved ${new Date(result.savedAt).toLocaleTimeString()}`;
			if (state.dirty) {
				setStatus('Unsaved changes', 'dirty');
				scheduleAutosave();
			} else {
				setStatus(flush ? 'Saved & committed' : 'Saved', 'clean');
			}
			setCommitStatus(result.commit);
			if (result.commit?.mode === 'failed') {
				toast(`Saved, but the commit failed: ${result.commit.error ?? 'unknown error'}`, 'error');
			} else if (flush && result.commit?.mode === 'committed') {
				toast(`Saved · ${commitLabel(result.commit)}`, 'success');
			}
			if (state.doc) {
				const savedSplit = splitContent(content);
				const headerTitle = documentTitle(savedSplit.yaml, savedSplit.body, state.path);
				if (headerTitle !== state.doc.title) {
					state.doc.title = headerTitle;
					updateHeader();
				}
			}
			return true;
		} catch (error) {
			if (token !== state.loadToken) return false;
			const failure = error as ApiFailure;
			if (failure.status === 409 && failure.code === 'CONFLICT') {
				state.pauseAutosave = true;
				state.conflict = {
					currentSource: failure.payload?.current?.source ?? '',
					currentHash: failure.payload?.current?.hash ?? '',
				};
				showConflictDialog();
				setStatus('Save conflict', 'error');
			} else {
				setStatus('Save failed', 'error');
				toast(failure.message || 'Could not save the document', 'error');
			}
			return false;
		} finally {
			if (token === state.loadToken) {
				state.saving = false;
				saveButton.disabled = false;
			}
		}
	}

	saveButton.addEventListener('click', () => void requestSave(true));

	document.addEventListener('keydown', (event) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			if (state.doc) void requestSave(true);
			return;
		}
		const target = event.target as HTMLElement;
		const typing =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target.isContentEditable ||
			Boolean(target.closest('.cm-editor, .milkdown'));
		if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
			event.preventDefault();
			filterEl.focus();
		}
	});

	const markInteracted = () => {
		if (state.mode === 'wysiwyg') state.userInteracted = true;
	};
	richEditor.addEventListener('pointerdown', markInteracted, { capture: true });
	richEditor.addEventListener('keydown', markInteracted, { capture: true });
	richEditor.addEventListener('paste', markInteracted, { capture: true });
	richEditor.addEventListener('drop', markInteracted, { capture: true });

	window.addEventListener('beforeunload', (event) => {
		if (state.dirty) {
			event.preventDefault();
		}
	});

	// -----------------------------------------------------------------------
	// Mode switching
	// -----------------------------------------------------------------------

	async function switchMode(mode: 'wysiwyg' | 'raw'): Promise<void> {
		if (mode === state.mode || !state.doc) return;
		const token = ++state.loadToken;
		if (mode === 'raw') {
			const built = buildContent();
			const content =
				!state.dirty && state.richBaseline && built === state.richBaseline
					? state.lastSaved
					: built;
			state.mode = 'raw';
			state.rawReady = false;
			setModeUi();
			await destroyEditors();
			if (token !== state.loadToken) return;
			mountRaw(content, token);
			statusPosition.textContent = 'Raw Markdown';
		} else {
			const content = state.rawView?.state.doc.toString() ?? buildContent();
			const split = splitContent(content);
			state.yaml = split.yaml;
			state.body = split.body;
			frontmatterInput.value = split.yaml;
			frontmatterHint.textContent = frontmatterLabel(split.yaml);
			state.mode = 'wysiwyg';
			setModeUi();
			await destroyEditors();
			if (token !== state.loadToken) return;
			await mountRich(split.body, token);
			statusPosition.textContent = 'Rich Markdown';
		}
		if (state.dirty) scheduleAutosave();
	}

	for (const button of modeButtons) {
		button.addEventListener('click', () => {
			const mode = button.dataset.mode;
			if (mode === 'wysiwyg' || mode === 'raw') void switchMode(mode);
		});
	}

	// -----------------------------------------------------------------------
	// Conflict dialog
	// -----------------------------------------------------------------------

	const conflictDialog = byId<HTMLDialogElement>('conflict-dialog');

	function showConflictDialog(): void {
		if (!conflictDialog.open) conflictDialog.showModal();
	}

	function closeConflictDialog(): void {
		if (conflictDialog.open) conflictDialog.close();
	}

	conflictDialog.querySelectorAll('[data-conflict-cancel]').forEach((button) => {
		button.addEventListener('click', () => {
			closeConflictDialog();
			toast('Staying in the editor. Saving will ask again.', 'info');
		});
	});

	conflictDialog.querySelector('[data-conflict-reload]')?.addEventListener('click', async () => {
		const conflict = state.conflict;
		closeConflictDialog();
		if (!conflict) return;
		state.conflict = null;
		state.baseHash = conflict.currentHash;
		state.lastSaved = conflict.currentSource;
		state.yaml = splitContent(conflict.currentSource).yaml;
		state.body = splitContent(conflict.currentSource).body;
		frontmatterInput.value = state.yaml;
		state.dirty = false;
		state.pauseAutosave = false;
		if (state.doc) state.doc.source = conflict.currentSource;
		const token = ++state.loadToken;
		await destroyEditors();
		if (token !== state.loadToken) return;
		if (state.mode === 'wysiwyg') await mountRich(state.body, token);
		else mountRaw(conflict.currentSource, token);
		updateStats(conflict.currentSource);
		setStatus('Reloaded from disk', 'clean');
		toast('Reloaded the version on disk.', 'success');
	});

	conflictDialog.querySelector('[data-conflict-overwrite]')?.addEventListener('click', async () => {
		const conflict = state.conflict;
		closeConflictDialog();
		if (!conflict) return;
		state.conflict = null;
		state.baseHash = conflict.currentHash;
		state.pauseAutosave = false;
		await requestSave(true);
	});

	// -----------------------------------------------------------------------
	// History
	// -----------------------------------------------------------------------

	const historyDialog = byId<HTMLDialogElement>('history-dialog');
	const historyList = byId('history-list');
	const historyDiff = byId('history-diff');
	const historyTitle = byId('history-title');
	const diffLabel = byId('diff-label');

	async function showHistory(): Promise<void> {
		if (!state.doc) return;
		historyTitle.textContent = state.path;
		historyList.replaceChildren(make('p', 'history-empty', 'Loading commits…'));
		historyDiff.textContent = 'Select a commit to inspect the change.';
		diffLabel.textContent = '';
		historyDialog.showModal();
		try {
			const data = await api<{ repo: string | null; entries: HistoryEntry[] }>(
				`/api/history?root=${encodeURIComponent(state.rootId)}&path=${encodeURIComponent(
					state.path
				)}`
			);
			historyList.replaceChildren();
			if (!data.repo) {
				historyList.append(
					make('p', 'history-empty', 'This file is not inside a git repository.')
				);
				return;
			}
			if (!data.entries.length) {
				historyList.append(
					make('p', 'history-empty', 'No commits yet for this file. Save a change first.')
				);
				return;
			}
			for (const entry of data.entries) {
				const button = make('button', 'history-item');
				button.type = 'button';
				button.dataset.hash = entry.hash;
				const top = make('span', 'history-top');
				top.append(make('span', 'history-hash', entry.shortHash));
				top.append(make('span', 'history-subject', entry.subject));
				const bottom = make('span', 'history-bottom');
				bottom.textContent = `${entry.author} · ${entry.relativeDate}`;
				button.append(top, bottom);
				button.addEventListener('click', () => void loadDiff(entry.hash, entry.shortHash));
				historyList.append(button);
			}
			historyList.querySelector<HTMLButtonElement>('.history-item')?.click();
		} catch (error) {
			historyList.replaceChildren(
				make('p', 'history-empty', (error as Error).message || 'Could not load history.')
			);
		}
	}

	async function loadDiff(hash: string, shortHash: string): Promise<void> {
		historyList.querySelectorAll('.history-item').forEach((item) => {
			item.classList.toggle('is-active', (item as HTMLElement).dataset.hash === hash);
		});
		historyDiff.textContent = 'Loading diff…';
		diffLabel.textContent = shortHash;
		try {
			const data = await api<{ diff: string }>(
				`/api/history?root=${encodeURIComponent(state.rootId)}&path=${encodeURIComponent(
					state.path
				)}&hash=${encodeURIComponent(hash)}`
			);
			historyDiff.replaceChildren();
			for (const line of data.diff.split('\n')) {
				const span = make('span', 'diff-line');
				if (line.startsWith('+++') || line.startsWith('---')) span.classList.add('diff-file');
				else if (line.startsWith('@@')) span.classList.add('diff-hunk');
				else if (line.startsWith('+')) span.classList.add('diff-add');
				else if (line.startsWith('-')) span.classList.add('diff-del');
				span.textContent = `${line}\n`;
				historyDiff.append(span);
			}
		} catch (error) {
			historyDiff.textContent = (error as Error).message || 'Could not load diff.';
		}
	}

	historyButton.addEventListener('click', () => void showHistory());
	historyDialog.querySelector('[data-close-dialog]')?.addEventListener('click', () => {
		historyDialog.close();
	});

	// -----------------------------------------------------------------------
	// Boot
	// -----------------------------------------------------------------------

	async function boot(): Promise<void> {
		try {
			await loadTree();
		} catch (error) {
			loadingState.hidden = true;
			emptyState.hidden = false;
			emptyMessage.textContent =
				(error as Error).message || 'Could not read the Storelight configuration.';
			return;
		}

		const params = new URLSearchParams(window.location.search);
		const requestedRoot = params.get('root') ?? '';
		const requestedPath = params.get('path') ?? '';
		const requestedRootInfo = state.roots.find((root) => root.id === requestedRoot);
		const hasRequested =
			requestedRootInfo?.files.some((file) => file.path === requestedPath) ?? false;

		if (hasRequested) {
			await loadDoc(requestedRoot, requestedPath);
			return;
		}

		const firstRoot = state.roots.find((root) => root.files.length > 0);
		const firstFile = firstRoot?.files[0];
		if (firstRoot && firstFile) {
			await loadDoc(firstRoot.id, firstFile.path);
			return;
		}

		loadingState.hidden = true;
		emptyState.hidden = false;
		const errors = state.roots.filter((root) => root.error);
		emptyMessage.textContent = errors.length
			? errors.map((root) => `${root.label}: ${root.error}`).join(' ')
			: 'Add a content root in Settings, then pick a Markdown file.';
	}

	void boot();
}
