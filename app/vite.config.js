import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// WordPress page slug: internal-pos — assets must load from this subpath in production.
const base = process.env.INTERNAL_POS_BASE || '/internal-pos/';

export default defineConfig( {
	plugins: [ tailwindcss(), react() ],
	base,
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
} );
