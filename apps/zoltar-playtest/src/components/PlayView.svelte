<script lang="ts">
	import type { AppState } from '../lib/types';
	import { runTurn } from '../lib/api';
	import { exportState, importState } from '../lib/storage';
	import ErrorBanner from './ErrorBanner.svelte';
	import MessageLog from './MessageLog.svelte';
	import StatePanel from './StatePanel.svelte';
	import DicePrompt from './DicePrompt.svelte';

	let { appState = $bindable() }: { appState: AppState } = $props();

	let input = $state('');
	let fileInput: HTMLInputElement;

	function handleExportState() {
		exportState(appState);
	}

	function handleExportLog() {
		const lines: string[] = [];
		for (const msg of appState.messages) {
			if (msg.role === 'user' && typeof msg.content === 'string') {
				const parts = msg.content.split('\n\n');
				const action = parts[parts.length - 1];
				if (action && !action.startsWith('## Current State')) {
					lines.push(`PLAYER: ${action}`);
				}
			} else if (msg.role === 'assistant') {
				const content = msg.content;
				if (Array.isArray(content)) {
					for (const block of content as Record<string, unknown>[]) {
						if (block.type === 'tool_use' && block.name === 'submit_gm_response') {
							const inp = block.input as Record<string, unknown>;
							if (inp.playerText) {
								lines.push(`WARDEN: ${inp.playerText}`);
							}
						}
					}
				}
			}
			lines.push('');
		}

		const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `zoltar-log-${new Date().toISOString().slice(0, 10)}.txt`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleImportState(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			const imported = await importState(file);
			Object.assign(appState, imported);
		} catch (err) {
			appState.errors.push(err instanceof Error ? err.message : String(err));
		}
	}

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
	<div class="header">
		<ErrorBanner bind:appState />
		<div class="controls">
			<button class="control-btn" onclick={handleExportState}>Export State</button>
			<button class="control-btn" onclick={() => fileInput.click()}>Import State</button>
			<button class="control-btn" onclick={handleExportLog}>Export Log</button>
			<input
				type="file"
				accept=".json"
				style="display:none"
				bind:this={fileInput}
				onchange={handleImportState}
			/>
		</div>
	</div>

	<div class="layout">
		<div class="left-panel">
			<MessageLog {appState} />

			{#if appState.pendingDiceRequests.length > 0}
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
