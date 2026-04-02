<script lang="ts">
	import { createAppState } from './lib/state.svelte';
	import { loadApiKey, loadState, saveApiKey, saveState } from './lib/storage';
	import ErrorBanner from './components/ErrorBanner.svelte';
	import SetupView from './components/SetupView.svelte';

	const savedState = loadState();
	const savedApiKey = loadApiKey();

	let state = $state(createAppState({
		...savedState,
		apiKey: savedApiKey || savedState?.apiKey || ''
	}));

	$effect(() => {
		saveState(state);
		saveApiKey(state.apiKey);
	});
</script>

<div class="app">
	<ErrorBanner bind:appState={state} />

	{#if state.view === 'setup'}
		<h1>Zoltar Playtest Tool</h1>
		<SetupView bind:appState={state} />
	{:else}
		<h1>Zoltar Playtest</h1>
		<p>Play view coming in Phase 10.</p>
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		background: #1a1a2e;
		color: #e0e0e0;
	}

	.app {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		color: #c4a7e7;
	}
</style>
