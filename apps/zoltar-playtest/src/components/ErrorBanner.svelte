<script lang="ts">
	import type { AppState } from '../lib/types';

	let { appState }: { appState: AppState } = $props();

	function dismiss(index: number) {
		appState.errors = appState.errors.filter((_, i) => i !== index);
	}
</script>

{#if appState.errors.length > 0}
	<div class="error-banner">
		{#each appState.errors as error, i}
			<div class="error-item" class:info={error.startsWith('[info]')} class:warn={error.startsWith('[warn]')}>
				<span class="error-text">{error}</span>
				<button class="dismiss" onclick={() => dismiss(i)}>x</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.error-banner {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 1rem;
	}

	.error-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.75rem;
		border-radius: 4px;
		background: #5c2030;
		border: 1px solid #a03050;
		font-size: 0.875rem;
	}

	.error-item.info {
		background: #1a3a4a;
		border-color: #3a7a9a;
	}

	.error-item.warn {
		background: #4a3a1a;
		border-color: #9a7a3a;
	}

	.error-text {
		flex: 1;
	}

	.dismiss {
		background: none;
		border: none;
		color: #e0e0e0;
		cursor: pointer;
		padding: 0 0.25rem;
		font-size: 0.875rem;
		opacity: 0.7;
	}

	.dismiss:hover {
		opacity: 1;
	}
</style>
