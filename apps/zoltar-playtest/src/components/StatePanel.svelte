<script lang="ts">
	import type { AppState } from '../lib/types';

	let { appState = $bindable() }: { appState: AppState } = $props();

	let editingPool = $state<string | null>(null);
	let editValue = $state('');

	let poolEntries = $derived(
		Object.entries(appState.resourcePools).filter(([name, pool]) => {
			if (appState.character) {
				const cid = appState.character.id;
				if (name === `${cid}_hp` || name === `${cid}_stress`) return false;
			}
			return pool.current !== 0 || pool.max != null;
		})
	);

	let entityEntries = $derived(Object.entries(appState.entities));
	let scenarioEntries = $derived(Object.entries(appState.scenarioState));
	let worldFactEntries = $derived(Object.entries(appState.worldFacts));
	let flagEntries = $derived(Object.entries(appState.flags));

	function startEdit(poolName: string) {
		editingPool = poolName;
		editValue = String(appState.resourcePools[poolName].current);
	}

	function commitEdit(poolName: string) {
		const val = parseInt(editValue);
		if (!isNaN(val)) {
			appState.resourcePools[poolName].current = val;
		}
		editingPool = null;
	}

	function onEditKeydown(e: KeyboardEvent, poolName: string) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitEdit(poolName);
		} else if (e.key === 'Escape') {
			editingPool = null;
		}
	}

	function poolDisplay(current: number, max: number | null): string {
		return max != null ? `${current}/${max}` : `${current}`;
	}

	function hpPercent(current: number, max: number): number {
		return Math.max(0, Math.min(100, (current / max) * 100));
	}
</script>

