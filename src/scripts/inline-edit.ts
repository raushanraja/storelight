import { renderMermaidIn } from './mermaid';

interface CommitInfo {
	mode: 'disabled' | 'unavailable' | 'scheduled' | 'committed' | 'failed' | 'clean';
	hash?: string;
	error?: string;
	message?: string;
}

interface DocResponse {
	source: string;
	hash: string;
	error?: string;
}

const STORAGE_KEY = 'storelight:inline-edit';
const SCROLL_KEY = 'storelight:scroll';

function toast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
	const element = document.getElementById('sl-toast');
	if (!element) return;
	element.textContent = message;
	element.dataset.tone = tone;
	element.classList.add('is-visible');
	window.clearTimeout((element as HTMLElement & { _timer?: number })._timer);
	(element as HTMLElement & { _timer?: number })._timer = window.setTimeout(() => {
		element.classList.remove('is-visible');
	}, 4500);
}

function commitLabel(commit?: CommitInfo): string {
	if (!commit) return '';
	switch (commit.mode) {
		case 'committed':
			return commit.hash ? ` · committed ${commit.hash}` : ' · committed';
		case 'scheduled':
			return ' · commit queued';
		case 'disabled':
			return ' · auto-commit off';
		case 'unavailable':
			return ' · saved (no git repo)';
		case 'clean':
			return ' · no changes to commit';
		case 'failed':
			return ` · commit failed: ${commit.error ?? 'unknown error'}`;
		default:
			return '';
	}
}

async function postJson<T>(url: string, body: unknown): Promise<{ response: Response; data: T }> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = (await response.json().catch(() => ({}))) as T;
	return { response, data };
}

