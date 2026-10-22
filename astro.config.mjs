// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import node from '@astrojs/node';

const host = process.env.STORELIGHT_HOST ?? '127.0.0.1';
const port = Number(process.env.STORELIGHT_PORT ?? 4321);

export default defineConfig({
	site: `http://localhost:${port}`,
	adapter: node({ mode: 'standalone' }),
	server: { host, port },
	integrations: [
		starlight({
			title: 'Storelight',
			description: 'A local Markdown studio for your docs.',
			logo: { src: './src/assets/logo.svg', alt: 'Storelight' },
			sidebar: [
				{ label: 'Open Studio', link: '/studio/', attrs: { target: '_blank' } },
				{ label: 'Browse demo docs', link: '/browse/demo/welcome.md' },
				{ label: 'Settings', link: '/studio/settings' },
				{
					label: 'Learn',
					items: [
						{ label: 'How Storelight works', slug: 'guide' },
						{ label: 'Configuration & API', slug: 'reference' },
					],
				},
			],
			customCss: ['./src/styles/starlight.css'],
		}),
	],
	vite: {
		define: {
			__VUE_OPTIONS_API__: 'true',
			__VUE_PROD_DEVTOOLS__: 'false',
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
		},
		build: {
			// Crepe + CodeMirror are large; keep the warning threshold realistic.
			chunkSizeWarningLimit: 2000,
		},
	},
});
