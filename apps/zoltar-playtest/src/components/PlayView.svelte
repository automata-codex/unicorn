<script lang="ts">
	import type { AppState } from '../lib/types';
	import { runTurn } from '../lib/api';
	import { exportSession, parseSessionFile, restoreSession } from '../lib/storage';
	import ErrorBanner from './ErrorBanner.svelte';
	import MessageLog from './MessageLog.svelte';
	import StatePanel from './StatePanel.svelte';
	import DicePrompt from './DicePrompt.svelte';

	let { appState = $bindable() }: { appState: AppState } = $props();

	let input = $state('');
	let fileInput: HTMLInputElement;

	function handleExportSession() {
		exportSession(appState);
	}

	async function handleImportSession(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		// Reset so the same file can be re-imported
		(e.target as HTMLInputElement).value = '';

		try {
			const session = await parseSessionFile(file);

			// Confirm overwrite if a session is in progress
			const hasSession = appState.turn > 1 || appState.messages.length > 0;
			if (hasSession) {
				const ok = confirm('A session is in progress. Importing will replace all current state. Continue?');
				if (!ok) return;
			}

			restoreSession(appState, session);
		} catch (err) {
			appState.errors.push(err instanceof Error ? err.message : String(err));
		}
	}

	async function submit() {
		const action = input.trim();
		if (!action || appState.loading) return;
		const success = await runTurn(appState, action);
		if (success) {
			input = '';
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}
</script>

<div class="play-view">
	<div class="header">
		<ErrorBanner bind:appState />
		<div class="controls">
			<button class="control-btn" onclick={handleExportSession}>Export Session</button>
			<button class="control-btn" onclick={() => fileInput.click()}>Import Session</button>
			<input
				type="file"
				accept=".json"
				style="display:none"
				bind:this={fileInput}
				onchange={handleImportSession}
			/>
		</div>
	</div>

	<div class="layout">
		<div class="left-panel">
			<MessageLog {appState} />

			{#if appState.flags.adventure_complete}
				<div class="session-complete">Session Complete</div>
			{:else if appState.pendingDiceRequests.length > 0}
				<DicePrompt bind:appState />
			{:else}
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
			{/if}
		</div>

		<div class="right-panel">
			<StatePanel bind:appState />
		</div>
	</div>
</div>

<style>
	.play-view {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 5rem);
	}

	.header {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.controls {
		display: flex;
		gap: 0.5rem;
	}

	.control-btn {
		background: #2a2a4a;
		color: #aaa;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.25rem 0.75rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.control-btn:hover {
		background: #3a3a5a;
		color: #e0e0e0;
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

	.session-complete {
		background: #2a4a2a;
		border: 1px solid #7ec;
		border-radius: 4px;
		padding: 0.75rem;
		color: #7ec;
		font-weight: bold;
		text-align: center;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-top: 0.5rem;
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
</style>
