import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

// Production: assets under /internal-pos/ on the WordPress page. Dev: base / so Router + .env.local match.
const prodBase = process.env.INTERNAL_POS_BASE || '/internal-pos/';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const remote = env.VITE_WP_REMOTE || '';
	const user = env.VITE_WP_APP_USER || '';
	const pass = env.VITE_WP_APP_PASS || '';
	const basic =
		remote && user && pass
			? 'Basic ' + Buffer.from(`${user}:${String(pass).replace(/\s+/g, '')}`).toString('base64')
			: '';

	/** @type {import('vite').UserConfig} */
	const config = {
		plugins: [tailwindcss(), react()],
		resolve: {
			alias: {
				'@': path.resolve( __dirname, './src' ),
			},
		},
		base: mode === 'development' ? '/' : prodBase,
		build: {
			outDir: '../public/dist',
			emptyOutDir: true,
			assetsDir: 'assets',
			rollupOptions: {
				input: './index.html',
			},
		},
		server: {
			origin: 'http://127.0.0.1:5173',
		},
	};

	if (mode === 'development' && remote && basic) {
		config.server = {
			...config.server,
			proxy: {
				'/wp-json': {
					target: remote,
					changeOrigin: true,
					secure: true,
					configure: (proxy) => {
						proxy.on('proxyReq', (proxyReq, req) => {
							proxyReq.setHeader('Authorization', basic);
							// Strip headers that often trip WAF/CDN rules (Cloudflare, Wordfence).
							proxyReq.removeHeader('cookie');
							proxyReq.removeHeader('origin');
							proxyReq.removeHeader('referer');
							console.log('[proxy \u2192]', req.method, req.url);
						});
						proxy.on('proxyRes', (proxyRes, req) => {
							console.log('[proxy \u2190]', proxyRes.statusCode, req.url);
						});
						proxy.on('error', (err, req) => {
							console.error('[proxy x]', err?.message, req?.url);
						});
					},
				},
			},
		};
	}

	return config;
});