export function initInlineEditing(): void {
	const shell = document.getElementById('sl-doc-shell');
	const docBody = document.getElementById('sl-doc');
	if (!shell || !docBody) return;
	const docShell = shell;

	const root = docShell.dataset.root ?? '';
	const path = docShell.dataset.path ?? '';
	let baseHash = docShell.dataset.hash ?? '';
	const toggle = document.getElementById('sl-inline-toggle') as HTMLButtonElement | null;
	const label = toggle?.querySelector('.sl-inline-label');
	const dialogEl = document.getElementById('sl-inline-dialog') as HTMLDialogElement | null;
	const textareaEl = document.getElementById('sl-inline-text') as HTMLTextAreaElement | null;
	const kindLabel = document.getElementById('sl-inline-kind');
	const meta = document.getElementById('sl-inline-meta');
	const saveButton = document.getElementById('sl-inline-save') as HTMLButtonElement | null;
	const cancelButton = document.getElementById('sl-inline-cancel') as HTMLButtonElement | null;
	const viewButtons = Array.from(
		document.querySelectorAll<HTMLButtonElement>('.sl-view-button')
	);
	const codeView = document.getElementById('sl-code-view') as HTMLDivElement | null;
	const codeContent = document.getElementById('sl-code-content') as HTMLElement | null;
	const copyButton = document.getElementById('sl-copy-source') as HTMLButtonElement | null;
	if (!dialogEl || !textareaEl || !saveButton || !cancelButton) return;
	const dialog = dialogEl;
	const textarea = textareaEl;
	const doc = docBody;

	let enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
	let cachedSource: string | null = null;
	let activeRange: { start: number; end: number; kind: string } | null = null;
	let saving = false;

	const scroll = sessionStorage.getItem(SCROLL_KEY);
	if (scroll) {
		sessionStorage.removeItem(SCROLL_KEY);
		requestAnimationFrame(() => window.scrollTo({ top: Number(scroll), behavior: 'instant' }));
	}

	function applyEnabled(): void {
		doc.classList.toggle('sl-inline-enabled', enabled);
		toggle?.setAttribute('aria-pressed', String(enabled));
		if (label) label.textContent = enabled ? 'Inline edit on' : 'Inline edit off';
		toggle?.classList.toggle('is-on', enabled);
		doc.querySelectorAll<HTMLInputElement>('li[data-task-offset] input[type="checkbox"]').forEach(
			(input) => {
				input.disabled = !enabled;
				input.classList.toggle('sl-task-enabled', enabled);
				const item = input.closest('li[data-task-offset]');
				const text = item?.textContent?.replace(/\s+/g, ' ').trim();
				if (text) input.setAttribute('aria-label', text);
			}
		);
	}

	toggle?.addEventListener('click', () => {
		enabled = !enabled;
		localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
		applyEnabled();
		toast(enabled ? 'Inline editing enabled. Click any block to edit.' : 'Inline editing disabled.');
	});

	async function getSource(force = false): Promise<string | null> {
		if (cachedSource !== null && !force) return cachedSource;
		try {
			const response = await fetch(
				`/api/doc?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`,
				{ headers: { Accept: 'application/json' } }
			);
			if (!response.ok) throw new Error('Could not load the Markdown source');
			const data = (await response.json()) as DocResponse;
			cachedSource = data.source;
			if (!baseHash) baseHash = data.hash;
			return cachedSource;
		} catch (error) {
			toast((error as Error).message, 'error');
			return null;
		}
	}

	async function setView(view: 'visual' | 'code', persist = true): Promise<void> {
		const code = view === 'code';
		docShell.dataset.view = view;
		docShell.closest('.sl-browse-shell')?.setAttribute('data-view', view);
		doc.hidden = code;
		if (codeView) codeView.hidden = !code;
		for (const button of viewButtons) {
			const active = button.dataset.view === view;
			button.classList.toggle('is-active', active);
			button.setAttribute('aria-pressed', String(active));
		}
		if (persist) {
			try {
				localStorage.setItem('storelight:browse-view', view);
			} catch {}
		}
		if (code) {
			if (codeContent) {
				codeContent.textContent = 'Loading source…';
				const source = await getSource(true);
				codeContent.textContent = source ?? 'Could not load the Markdown source.';
			}
		} else {
			void renderMermaidIn(doc);
		}
	}

	for (const button of viewButtons) {
		button.addEventListener('click', () => {
			const view = button.dataset.view === 'code' ? 'code' : 'visual';
			void setView(view);
		});
	}

	copyButton?.addEventListener('click', async () => {
		const source = cachedSource ?? (await getSource(true));
		if (!source) return;
		try {
			await navigator.clipboard.writeText(source);
			toast('Raw Markdown copied.', 'success');
		} catch {
			toast('Could not copy to the clipboard.', 'error');
		}
	});

	const themeObserver = new MutationObserver(() => {
		if (docShell.dataset.view !== 'code') void renderMermaidIn(doc);
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-theme'],
	});

	doc.addEventListener('change', async (event) => {
		const input = (event.target as HTMLElement).closest('input[type="checkbox"]') as HTMLInputElement | null;
		if (!input) return;
		const item = input.closest('li[data-task-offset]') as HTMLLIElement | null;
		if (!item || !enabled) return;
		const offset = Number(item.dataset.taskOffset);
		if (!Number.isInteger(offset)) return;
		const desired = input.checked;
		input.disabled = true;
		try {
			const { response, data } = await postJson<{
				ok?: boolean;
				hash?: string;
				checked?: boolean;
				commit?: CommitInfo;
				error?: string;
				code?: string;
			}>('/api/toggle-task', {
				root,
				path,
				offset,
				checked: desired,
				baseHash,
			});
			if (!response.ok) {
				input.checked = !desired;
				if (response.status === 409 && data.code === 'CONFLICT') {
					toast('The file changed on disk. Reloading the latest version…', 'error');
					setTimeout(() => window.location.reload(), 900);
				} else {
					toast(data.error || 'Could not update the task', 'error');
				}
				return;
			}
			baseHash = data.hash ?? baseHash;
			toast(`Task ${desired ? 'checked' : 'unchecked'}${commitLabel(data.commit)}`, 'success');
		} catch (error) {
			input.checked = !desired;
			toast((error as Error).message || 'Could not update the task', 'error');
		} finally {
			input.disabled = !enabled;
		}
	});

	doc.addEventListener('click', async (event) => {
		if (!enabled) return;
		const target = event.target as HTMLElement;
		if (target.closest('a, button, input, label, summary, details, iframe, video, audio')) return;
		const selection = window.getSelection();
		if (selection && !selection.isCollapsed && selection.toString().trim()) return;
		const block = target.closest('[data-src-start]') as HTMLElement | null;
		if (!block || !doc.contains(block)) return;
		const start = Number(block.dataset.srcStart);
		const end = Number(block.dataset.srcEnd);
		if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return;
		event.preventDefault();

		const source = await getSource();
		if (source == null) return;
		if (source.length > 5_000_000) {
			toast('This document is too large for inline editing. Use the Studio.', 'error');
			return;
		}
		if (end > source.length) {
			toast('The page is out of date. Reload before editing.', 'error');
			return;
		}

		activeRange = { start, end, kind: block.dataset.srcKind ?? 'block' };
		textarea.value = source.slice(start, end);
		if (kindLabel) {
			const names: Record<string, string> = {
				paragraph: 'Paragraph',
				heading: 'Heading',
				code: 'Code block',
				table: 'Table',
				blockquote: 'Blockquote',
				mermaid: 'Mermaid diagram',
				math: 'Math block',
			};
			kindLabel.textContent = names[activeRange.kind] ?? 'Markdown block';
		}
		if (meta) meta.textContent = `Characters ${start}–${end} · Ctrl+Enter to save · Esc to cancel`;
		textarea.setAttribute('aria-label', 'Markdown for this block');
		dialog.showModal();
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
	});

	async function saveBlock(): Promise<void> {
		if (!activeRange || saving) return;
		saving = true;
		saveButton!.disabled = true;
		saveButton!.textContent = 'Saving…';
		try {
			const { response, data } = await postJson<{
				ok?: boolean;
				hash?: string;
				commit?: CommitInfo;
				error?: string;
				code?: string;
			}>('/api/edit-block', {
				root,
				path,
				start: activeRange.start,
				end: activeRange.end,
				text: textarea.value,
				baseHash,
				kind: activeRange.kind,
			});
			if (!response.ok) {
				toast(
					data.code === 'CONFLICT'
						? 'The file changed on disk. Reloading the latest version…'
						: data.error || 'Could not save this block',
					'error'
				);
				if (data.code === 'CONFLICT') {
					dialog.close();
					setTimeout(() => window.location.reload(), 900);
				}
				return;
			}
			baseHash = data.hash ?? baseHash;
			cachedSource = null;
			toast(`Block saved${commitLabel(data.commit)}`, 'success');
			dialog.close();
			sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
			setTimeout(() => window.location.reload(), 450);
		} catch (error) {
			toast((error as Error).message || 'Could not save this block', 'error');
		} finally {
			saving = false;
			saveButton!.disabled = false;
			saveButton!.textContent = 'Save block';
		}
	}

	saveButton.addEventListener('click', () => void saveBlock());
	cancelButton.addEventListener('click', () => dialog.close());
	textarea.addEventListener('keydown', (event) => {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			void saveBlock();
		}
	});
	dialog.addEventListener('close', () => {
		activeRange = null;
	});

	applyEnabled();

	let initialView: 'visual' | 'code' = 'visual';
	try {
		initialView =
			localStorage.getItem('storelight:browse-view') === 'code' ? 'code' : 'visual';
	} catch {}
	if (initialView === 'code') void setView('code', false);
	else void renderMermaidIn(doc);
}
