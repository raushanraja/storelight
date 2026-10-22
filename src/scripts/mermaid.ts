import mermaid from 'mermaid';

/**
 * Shared Mermaid configuration for the browse diagrams and the Studio code-block
 * preview. Uses the `base` theme so diagram colours follow Storelight's palette.
 */
export function configureMermaid(): void {
	const dark = document.documentElement.dataset.theme !== 'light';
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		suppressErrorRendering: true,
		theme: 'base',
		fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
		fontSize: 14,
		themeVariables: dark
			? {
					background: 'transparent',
					primaryColor: '#1b2431',
					primaryTextColor: '#e7edf6',
					primaryBorderColor: '#5eead4',
					secondaryColor: '#141b25',
					tertiaryColor: '#10151d',
					lineColor: '#93a1b4',
					textColor: '#e7edf6',
					edgeLabelBackground: '#10151d',
					clusterBkg: '#111827',
					clusterBorder: '#314052',
					noteBkgColor: '#141b25',
					noteTextColor: '#e7edf6',
				}
			: {
					background: 'transparent',
					primaryColor: '#ffffff',
					primaryTextColor: '#15202c',
					primaryBorderColor: '#0f766e',
					secondaryColor: '#f4f6f9',
					tertiaryColor: '#e9eef4',
					lineColor: '#5b6a7d',
					textColor: '#15202c',
					edgeLabelBackground: '#ffffff',
					clusterBkg: '#f8fafc',
					clusterBorder: '#c4cfdb',
					noteBkgColor: '#f4f6f9',
					noteTextColor: '#15202c',
				},
		flowchart: {
			htmlLabels: true,
			curve: 'basis',
			padding: 14,
		},
	});
}

export { mermaid };
