<script lang="ts">
	import type { OracleTable, OracleEntry } from '../lib/types';
	import { loadOracleTables, pickRandom } from '../lib/oracle';

	let { onSelect }: {
		onSelect: (selections: Record<string, OracleEntry>) => void;
	} = $props();

	let tables = $state<Record<string, OracleTable>>({});
	let loading = $state(true);
	let error = $state('');
	let collapsed = $state<Record<string, boolean>>({});
	let inactive = $state<Record<string, Set<string>>>({});
	let selected = $state<Record<string, OracleEntry | null>>({});

	const CATEGORIES = ['survivor', 'threat', 'secret', 'vessel_type', 'tone'];
	const CATEGORY_LABELS: Record<string, string> = {
		survivor: 'Survivors',
		threat: 'Threats',
		secret: 'Secrets',
		vessel_type: 'Vessel Type',
		tone: 'Tone'
	};

	async function load() {
		try {
			tables = await loadOracleTables();
			for (const cat of CATEGORIES) {
				collapsed[cat] = false;
				inactive[cat] = new Set();
				selected[cat] = null;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	load();

	function toggleEntry(category: string, entryId: string) {
		const set = inactive[category];
		if (set.has(entryId)) {
			set.delete(entryId);
		} else {
			set.add(entryId);
			// Clear selection if it was deactivated
			if (selected[category]?.id === entryId) {
				selected[category] = null;
			}
		}
		// Trigger reactivity on the record
		inactive[category] = new Set(set);
	}

	function randomPick(category: string) {
		const table = tables[category];
		if (!table) return;
		const active = table.entries.filter((e) => !inactive[category].has(e.id));
		if (active.length === 0) return;
		selected[category] = pickRandom(active);
	}

	function isEntryActive(category: string, entryId: string): boolean {
		return !inactive[category]?.has(entryId);
	}

	function allSelected(): boolean {
		return CATEGORIES.every((cat) => selected[cat] != null);
	}

	function confirm() {
		const selections: Record<string, OracleEntry> = {};
		for (const cat of CATEGORIES) {
			if (!selected[cat]) return;
			selections[cat] = selected[cat];
		}
		onSelect(selections);
	}
</script>

{#if loading}
	<p>Loading oracle tables...</p>
{:else if error}
	<p class="error">{error}</p>
{:else}
	<div class="oracle-picker">
		{#each CATEGORIES as category}
			{@const table = tables[category]}
			{#if table}
				<div class="category">
					<div class="category-header">
						<button
							class="collapse-toggle"
							onclick={() => (collapsed[category] = !collapsed[category])}
						>
							{collapsed[category] ? '▶' : '▼'}
						</button>
						<h3>{CATEGORY_LABELS[category]}</h3>
						<button class="pick-btn" onclick={() => randomPick(category)}>Random Pick</button>
					</div>

					{#if !collapsed[category]}
						<div class="entries">
							{#each table.entries as entry}
								<div
									class="entry"
									class:inactive={!isEntryActive(category, entry.id)}
									class:selected={selected[category]?.id === entry.id}
								>
									<label class="entry-label">
										<input
											type="checkbox"
											checked={isEntryActive(category, entry.id)}
											onchange={() => toggleEntry(category, entry.id)}
										/>
										<span class="entry-text">{entry.player_text}</span>
									</label>
									<button
										class="select-btn"
										disabled={!isEntryActive(category, entry.id)}
										onclick={() => (selected[category] = entry)}
									>
										Select
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/each}

		<div class="summary">
			<h3>Selected</h3>
			{#each CATEGORIES as category}
				<div class="summary-item">
					<span class="summary-label">{CATEGORY_LABELS[category]}:</span>
					<span class="summary-value">
						{selected[category]?.player_text ?? '(none)'}
					</span>
				</div>
			{/each}
		</div>

		<button class="confirm-btn" disabled={!allSelected()} onclick={confirm}>
			Continue to Synthesis
		</button>
	</div>
{/if}

<style>
	.oracle-picker {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.category {
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.75rem;
	}

	.category-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.category-header h3 {
		margin: 0;
		flex: 1;
		font-size: 1rem;
	}

	.collapse-toggle {
		background: none;
		border: none;
		color: #e0e0e0;
		cursor: pointer;
		padding: 0;
		font-size: 0.75rem;
	}

	.pick-btn, .select-btn {
		background: #2a2a4a;
		color: #c4a7e7;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.pick-btn:hover, .select-btn:hover {
		background: #3a3a5a;
	}

	.select-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.entries {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.5rem;
	}

	.entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.375rem 0.5rem;
		border-radius: 4px;
		background: #16213e;
	}

	.entry.inactive {
		opacity: 0.4;
	}

	.entry.selected {
		background: #2a3a5a;
		border: 1px solid #c4a7e7;
	}

	.entry-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		flex: 1;
	}

	.entry-text {
		font-size: 0.875rem;
	}

	.summary {
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.75rem;
		background: #16213e;
	}

	.summary h3 {
		margin: 0 0 0.5rem 0;
		font-size: 0.875rem;
		color: #aaa;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.summary-item {
		display: flex;
		gap: 0.5rem;
		font-size: 0.875rem;
		padding: 0.125rem 0;
	}

	.summary-label {
		color: #888;
		min-width: 100px;
	}

	.summary-value {
		color: #c4a7e7;
	}

	.confirm-btn {
		background: #c4a7e7;
		color: #1a1a2e;
		border: none;
		border-radius: 4px;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		cursor: pointer;
		font-weight: bold;
		align-self: flex-start;
	}

	.confirm-btn:hover {
		background: #d4b7f7;
	}

	.confirm-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.error {
		color: #f77;
	}
</style>
