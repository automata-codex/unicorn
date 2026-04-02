<script lang="ts">
	import { untrack } from 'svelte';
	import type { AppState, OracleEntry, MothershipCharacter, GmContextStructured } from '../lib/types';
	import { runSynthesis, type OracleSelections } from '../lib/api';
	import { initializePlayerPools, initializeFromGmContext } from '../lib/state.svelte';
	import CharacterForm from './CharacterForm.svelte';
	import OraclePicker from './OraclePicker.svelte';

	let { appState = $bindable() }: { appState: AppState } = $props();

	// Determine initial step from existing state at mount time
	let step = $state(untrack(() =>
		appState.gmContextBlob ? 4
		: appState.character ? 3
		: appState.apiKey ? 2
		: 1
	));

	let oracleSelections = $state<Record<string, OracleEntry> | null>(null);
	let synthesizing = $state(false);
	let synthesisFileInput = $state<HTMLInputElement>(null!);

	function saveApiKey() {
		if (appState.apiKey.trim()) {
			step = 2;
		}
	}

	function onCharacterSaved() {
		step = 3;
	}

	function onOracleSelect(selections: Record<string, OracleEntry>) {
		oracleSelections = selections;
		step = 4;
	}

	async function synthesize() {
		if (!oracleSelections) return;
		synthesizing = true;
		await runSynthesis(appState, oracleSelections as OracleSelections);
		synthesizing = false;
	}

	function beginAdventure() {
		appState.view = 'play';
	}

	type SynthesisExport = {
		character: MothershipCharacter;
		gmContextBlob: string;
		gmContextStructured: GmContextStructured;
	};

	function exportSynthesis() {
		if (!appState.character || !appState.gmContextBlob || !appState.gmContextStructured) return;
		const data: SynthesisExport = {
			character: appState.character,
			gmContextBlob: appState.gmContextBlob,
			gmContextStructured: appState.gmContextStructured
		};
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `zoltar-synthesis-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function handleImportSynthesis(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const data = JSON.parse(reader.result as string) as SynthesisExport;
				if (!data.character || !data.gmContextBlob || !data.gmContextStructured) {
					appState.errors.push('Invalid synthesis file: missing required fields.');
					return;
				}
				appState.character = data.character;
				appState.gmContextBlob = data.gmContextBlob;
				appState.gmContextStructured = data.gmContextStructured;
				initializePlayerPools(appState, data.character);
				initializeFromGmContext(appState, data.gmContextStructured);
				step = 4;
			} catch {
				appState.errors.push('Failed to parse synthesis file.');
			}
		};
		reader.readAsText(file);
		// Reset so the same file can be re-imported
		(e.target as HTMLInputElement).value = '';
	}
</script>

<div class="setup">
	<div class="steps">
		<span class="step" class:active={step === 1} class:done={step > 1}>1. API Key</span>
		<span class="step" class:active={step === 2} class:done={step > 2}>2. Character</span>
		<span class="step" class:active={step === 3} class:done={step > 3}>3. Oracle Tables</span>
		<span class="step" class:active={step === 4}>4. Synthesis</span>
	</div>

	{#if step === 1}
		<div class="section">
			<h2>API Key</h2>
			<p>Enter your Anthropic API key. It will be stored in localStorage.</p>
			<div class="field-row">
				<input
					type="password"
					bind:value={appState.apiKey}
					placeholder="sk-ant-..."
					class="input-full"
				/>
				<button onclick={saveApiKey} disabled={!appState.apiKey.trim()}>Continue</button>
			</div>
			<div class="import-row">
				<span class="or-divider">or</span>
				<button class="import-btn" onclick={() => synthesisFileInput.click()}>
					Import Synthesis
				</button>
				<input
					type="file"
					accept=".json"
					style="display:none"
					bind:this={synthesisFileInput}
					onchange={handleImportSynthesis}
				/>
			</div>
		</div>
	{:else if step === 2}
		<div class="section">
			<h2>Character Sheet</h2>
			<CharacterForm bind:appState onSave={onCharacterSaved} />
		</div>
	{:else if step === 3}
		<div class="section">
			<h2>Oracle Tables</h2>
			<p>Select one entry from each category, then continue to synthesis.</p>
			<OraclePicker onSelect={onOracleSelect} />
			<button class="back-btn" onclick={() => (step = 2)}>Back to Character</button>
		</div>
	{:else if step === 4}
		<div class="section">
			<h2>Synthesis</h2>

			{#if !appState.gmContextBlob}
				{#if oracleSelections}
					<div class="synthesis-summary">
						<h3>Oracle Selections</h3>
						{#each Object.entries(oracleSelections) as [category, entry]}
							<div class="selection-item">
								<span class="selection-label">{category}:</span>
								<span>{entry.player_text}</span>
							</div>
						{/each}
					</div>
				{/if}

				<button
					onclick={synthesize}
					disabled={synthesizing || !oracleSelections}
				>
					{synthesizing ? 'Synthesizing...' : 'Synthesize Adventure'}
				</button>

				<button class="back-btn" onclick={() => (step = 3)}>Back to Oracle Tables</button>
			{:else}
				<div class="review">
					<h3>GM Context — Review</h3>
					<pre class="context-blob">{appState.gmContextBlob}</pre>

					{#if appState.gmContextStructured}
						<h3>Entities</h3>
						<div class="entities-list">
							{#each appState.gmContextStructured.entities as entity}
								<div class="entity-item">
									<span class="entity-id">{entity.id}</span>
									<span class="entity-type">({entity.type})</span>
									<span class="entity-vis">{entity.visible ? 'visible' : 'hidden'}</span>
									{#if entity.tags.length}
										<span class="entity-tags">[{entity.tags.join(', ')}]</span>
									{/if}
								</div>
							{/each}
						</div>

						{#if Object.keys(appState.gmContextStructured.initialFlags).length}
							<h3>Initial Flags</h3>
							<div class="flags-list">
								{#each Object.entries(appState.gmContextStructured.initialFlags) as [flag, value]}
									<div>{flag}: {value}</div>
								{/each}
							</div>
						{/if}
					{/if}

					<div class="review-actions">
						<button class="begin-btn" onclick={beginAdventure}>Begin Adventure</button>
						<button class="export-btn" onclick={exportSynthesis}>Export Synthesis</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.setup {
		max-width: 700px;
	}

	.steps {
		display: flex;
		gap: 1rem;
		margin-bottom: 1.5rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #333;
	}

	.step {
		font-size: 0.875rem;
		color: #666;
	}

	.step.active {
		color: #c4a7e7;
		font-weight: bold;
	}

	.step.done {
		color: #7ec;
	}

	.section h2 {
		margin-top: 0;
	}

	.field-row {
		display: flex;
		gap: 0.5rem;
	}

	.input-full {
		flex: 1;
	}

	input {
		background: #16213e;
		color: #e0e0e0;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.5rem;
		font-size: 0.875rem;
	}

	input:focus {
		outline: none;
		border-color: #c4a7e7;
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
	}

	button:hover {
		background: #d4b7f7;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.back-btn {
		background: #2a2a4a;
		color: #aaa;
		border: 1px solid #444;
		margin-top: 1rem;
	}

	.back-btn:hover {
		background: #3a3a5a;
		color: #e0e0e0;
	}

	.synthesis-summary {
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.75rem;
		margin-bottom: 1rem;
	}

	.synthesis-summary h3 {
		margin: 0 0 0.5rem 0;
		font-size: 0.875rem;
		color: #aaa;
	}

	.selection-item {
		font-size: 0.875rem;
		padding: 0.125rem 0;
	}

	.selection-label {
		color: #888;
		margin-right: 0.5rem;
	}

	.review h3 {
		color: #aaa;
		font-size: 0.875rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 1rem 0 0.5rem 0;
	}

	.review h3:first-child {
		margin-top: 0;
	}

	.context-blob {
		background: #16213e;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.75rem;
		font-size: 0.8125rem;
		white-space: pre-wrap;
		word-wrap: break-word;
		max-height: 400px;
		overflow-y: auto;
	}

	.entities-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.entity-item {
		font-size: 0.875rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.entity-id {
		color: #c4a7e7;
		font-family: monospace;
	}

	.entity-type {
		color: #888;
	}

	.entity-vis {
		color: #7ec;
		font-size: 0.75rem;
	}

	.entity-tags {
		color: #666;
		font-size: 0.75rem;
	}

	.flags-list {
		font-size: 0.875rem;
		font-family: monospace;
		color: #aaa;
	}

	.review-actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		margin-top: 1.5rem;
	}

	.begin-btn {
		background: #7ec;
		color: #1a1a2e;
		font-size: 1rem;
		padding: 0.75rem 1.5rem;
	}

	.begin-btn:hover {
		background: #9fc;
	}

	.export-btn {
		background: #2a2a4a;
		color: #aaa;
		border: 1px solid #444;
		font-size: 0.8125rem;
		padding: 0.5rem 0.75rem;
	}

	.export-btn:hover {
		background: #3a3a5a;
		color: #e0e0e0;
	}

	.import-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.or-divider {
		color: #666;
		font-size: 0.8125rem;
	}

	.import-btn {
		background: #2a2a4a;
		color: #aaa;
		border: 1px solid #444;
		font-size: 0.8125rem;
		padding: 0.375rem 0.75rem;
	}

	.import-btn:hover {
		background: #3a3a5a;
		color: #e0e0e0;
	}
</style>
