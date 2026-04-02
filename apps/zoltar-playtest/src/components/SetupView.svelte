<script lang="ts">
	import { untrack } from 'svelte';
	import type { AppState } from '../lib/types';
	import CharacterForm from './CharacterForm.svelte';

	let { appState }: { appState: AppState } = $props();

	// Determine initial step from existing state at mount time
	let step = $state(untrack(() =>
		appState.gmContextBlob ? 4
		: appState.character ? 3
		: appState.apiKey ? 2
		: 1
	));

	function saveApiKey() {
		if (appState.apiKey.trim()) {
			step = 2;
		}
	}

	function onCharacterSaved() {
		step = 3;
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
		</div>
	{:else if step === 2}
		<div class="section">
			<h2>Character Sheet</h2>
			<CharacterForm {appState} onSave={onCharacterSaved} />
		</div>
	{:else if step === 3}
		<div class="section">
			<h2>Oracle Tables</h2>
			<p>Oracle picker coming in Phase 9.</p>
			<button onclick={() => (step = 2)}>Back to Character</button>
		</div>
	{:else if step === 4}
		<div class="section">
			<h2>Synthesis</h2>
			<p>Synthesis coming in Phase 9.</p>
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
</style>
