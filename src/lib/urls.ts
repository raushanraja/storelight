export function encodePath(relPath: string): string {
	return relPath
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
}

export function docUrl(rootId: string, relPath: string): string {
	return `/browse/${encodeURIComponent(rootId)}/${encodePath(relPath)}`;
}

export function studioUrl(rootId: string, relPath: string): string {
	return `/studio?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(relPath)}`;
}

export function decodePathParam(value: string | undefined): string {
	const raw = value ?? '';
	try {
		return raw
			.split('/')
			.map((part) => decodeURIComponent(part))
			.join('/');
	} catch {
		return raw;
	}
}
