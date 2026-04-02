<script lang="ts">
	import type { AppState } from '../lib/types';
	import { runTurn } from '../lib/api';
	import ErrorBanner from './ErrorBanner.svelte';
	import MessageLog from './MessageLog.svelte';

	let { appState = $bindable() }: { appState: AppState } = $props();

	let input = $state('');

	async function submit() {
		const action = input.trim();
		if (!action || appState.loading) return;
		input = '';
		await runTurn(appState, action);
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}
</script>

<div class="play-view">
	<ErrorBanner bind:appState />

	<div class="layout">
		<div class="left-panel">
			<MessageLog {appState} />

			<div class="input-area">
				<textarea
					bind:value={input}
					placeholder="What do you do?"
					disabled={appState.loading}
					onkeydown={onKeydown}
					rows="3"
				></textarea>
				<button
					onclick={submit}
					disabled={appState.loading || !input.trim()}
				>
					{appState.loading ? 'Waiting...' : 'Send'}
				</button>
			</div>
		</div>

		<div class="right-panel">
			<p class="placeholder">State panel coming in Phase 11.</p>
		</div>
	</div>
</div>

<style>
	.play-view {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 5rem);
	}

	.layout {
		display: grid;
		grid-template-columns: 1fr 320px;
		gap: 1rem;
		flex: 1;
		min-height: 0;
	}

	@media (max-width: 768px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.right-panel {
			max-height: 300px;
			overflow-y: auto;
		}
	}

	.left-panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.right-panel {
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.75rem;
		overflow-y: auto;
	}

	.input-area {
		display: flex;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid #333;
	}

	textarea {
		flex: 1;
		background: #16213e;
		color: #e0e0e0;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.5rem;
		font-size: 0.875rem;
		font-family: inherit;
		resize: vertical;
	}

	textarea:focus {
		outline: none;
		border-color: #c4a7e7;
	}

	textarea:disabled {
		opacity: 0.5;
	}

	button {
		background: #c4a7e7;
		color: #1a1a2e;
		border: none;
		border-radius: 4px;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		cursor: pointer;
		font-weight: bold;
		align-self: flex-end;
	}

	button:hover {
		background: #d4b7f7;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.placeholder {
		color: #666;
		font-style: italic;
	}
</style>
