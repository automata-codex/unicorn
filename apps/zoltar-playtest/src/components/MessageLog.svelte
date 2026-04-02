<script lang="ts">
	import type { AppState } from '../lib/types';

	let { appState }: { appState: AppState } = $props();

	let scrollContainer: HTMLDivElement;

	$effect(() => {
		// Trigger on message count changes
		appState.messages.length;
		if (scrollContainer) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	});

	type LogEntry = {
		type: 'player' | 'gm' | 'system';
		text: string;
	};

	function buildLogEntries(): LogEntry[] {
		const entries: LogEntry[] = [];
		for (const msg of appState.messages) {
			if (msg.role === 'user' && typeof msg.content === 'string') {
				// Extract just the player action (after the snapshot)
				const parts = msg.content.split('\n\n');
				const action = parts[parts.length - 1];
				if (action && !action.startsWith('## Current State')) {
					entries.push({ type: 'player', text: action });
				}
			} else if (msg.role === 'assistant') {
				// Extract playerText from tool_use blocks in the content
				const content = msg.content;
				if (Array.isArray(content)) {
					for (const block of content) {
						const b = block as Record<string, unknown>;
						if (b.type === 'tool_use' && b.name === 'submit_gm_response') {
							const input = b.input as Record<string, unknown>;
							if (input.playerText) {
								entries.push({ type: 'gm', text: input.playerText as string });
							}
						}
					}
				}
			}
		}

		// Add system messages from errors that are info/warn
		for (const err of appState.errors) {
			if (err.startsWith('[info]') || err.startsWith('[warn]')) {
				entries.push({ type: 'system', text: err });
			}
		}

		return entries;
	}
</script>

<div class="message-log" bind:this={scrollContainer}>
	{#each buildLogEntries() as entry}
		<div class="log-entry {entry.type}">
			{#if entry.type === 'player'}
				<span class="label">You:</span>
			{:else if entry.type === 'gm'}
				<span class="label">Warden:</span>
			{:else}
				<span class="label">System:</span>
			{/if}
			<div class="text">{entry.text}</div>
		</div>
	{/each}

	{#if appState.messages.length === 0}
		<div class="empty">The adventure awaits. What do you do?</div>
	{/if}
</div>

<style>
	.message-log {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.5rem;
		min-height: 0;
	}

	.log-entry {
		padding: 0.5rem 0.75rem;
		border-radius: 4px;
	}

	.log-entry.player {
		background: #1a2a4a;
		border-left: 3px solid #6a9fd8;
	}

	.log-entry.gm {
		background: #2a1a3a;
		border-left: 3px solid #c4a7e7;
	}

	.log-entry.system {
		background: #1a3a3a;
		border-left: 3px solid #7ec;
		font-size: 0.8125rem;
	}

	.label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		display: block;
		margin-bottom: 0.25rem;
	}

	.text {
		white-space: pre-wrap;
		word-wrap: break-word;
		line-height: 1.5;
	}

	.empty {
		color: #666;
		font-style: italic;
		padding: 1rem;
		text-align: center;
	}
</style>
