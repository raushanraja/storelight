import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommitResult } from './types';
import type { EditAction } from './types';

const execFileAsync = promisify(execFile);

interface GitRunOptions {
	timeout?: number;
	maxBuffer?: number;
}

async function git(repo: string, args: string[], options: GitRunOptions = {}): Promise<string> {
	const { stdout } = await execFileAsync('git', ['-C', repo, ...args], {
		timeout: options.timeout ?? 20_000,
		maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
		windowsHide: true,
		encoding: 'utf8',
	});
	return stdout;
}

const repoCache = new Map<string, { repo: string | null; expires: number }>();

export async function findRepo(fileAbsPath: string): Promise<string | null> {
	const dir = path.dirname(fileAbsPath);
	const cached = repoCache.get(dir);
	const now = Date.now();
	if (cached && cached.expires > now) return cached.repo;
	let repo: string | null = null;
	try {
		const output = await git(dir, ['rev-parse', '--show-toplevel'], { timeout: 5000 });
		repo = output.trim() || null;
	} catch {
		repo = null;
	}
	repoCache.set(dir, { repo, expires: now + 5000 });
	return repo;
}

export function buildCommitMessage(
	prefix: string,
	action: EditAction,
	relPath: string,
	kind?: string
): string {
	switch (action) {
		case 'task':
			return `${prefix}: toggle task in ${relPath}`;
		case 'inline':
			return `${prefix}: edit ${kind ?? 'block'} in ${relPath}`;
		case 'frontmatter':
			return `${prefix}: update frontmatter in ${relPath}`;
		case 'upload':
			return `${prefix}: add image ${relPath}`;
		case 'raw':
			return `${prefix}: update ${relPath} (raw markdown)`;
		case 'wysiwyg':
		default:
			return `${prefix}: update ${relPath}`;
	}
}

export async function commitFile(fileAbsPath: string, message: string): Promise<CommitResult> {
	const repo = await findRepo(fileAbsPath);
	if (!repo) {
		return { committed: false, error: 'File is not inside a git repository' };
	}
	const rel = path.relative(repo, fileAbsPath).split(path.sep).join('/');
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		return { committed: false, repo, error: 'File is outside the detected repository' };
	}

	try {
		// Refuse to stage ignored files. `git add` would fail with a less useful error.
		try {
			await git(repo, ['check-ignore', '-q', '--', rel], { timeout: 5000 });
			return { committed: false, repo, error: 'File is ignored by git' };
		} catch {
			// Not ignored (or the check itself failed) — continue.
		}

		await git(repo, ['add', '--', rel]);
		const staged = (await git(repo, ['diff', '--cached', '--name-only', '--', rel])).trim();
		if (!staged) {
			return { committed: false, repo };
		}

		await git(repo, ['commit', '--only', '-m', message, '--', rel], {
			timeout: 60_000,
			maxBuffer: 4 * 1024 * 1024,
		});
		let hash = '';
		try {
			hash = (await git(repo, ['rev-parse', '--short', 'HEAD'])).trim();
		} catch {
			// The commit succeeded even if we cannot read the hash.
		}
		return { committed: true, hash: hash || undefined, message, repo };
	} catch (error) {
		const err = error as { stderr?: string; message?: string };
		const detail = (err.stderr || err.message || 'git commit failed').trim().slice(0, 1200);
		return { committed: false, repo, error: detail };
	}
}

export async function commitMessageFor(
	fileAbsPath: string,
	prefix: string,
	action: EditAction,
	kind?: string
): Promise<{ message: string; repo: string | null }> {
	const repo = await findRepo(fileAbsPath);
	const rel = repo
		? path.relative(repo, fileAbsPath).split(path.sep).join('/')
		: path.basename(fileAbsPath);
	return { message: buildCommitMessage(prefix, action, rel, kind), repo };
}

export interface HistoryEntry {
	hash: string;
	shortHash: string;
	author: string;
	relativeDate: string;
	date: string;
	subject: string;
}

export async function getHistory(fileAbsPath: string, limit = 15): Promise<HistoryEntry[]> {
	const repo = await findRepo(fileAbsPath);
	if (!repo) return [];
	const rel = path.relative(repo, fileAbsPath).split(path.sep).join('/');
	try {
		const output = await git(repo, [
			'log',
			`-n${Math.max(1, Math.min(100, limit))}`,
			'--format=%H%x1f%h%x1f%an%x1f%ar%x1f%aI%x1f%s%x1e',
			'--',
			rel,
		]);
		return output
			.split('\x1e')
			.map((record) => record.trim())
			.filter(Boolean)
			.map((record) => {
				const [hash, shortHash, author, relativeDate, date, subject] = record.split('\x1f');
				return { hash, shortHash, author, relativeDate, date, subject };
			})
			.filter((entry) => entry.hash);
	} catch {
		return [];
	}
}

export async function getDiff(fileAbsPath: string, hash: string): Promise<string> {
	const repo = await findRepo(fileAbsPath);
	if (!repo) throw new Error('File is not inside a git repository');
	if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('Invalid commit hash');
	const rel = path.relative(repo, fileAbsPath).split(path.sep).join('/');
	const output = await git(repo, [
		'show',
		'--format=',
		'--no-color',
		'--no-ext-diff',
		'--unified=3',
		hash,
		'--',
		rel,
	]);
	return output.slice(0, 400_000);
}
