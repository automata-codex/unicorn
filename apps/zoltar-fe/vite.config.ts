import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	plugins: [svelte()],
	server: { port: 5173, host: '0.0.0.0', allowedHosts: true },
	// `@uv/game-systems` is a workspace package that compiles to CJS. Vite's
	// direct-serve path for workspace deps can't statically read
	// `Object.defineProperty(exports, …)` bindings from CJS modules, which
	// breaks value imports in the browser. Including it in optimizeDeps
	// routes it through esbuild's pre-bundler, which handles CJS→ESM
	// conversion properly.
	optimizeDeps: {
		include: ['@uv/game-systems'],
	},
});
