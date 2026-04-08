<script lang="ts">
	import type { AppState } from '../lib/types';
	import { executeDiceRoll } from '../lib/dice';
	import { runTurn } from '../lib/api';

	let { appState = $bindable() }: { appState: AppState } = $props();

	let results = $state<(number | null)[]>(
		appState.pendingDiceRequests.map(() => null)
	);

	function rollForMe(index: number) {
		const req = appState.pendingDiceRequests[index];
		try {
			const roll = executeDiceRoll(req.notation);
			results[index] = roll.total;
		} catch (e) {
			appState.errors.push(e instanceof Error ? e.message : String(e));
		}
	}

	function allFilled(): boolean {
		return results.every((r) => r != null);
	}

	async function submitResults() {
		if (!allFilled()) return;

		const lines = ['[Dice results]'];
		const playerDiceRolls = [];
		for (let i = 0; i < appState.pendingDiceRequests.length; i++) {
			const req = appState.pendingDiceRequests[i];
			lines.push(`${req.purpose} (${req.notation}): ${results[i]}`);
			playerDiceRolls.push({
				purpose: req.purpose,
				notation: req.notation,
				result: results[i]!,
				source: 'player' as const
			});
		}

		appState.pendingDiceRequests = [];
		await runTurn(appState, lines.join('\n'), playerDiceRolls);
	}
</script>

<div class="dice-prompt">
	<h3>Dice Rolls Required</h3>

	{#each appState.pendingDiceRequests as req, i}
		<div class="dice-request">
			<div class="dice-info">
				<span class="dice-purpose">{req.purpose}</span>
				<span class="dice-notation">{req.notation}</span>
				{#if req.target != null}
					<span class="dice-target">Target: {req.target}</span>
				{/if}
			</div>
			<div class="dice-controls">
				<button class="roll-btn" onclick={() => rollForMe(i)} disabled={results[i] != null}>
					Roll for me
				</button>
				<input
					class="dice-input"
					type="number"
					placeholder="—"
					value={results[i] ?? ''}
					oninput={(e) => {
						const val = parseInt((e.target as HTMLInputElement).value);
						results[i] = isNaN(val) ? null : val;
					}}
				/>
			</div>
		</div>
	{/each}

	<button
		class="submit-btn"
		disabled={!allFilled() || appState.loading}
		onclick={submitResults}
	>
		{appState.loading ? 'Submitting...' : 'Submit Dice Results'}
	</button>
</div>

<style>
	.dice-prompt {
		border: 2px solid #c4a7e7;
		border-radius: 4px;
		padding: 0.75rem;
		background: #2a1a3a;
	}

	h3 {
		margin: 0 0 0.75rem 0;
		font-size: 0.875rem;
		color: #c4a7e7;
	}

	.dice-request {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0;
		border-bottom: 1px solid #333;
	}

	.dice-request:last-of-type {
		border-bottom: none;
	}

	.dice-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.dice-purpose {
		font-size: 0.875rem;
	}

	.dice-notation {
		font-size: 0.75rem;
		color: #888;
		font-family: monospace;
	}

	.dice-target {
		font-size: 0.75rem;
		color: #7ec;
	}

	.dice-controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.roll-btn {
		background: #2a2a4a;
		color: #c4a7e7;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.roll-btn:hover {
		background: #3a3a5a;
	}

	.roll-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.dice-input {
		width: 60px;
		background: #16213e;
		color: #e0e0e0;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-size: 0.875rem;
		font-family: monospace;
		text-align: center;
	}

	.dice-input:focus {
		outline: none;
		border-color: #c4a7e7;
	}

	.submit-btn {
		margin-top: 0.75rem;
		background: #c4a7e7;
		color: #1a1a2e;
		border: none;
		border-radius: 4px;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		cursor: pointer;
		font-weight: bold;
		width: 100%;
	}

	.submit-btn:hover {
		background: #d4b7f7;
	}

	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
