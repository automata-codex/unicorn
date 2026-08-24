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
	//
	// Pre-bundling it has a cost the `dev` script pays for: Vite keys the
	// optimizer cache on the config and lockfile hashes, never on the contents
	// of a symlinked workspace package. Rebuilding `@uv/game-systems` therefore
	// leaves the browser on the previous pre-bundle indefinitely, and because
	// the CJS interop compiles named imports into runtime property lookups, a
	// symbol added since that pre-bundle binds as `undefined` rather than
	// failing to import — surfacing much later as "x is not a function". Hence
	// `vite --force` in the dev scripts, which re-optimizes on every start.
	optimizeDeps: {
		include: ['@uv/game-systems'],
	},
	// `optimizeDeps` only covers the dev server. `vite build` uses Rollup, whose
	// commonjs plugin is scoped to `node_modules` by default — and the workspace
	// package resolves through its symlink to `packages/game-systems/dist`, which
	// is outside that scope. Without this the production build fails with
	// "parseDiceNotation is not exported by …/dist/index.js" while dev works.
	build: {
		commonjsOptions: {
			include: [/game-systems/, /node_modules/],
		},
	},
});
