import { commitFile, commitMessageFor } from './git';
import type { CommitResult, EditAction, GitConfig } from './types';

export interface CommitOutcome {
	mode: 'disabled' | 'unavailable' | 'scheduled' | 'committed' | 'failed' | 'clean';
	message?: string;
	hash?: string;
	error?: string;
}

export async function commitOutcomeNow(
	fileAbsPath: string,
	gitConfig: GitConfig,
	action: EditAction,
	kind?: string
): Promise<CommitOutcome> {
	if (!gitConfig.autoCommit) return { mode: 'disabled' };
	const { message, repo } = await commitMessageFor(
		fileAbsPath,
		gitConfig.commitPrefix,
		action,
		kind
	);
	if (!repo) return { mode: 'unavailable', message, error: 'Not inside a git repository' };
	const result = await commitNow(fileAbsPath, message);
	if (!result.committed && !result.error && !result.hash) {
		return { mode: 'clean', message };
	}
	return {
		mode: result.committed ? 'committed' : 'failed',
		message,
		hash: result.hash,
		error: result.error,
	};
}


interface PendingCommit {
	timer: ReturnType<typeof setTimeout>;
	message: string;
	fileAbsPath: string;
}

const globalQueue = globalThis as typeof globalThis & {
	__storelightCommits?: Map<string, PendingCommit>;
};

const pending: Map<string, PendingCommit> = (globalQueue.__storelightCommits ??= new Map());

export function scheduleCommit(
	fileAbsPath: string,
	message: string,
	debounceMs: number
): void {
	const existing = pending.get(fileAbsPath);
	if (existing) {
		clearTimeout(existing.timer);
		existing.message = message;
		existing.timer = setTimeout(() => void run(fileAbsPath), debounceMs);
		existing.timer.unref?.();
		return;
	}
	const entry = {
		fileAbsPath,
		message,
		timer: undefined as unknown as ReturnType<typeof setTimeout>,
	} as PendingCommit;
	entry.timer = setTimeout(() => void run(fileAbsPath), debounceMs);
	entry.timer.unref?.();
	pending.set(fileAbsPath, entry);
}

async function run(fileAbsPath: string, forcedMessage?: string): Promise<CommitResult> {
	const entry = pending.get(fileAbsPath);
	if (!entry && !forcedMessage) {
		return { committed: false };
	}
	if (entry) {
		clearTimeout(entry.timer);
		pending.delete(fileAbsPath);
	}
	const message = forcedMessage ?? entry!.message;
	const result = await commitFile(fileAbsPath, message);
	if (!result.committed && result.error) {
		console.error(`[storelight] auto-commit failed: ${result.error}`);
	}
	return result;
}

/** Commit immediately, cancelling any pending debounce for this file. */
export async function commitNow(fileAbsPath: string, message: string): Promise<CommitResult> {
	const entry = pending.get(fileAbsPath);
	if (entry) {
		clearTimeout(entry.timer);
		pending.delete(fileAbsPath);
	}
	return commitFile(fileAbsPath, message);
}

/** Flush a pending commit; used by Ctrl+S in the Studio. */
export async function flushCommit(fileAbsPath: string): Promise<CommitResult | null> {
	const entry = pending.get(fileAbsPath);
	if (!entry) return null;
	return run(fileAbsPath, entry.message);
}