<div class="state-panel">
	{#if appState.character}
		{@const c = appState.character}
		{@const hpPool = appState.resourcePools[`${c.id}_hp`]}
		{@const stressPool = appState.resourcePools[`${c.id}_stress`]}
		{@const wounds = appState.wounds[c.id]}

		<section>
			<h3>{c.name} <span class="class-tag">{c.class}</span></h3>

			{#if hpPool && hpPool.max != null}
				<div class="hp-row">
					<span class="pool-label">HP</span>
					<div class="hp-bar-container">
						<div
							class="hp-bar-fill"
							class:critical={hpPool.current <= (hpPool.max * 0.25)}
							style="width: {hpPercent(hpPool.current, hpPool.max)}%"
						></div>
					</div>
					<span class="pool-value">{hpPool.current}/{hpPool.max}</span>
				</div>
			{/if}

			{#if stressPool}
				<div class="stat-row">
					<span class="pool-label">Stress</span>
					<span class="pool-value">{stressPool.current}</span>
				</div>
			{/if}

			{#if wounds?.length}
				<div class="stat-row">
					<span class="pool-label">Wounds</span>
					<span class="pool-value wound">{wounds.join(', ')}</span>
				</div>
			{/if}
		</section>
	{/if}

	{#if poolEntries.length > 0}
		<section>
			<h3>Resource Pools</h3>
			{#each poolEntries as [name, pool]}
				<div class="stat-row">
					<span class="pool-label">{name}</span>
					{#if editingPool === name}
						<input
							class="edit-input"
							type="number"
							bind:value={editValue}
							onblur={() => commitEdit(name)}
							onkeydown={(e) => onEditKeydown(e, name)}
						/>
					{:else}
						<button class="pool-value editable" onclick={() => startEdit(name)}>
							{poolDisplay(pool.current, pool.max)}
						</button>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	{#if scenarioEntries.length > 0}
		<section>
			<h3>Scenario State</h3>
			{#each scenarioEntries as [name, entry]}
				<div class="stat-row">
					<span class="pool-label">{name}</span>
					<span class="pool-value">
						{entry.max != null ? `${entry.current}/${entry.max}` : `${entry.current}`}
					</span>
				</div>
				{#if entry.note}
					<div class="scenario-note">{entry.note}</div>
				{/if}
			{/each}
		</section>
	{/if}

	{#if entityEntries.length > 0}
		<section>
			<h3>Entities</h3>
			{#each entityEntries as [id, entity]}
				<div class="entity-row" class:entity-dead={entity.status === 'dead'}>
					<span class="entity-id">{id}</span>
					<span class="entity-status" class:status-dead={entity.status === 'dead'} class:status-alive={entity.status === 'alive'}>
						{entity.status}
					</span>
					<span class="entity-vis" class:hidden={!entity.visible}>
						{entity.visible ? 'visible' : 'hidden'}
					</span>
					{#if entity.npcState}
						<div class="npc-state">{entity.npcState}</div>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	{#if appState.flags.adventure_complete}
		<section>
			<div class="adventure-complete-banner">Adventure Complete</div>
		</section>
	{/if}

	{#if flagEntries.length > 0}
		<section>
			<h3>Flags</h3>
			{#each flagEntries as [name, value]}
				<div class="stat-row">
					<span class="pool-label">{name}</span>
					<span class="flag-value" class:flag-true={value}>{value}</span>
				</div>
			{/each}
		</section>
	{/if}

	{#if worldFactEntries.length > 0}
		<section>
			<h3>World Facts</h3>
			{#each worldFactEntries as [key, value]}
				<div class="world-fact">
					<span class="world-fact-key">{key}</span>
					<span class="world-fact-value">{value}</span>
				</div>
			{/each}
		</section>
	{/if}

	{#if appState.pendingCanon.length > 0}
		<section>
			<h3>Pending Canon</h3>
			{#each appState.pendingCanon as canon}
				<div class="canon-item">
					<div class="canon-summary">{canon.summary}</div>
					<div class="canon-context">{canon.context}</div>
				</div>
			{/each}
		</section>
	{/if}
</div>

<style>
	.state-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		font-size: 0.8125rem;
	}

	section {
		border-bottom: 1px solid #333;
		padding-bottom: 0.75rem;
	}

	section:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	h3 {
		margin: 0 0 0.5rem 0;
		font-size: 0.8125rem;
		color: #aaa;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.class-tag {
		color: #c4a7e7;
		text-transform: capitalize;
		font-weight: normal;
	}

	.hp-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.hp-bar-container {
		flex: 1;
		height: 10px;
		background: #333;
		border-radius: 5px;
		overflow: hidden;
	}

	.hp-bar-fill {
		height: 100%;
		background: #7ec;
		border-radius: 5px;
		transition: width 0.3s;
	}

	.hp-bar-fill.critical {
		background: #e55;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.125rem 0;
	}

	.pool-label {
		color: #888;
		font-family: monospace;
	}

	.pool-value {
		color: #e0e0e0;
		font-family: monospace;
	}

	.pool-value.editable {
		background: none;
		border: 1px solid transparent;
		border-radius: 3px;
		padding: 0 0.25rem;
		cursor: pointer;
		font-size: 0.8125rem;
		color: #e0e0e0;
		font-family: monospace;
	}

	.pool-value.editable:hover {
		border-color: #555;
		background: #16213e;
	}

	.wound {
		color: #e55;
	}

	.edit-input {
		width: 60px;
		background: #16213e;
		color: #e0e0e0;
		border: 1px solid #c4a7e7;
		border-radius: 3px;
		padding: 0 0.25rem;
		font-size: 0.8125rem;
		font-family: monospace;
		text-align: right;
	}

	.entity-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
		padding: 0.25rem 0;
	}

	.world-fact {
		display: flex;
		flex-direction: column;
		padding: 0.125rem 0;
	}

	.world-fact-key {
		color: #888;
		font-family: monospace;
		font-size: 0.75rem;
	}

	.world-fact-value {
		color: #e0e0e0;
		font-size: 0.8125rem;
		padding-left: 0.5rem;
	}

	.scenario-note {
		font-size: 0.6875rem;
		color: #666;
		font-style: italic;
		padding-left: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.entity-dead {
		opacity: 0.5;
		text-decoration: line-through;
	}

	.entity-id {
		color: #c4a7e7;
		font-family: monospace;
	}

	.entity-status {
		font-size: 0.75rem;
		color: #888;
	}

	.entity-status.status-alive {
		color: #7ec;
	}

	.entity-status.status-dead {
		color: #e55;
	}

	.entity-vis {
		font-size: 0.75rem;
		color: #7ec;
	}

	.entity-vis.hidden {
		color: #888;
	}

	.npc-state {
		width: 100%;
		font-size: 0.75rem;
		color: #aaa;
		font-style: italic;
		padding-left: 0.5rem;
	}

	.flag-value {
		color: #888;
		font-family: monospace;
	}

	.flag-value.flag-true {
		color: #7ec;
	}

	.adventure-complete-banner {
		background: #2a4a2a;
		border: 1px solid #7ec;
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		color: #7ec;
		font-weight: bold;
		text-align: center;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-size: 0.8125rem;
	}

	.canon-item {
		padding: 0.25rem 0;
	}

	.canon-summary {
		color: #e0e0e0;
	}

	.canon-context {
		font-size: 0.75rem;
		color: #888;
		margin-top: 0.125rem;
	}
</style>
