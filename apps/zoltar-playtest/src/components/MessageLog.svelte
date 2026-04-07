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
		type: 'player' | 'gm' | 'roll' | 'system';
		text: string;
		turn?: number;
		timestamp?: string;
		rollDetail?: { notation: string; purpose: string; total: number; results: number[] };
	};

	function formatTimestamp(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	function extractPlayerAction(content: string): string | null {
		// New format: look for [PLAYER INPUT] marker
		const marker = '[PLAYER INPUT]\n';
		const idx = content.indexOf(marker);
		if (idx !== -1) {
			return content.slice(idx + marker.length).trim();
		}
		// Old format: last paragraph after snapshot
		const parts = content.split('\n\n');
		const action = parts[parts.length - 1].trim();
		if (action && !action.startsWith('## Current State') && !action.startsWith('[CURRENT GAME STATE]')) {
			return action;
		}
		return null;
	}

	function buildLogEntries(): LogEntry[] {
		const entries: LogEntry[] = [];

		for (let i = 0; i < appState.messages.length; i++) {
			const msg = appState.messages[i];

			if (msg.role === 'user' && typeof msg.content === 'string') {
				const action = extractPlayerAction(msg.content);
				if (action) {
					entries.push({ type: 'player', text: action, turn: msg.turn, timestamp: msg.timestamp });
				}
			} else if (msg.role === 'assistant') {
				const content = msg.content;
				if (Array.isArray(content)) {
					for (const block of content) {
						const b = block as Record<string, unknown>;
						if (b.type === 'tool_use' && b.name === 'roll_dice') {
							const input = b.input as Record<string, unknown>;
							// Find the matching tool_result in the next message
							const toolId = b.id as string;
							let rollResult: Record<string, unknown> | null = null;
							if (i + 1 < appState.messages.length) {
								const nextMsg = appState.messages[i + 1];
								const nextContent = nextMsg.content;
								if (Array.isArray(nextContent)) {
									for (const rb of nextContent as Record<string, unknown>[]) {
										if (rb.type === 'tool_result' && rb.tool_use_id === toolId) {
											try {
												rollResult = JSON.parse(rb.content as string);
											} catch { /* ignore */ }
										}
									}
								}
							}

							const purpose = (input.purpose as string) || 'Roll';
							const notation = (input.notation as string) || '?';

							if (rollResult) {
								entries.push({
									type: 'roll',
									text: `${purpose}: ${notation}`,
									turn: msg.turn,
									timestamp: msg.timestamp,
									rollDetail: {
										notation,
										purpose,
										total: rollResult.total as number,
										results: rollResult.results as number[]
									}
								});
							} else {
								entries.push({
									type: 'roll',
									text: `${purpose}: ${notation} (result pending)`,
									turn: msg.turn,
									timestamp: msg.timestamp
								});
							}
						} else if (b.type === 'tool_use' && b.name === 'submit_gm_response') {
							const input = b.input as Record<string, unknown>;
							if (input.playerText) {
								entries.push({ type: 'gm', text: input.playerText as string, turn: msg.turn, timestamp: msg.timestamp });
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
		{#if entry.type === 'roll'}
			<div class="log-entry roll">
				{#if entry.turn != null}
					<div class="entry-meta">Turn {entry.turn}{#if entry.timestamp} &middot; {formatTimestamp(entry.timestamp)}{/if}</div>
				{/if}
				<div class="roll-header">
					<span class="roll-icon">&#9858;</span>
					<span class="roll-purpose">{entry.rollDetail?.purpose ?? entry.text}</span>
				</div>
				{#if entry.rollDetail}
					<div class="roll-result">
						<span class="roll-notation">{entry.rollDetail.notation}</span>
						<span class="roll-arrow">&rarr;</span>
						<span class="roll-dice-values">[{entry.rollDetail.results.join(', ')}]</span>
						<span class="roll-total">= {entry.rollDetail.total}</span>
					</div>
				{/if}
			</div>
		{:else}
			<div class="log-entry {entry.type}">
				{#if entry.turn != null}
					<div class="entry-meta">Turn {entry.turn}{#if entry.timestamp} &middot; {formatTimestamp(entry.timestamp)}{/if}</div>
				{/if}
				{#if entry.type === 'player'}
					<span class="label">You:</span>
				{:else if entry.type === 'gm'}
					<span class="label">Warden:</span>
				{:else}
					<span class="label">System:</span>
				{/if}
				<div class="text">{entry.text}</div>
			</div>
		{/if}
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

	.log-entry.roll {
		background: #2a2a1a;
		border-left: 3px solid #d4b460;
		font-size: 0.8125rem;
	}

	.roll-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.25rem;
	}

	.roll-icon {
		font-size: 1rem;
		line-height: 1;
	}

	.roll-purpose {
		color: #d4b460;
		font-weight: bold;
	}

	.roll-result {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-family: monospace;
		padding-left: 1.375rem;
	}

	.roll-notation {
		color: #888;
	}

	.roll-arrow {
		color: #666;
	}

	.roll-dice-values {
		color: #aaa;
	}

	.roll-total {
		color: #e0e0e0;
		font-weight: bold;
	}

	.entry-meta {
		font-size: 0.6875rem;
		color: #666;
		margin-bottom: 0.25rem;
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
