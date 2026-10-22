interface RootConfig {
	id: string;
	label: string;
	path: string;
	include: string[];
	exclude: string[];
}

interface StorelightConfig {
	roots: RootConfig[];
	git: { autoCommit: boolean; debounceMs: number; commitPrefix: string };
	editor: { autosaveMs: number };
}

interface ResolvedRoot {
	id: string;
	label: string;
	path: string;
	absPath: string;
	exists: boolean;
	isDirectory: boolean;
}

interface SettingsResponse {
	config: StorelightConfig;
	resolvedRoots: ResolvedRoot[];
	configPath: string;
}

interface ApiFailure extends Error {
	status?: number;
	details?: unknown;
}

const TOAST_TIME = 4500;

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

function slugify(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
}

export function initSettings(): void {
	if (!document.body.classList.contains('settings-page')) return;

	const form = byId<HTMLFormElement>('settings-form');
	const rootsList = byId('roots-list');
	const addButton = byId<HTMLButtonElement>('add-root');
	const resetButton = byId<HTMLButtonElement>('reset-button');
	const saveButton = byId<HTMLButtonElement>('save-settings');
	const statusEl = byId('settings-status');
	const gitAuto = byId<HTMLInputElement>('git-auto');
	const gitDebounce = byId<HTMLInputElement>('git-debounce');
	const gitPrefix = byId<HTMLInputElement>('git-prefix');
	const editorAutosave = byId<HTMLInputElement>('editor-autosave');
	const configPathEl = byId('config-path');
	const themeToggle = byId<HTMLButtonElement>('theme-toggle');
	const toastEl = byId('toast');

	let dirty = false;
	let resolved = new Map<string, ResolvedRoot>();
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function toast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
		toastEl.textContent = message;
		toastEl.dataset.tone = tone;
		toastEl.classList.add('is-visible');
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), TOAST_TIME);
	}

	function setStatus(text: string, tone: 'clean' | 'dirty' | 'error' | 'success' = 'clean'): void {
		statusEl.textContent = text;
		statusEl.dataset.tone = tone;
	}

	function markDirty(): void {
		dirty = true;
		setStatus('Unsaved changes', 'dirty');
	}

	function applyTheme(theme: 'dark' | 'light'): void {
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem('storelight:theme', theme);
		} catch {}
	}

	applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
	themeToggle.addEventListener('click', () => {
		applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
	});

	async function fetchSettings(): Promise<SettingsResponse> {
		const response = await fetch('/api/settings', { headers: { Accept: 'application/json' } });
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const failure = new Error(data.error || 'Could not load settings') as ApiFailure;
			failure.status = response.status;
			failure.details = data.details;
			throw failure;
		}
		return data as SettingsResponse;
	}

	async function fetchWithBody<T>(method: string, body: unknown): Promise<T> {
		const response = await fetch('/api/settings', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const failure = new Error(data.error || 'Request failed') as ApiFailure;
			failure.status = response.status;
			failure.details = data.details;
			throw failure;
		}
		return data as T;
	}

	function fieldValue(card: HTMLElement, field: string): string {
		const input = card.querySelector<HTMLInputElement | HTMLTextAreaElement>(
			`[data-field="${field}"]`
		);
		return input?.value ?? '';
	}

	function setRootStatus(card: HTMLElement, state: 'ok' | 'missing' | 'unknown', label: string): void {
		const status = card.querySelector<HTMLElement>('.root-status');
		if (!status) return;
		status.dataset.state = state;
		status.textContent = label;
	}

	function refreshCardChrome(card: HTMLElement): void {
		const label = fieldValue(card, 'label').trim();
		const title = card.querySelector('.root-card-title');
		if (title) title.textContent = label || 'Untitled root';
		setRootStatus(card, 'unknown', 'Unsaved');
	}

	function rootCard(root: RootConfig, options: { isNew?: boolean } = {}): HTMLElement {
		const card = make('article', 'root-card');
		card.dataset.rootCard = 'true';

		const head = make('header', 'root-card-head');
		const index = make('span', 'root-card-index', '00');
		const title = make('span', 'root-card-title', root.label || 'Untitled root');
		const status = make('span', 'root-status', 'Checking…');
		const remove = make('button', 'root-remove');
		remove.type = 'button';
		remove.title = 'Remove root';
		remove.setAttribute('aria-label', 'Remove root');
		const trash = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		trash.setAttribute('class', 'icon');
		const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
		use.setAttribute('href', '#i-trash');
		trash.append(use);
		remove.append(trash);
		head.append(index, title, status, remove);

		const body = make('div', 'root-card-body');
		body.innerHTML = `
			<label class="field">
				<span>Label</span>
				<input data-field="label" type="text" maxlength="100" spellcheck="false" placeholder="Team handbook" />
			</label>
			<label class="field">
				<span>ID</span>
				<input data-field="id" type="text" maxlength="48" spellcheck="false" placeholder="handbook" />
			</label>
			<label class="field field-full">
				<span>Path</span>
				<input data-field="path" type="text" spellcheck="false" placeholder="/home/you/notes or ~/notes or ./content/docs" />
			</label>
			<label class="field">
				<span>Include globs</span>
				<textarea data-field="include" spellcheck="false" placeholder="**/*.md"></textarea>
			</label>
			<label class="field">
				<span>Exclude globs</span>
				<textarea data-field="exclude" spellcheck="false" placeholder="drafts/**"></textarea>
			</label>
		`;

		const labelInput = body.querySelector<HTMLInputElement>('[data-field="label"]')!;
		const idInput = body.querySelector<HTMLInputElement>('[data-field="id"]')!;
		const pathInput = body.querySelector<HTMLInputElement>('[data-field="path"]')!;
		const includeInput = body.querySelector<HTMLTextAreaElement>('[data-field="include"]')!;
		const excludeInput = body.querySelector<HTMLTextAreaElement>('[data-field="exclude"]')!;

		labelInput.value = root.label;
		idInput.value = root.id;
		pathInput.value = root.path;
		includeInput.value = root.include.join('\n');
		excludeInput.value = root.exclude.join('\n');
		card.dataset.autoId = options.isNew ? 'true' : 'false';

		labelInput.addEventListener('input', () => {
			if (card.dataset.autoId === 'true') {
				const existing = new Set(
					Array.from(rootsList.querySelectorAll<HTMLElement>('[data-root-card]'))
						.filter((other) => other !== card)
						.map((other) => fieldValue(other, 'id'))
				);
				const base = slugify(labelInput.value) || 'root';
				let candidate = base;
				let counter = 2;
				while (existing.has(candidate)) candidate = `${base}-${counter++}`;
				idInput.value = candidate;
			}
			refreshCardChrome(card);
			markDirty();
		});
		idInput.addEventListener('input', () => {
			card.dataset.autoId = 'false';
			refreshCardChrome(card);
			markDirty();
		});
		for (const input of [pathInput, includeInput, excludeInput]) {
			input.addEventListener('input', markDirty);
		}
		pathInput.addEventListener('input', () => refreshCardChrome(card));

		remove.addEventListener('click', () => {
			if (!confirm('Remove this content root from the configuration?')) return;
			card.remove();
			reindex();
			markDirty();
		});

		card.append(head, body);

		const resolvedRoot = resolved.get(root.id);
		if (resolvedRoot) {
			if (resolvedRoot.exists && resolvedRoot.isDirectory) {
				setRootStatus(card, 'ok', 'Directory found');
			} else {
				setRootStatus(card, 'missing', 'Missing directory');
			}
		} else if (!root.id) {
			setRootStatus(card, 'missing', 'Not saved');
		}
		return card;
	}

	function reindex(): void {
		Array.from(rootsList.querySelectorAll<HTMLElement>('[data-root-card]')).forEach(
			(card, index) => {
				const badge = card.querySelector('.root-card-index');
				if (badge) badge.textContent = String(index + 1).padStart(2, '0');
			}
		);
	}

	function setFormValues(config: StorelightConfig, resolvedRoots: ResolvedRoot[]): void {
		resolved = new Map(resolvedRoots.map((root) => [root.id, root]));
		rootsList.replaceChildren();
		if (!config.roots.length) {
			rootsList.append(
				make(
					'p',
					'settings-muted',
					'No roots yet. Add the folder that contains your Markdown files.'
				)
			);
		}
		for (const root of config.roots) rootsList.append(rootCard(root));
		reindex();
		gitAuto.checked = config.git.autoCommit;
		gitDebounce.value = String(config.git.debounceMs);
		gitPrefix.value = config.git.commitPrefix;
		editorAutosave.value = String(config.editor.autosaveMs);
		configPathEl.textContent = 'storelight.config.json';
	}

	function addBlankRoot(): void {
		const empty = rootsList.querySelector('.settings-muted');
		if (empty) empty.remove();
		const card = rootCard(
			{ id: '', label: '', path: '', include: ['**/*.md'], exclude: [] },
			{ isNew: true }
		);
		rootsList.append(card);
		reindex();
		markDirty();
		card.scrollIntoView({ behavior: 'smooth', block: 'center' });
		card.querySelector<HTMLInputElement>('[data-field="label"]')?.focus();
	}

	function collectConfig(): StorelightConfig {
		const roots: RootConfig[] = [];
		for (const card of Array.from(rootsList.querySelectorAll<HTMLElement>('[data-root-card]'))) {
			const include = fieldValue(card, 'include')
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean);
			const exclude = fieldValue(card, 'exclude')
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean);
			roots.push({
				id: fieldValue(card, 'id').trim(),
				label: fieldValue(card, 'label').trim(),
				path: fieldValue(card, 'path').trim(),
				include: include.length ? include : ['**/*.md'],
				exclude,
			});
		}
		return {
			roots,
			git: {
				autoCommit: gitAuto.checked,
				debounceMs: Number(gitDebounce.value) || 2500,
				commitPrefix: gitPrefix.value.trim() || 'docs(storelight)',
			},
			editor: {
				autosaveMs: Number(editorAutosave.value) || 900,
			},
		};
	}

	function validateClient(config: StorelightConfig): string | null {
		const seen = new Set<string>();
		for (const [index, root] of config.roots.entries()) {
			const position = `Root ${index + 1}`;
			if (!root.label) return `${position}: a label is required.`;
			if (!root.id) return `${position}: an id is required.`;
			if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(root.id)) {
				return `${position}: the id must start with a letter or number and use only letters, numbers, dashes and underscores.`;
			}
			if (seen.has(root.id)) return `${position}: the id “${root.id}” is duplicated.`;
			seen.add(root.id);
			if (!root.path) return `${position}: a path is required.`;
			if (!root.include.length) return `${position}: add at least one include glob.`;
		}
		return null;
	}

	async function load(): Promise<void> {
		try {
			setStatus('Loading settings…');
			const data = await fetchSettings();
			setFormValues(data.config, data.resolvedRoots);
			configPathEl.textContent = data.configPath;
			dirty = false;
			setStatus('Settings loaded');
		} catch (error) {
			setStatus((error as Error).message, 'error');
			rootsList.replaceChildren(make('p', 'settings-muted', (error as Error).message));
			toast((error as Error).message, 'error');
		}
	}

	addButton.addEventListener('click', addBlankRoot);
	resetButton.addEventListener('click', () => {
		if (dirty && !confirm('Discard unsaved settings changes?')) return;
		void load();
	});

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const config = collectConfig();
		const error = validateClient(config);
		if (error) {
			setStatus(error, 'error');
			toast(error, 'error');
			return;
		}
		saveButton.disabled = true;
		saveButton.textContent = 'Saving…';
		setStatus('Saving configuration…');
		try {
			const data = await fetchWithBody<SettingsResponse & { ok: boolean }>('PUT', { config });
			setFormValues(data.config, data.resolvedRoots);
			configPathEl.textContent = data.configPath;
			dirty = false;
			setStatus('Saved · roots refreshed', 'success');
			toast('Configuration saved. The Studio sees the new roots immediately.', 'success');
		} catch (error) {
			const failure = error as ApiFailure;
			setStatus(failure.message, 'error');
			toast(failure.message, 'error');
			if (failure.details) console.warn('[storelight] settings validation', failure.details);
		} finally {
			saveButton.disabled = false;
			saveButton.replaceChildren();
			const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			icon.setAttribute('class', 'icon');
			const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
			use.setAttribute('href', '#i-save');
			icon.append(use);
			saveButton.append(icon, document.createTextNode(' Save configuration'));
		}
	});

	window.addEventListener('beforeunload', (event) => {
		if (dirty) {
			event.preventDefault();
		}
	});

	void load();
}
