<script lang="ts">
	import { untrack } from 'svelte';
	import type { AppState, MothershipCharacter } from '../lib/types';
	import { initializePlayerPools } from '../lib/state.svelte';

	let { appState = $bindable(), onSave }: { appState: AppState; onSave: () => void } = $props();

	// Capture initial values to avoid Svelte reactive-prop-in-$state warnings.
	// These are form defaults — we intentionally want the value at mount time.
	const initial = untrack(() => appState.character);

	let name = $state(initial?.name ?? '');
	let entityId = $state(initial?.id ?? '');
	let charClass = $state<MothershipCharacter['class']>(initial?.class ?? 'marine');
	let strength = $state(initial?.stats.strength ?? 30);
	let speed = $state(initial?.stats.speed ?? 30);
	let intellect = $state(initial?.stats.intellect ?? 30);
	let combat = $state(initial?.stats.combat ?? 30);
	let fear = $state(initial?.saves.fear ?? 30);
	let sanity = $state(initial?.saves.sanity ?? 30);
	let body = $state(initial?.saves.body ?? 30);
	let armor = $state(initial?.saves.armor ?? 30);
	let maxHp = $state(initial?.maxHp ?? 20);
	let skills = $state(initial?.skills.join(', ') ?? '');
	let idManuallyEdited = $state(!!initial);
	let validationError = $state('');

	function slugify(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, '')
			.replace(/\s+/g, '_')
			.replace(/^_+|_+$/g, '');
	}

	function onNameInput() {
		if (!idManuallyEdited) {
			entityId = slugify(name);
		}
	}

	function onIdInput() {
		idManuallyEdited = true;
	}

	function validate(): string {
		if (!name.trim()) return 'Name is required.';
		if (!entityId.trim()) return 'Entity ID is required.';
		if (!/^[a-z0-9_]+$/.test(entityId)) {
			return 'Entity ID must contain only lowercase letters, numbers, and underscores.';
		}
		if (maxHp < 1) return 'Max HP must be at least 1.';
		return '';
	}

	function save() {
		const error = validate();
		if (error) {
			validationError = error;
			return;
		}

		const character: MothershipCharacter = {
			id: entityId,
			name: name.trim(),
			class: charClass,
			stats: { strength, speed, intellect, combat },
			saves: { fear, sanity, body, armor },
			maxHp,
			skills: skills
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		};

		appState.character = character;
		initializePlayerPools(appState, character);
		onSave();
	}
</script>

<div class="form">
	<div class="field">
		<label for="name">Name</label>
		<input id="name" type="text" bind:value={name} oninput={onNameInput} placeholder="Dr. Chen" />
	</div>

	<div class="field">
		<label for="entity-id">Entity ID</label>
		<input id="entity-id" type="text" bind:value={entityId} oninput={onIdInput} placeholder="dr_chen" />
		<span class="hint">Lowercase, underscores only</span>
	</div>

	<div class="field">
		<label for="class">Class</label>
		<select id="class" bind:value={charClass}>
			<option value="marine">Marine</option>
			<option value="android">Android</option>
			<option value="scientist">Scientist</option>
			<option value="teamster">Teamster</option>
		</select>
	</div>

	<fieldset>
		<legend>Stats (0–100)</legend>
		<div class="stat-grid">
			<div class="field">
				<label for="strength">STR</label>
				<input id="strength" type="number" bind:value={strength} min="0" max="100" />
			</div>
			<div class="field">
				<label for="speed">SPD</label>
				<input id="speed" type="number" bind:value={speed} min="0" max="100" />
			</div>
			<div class="field">
				<label for="intellect">INT</label>
				<input id="intellect" type="number" bind:value={intellect} min="0" max="100" />
			</div>
			<div class="field">
				<label for="combat">CMB</label>
				<input id="combat" type="number" bind:value={combat} min="0" max="100" />
			</div>
		</div>
	</fieldset>

	<fieldset>
		<legend>Saves (0–100)</legend>
		<div class="stat-grid">
			<div class="field">
				<label for="fear">Fear</label>
				<input id="fear" type="number" bind:value={fear} min="0" max="100" />
			</div>
			<div class="field">
				<label for="sanity">Sanity</label>
				<input id="sanity" type="number" bind:value={sanity} min="0" max="100" />
			</div>
			<div class="field">
				<label for="body">Body</label>
				<input id="body" type="number" bind:value={body} min="0" max="100" />
			</div>
			<div class="field">
				<label for="armor">Armor</label>
				<input id="armor" type="number" bind:value={armor} min="0" max="100" />
			</div>
		</div>
	</fieldset>

	<div class="field">
		<label for="max-hp">Max HP</label>
		<input id="max-hp" type="number" bind:value={maxHp} min="1" />
	</div>

	<div class="field">
		<label for="skills">Skills</label>
		<input id="skills" type="text" bind:value={skills} placeholder="Mechanical Repair, Zero-G, First Aid" />
		<span class="hint">Comma-separated</span>
	</div>

	{#if validationError}
		<div class="validation-error">{validationError}</div>
	{/if}

	<button onclick={save}>Save Character</button>
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	label {
		font-size: 0.75rem;
		color: #aaa;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.hint {
		font-size: 0.75rem;
		color: #666;
	}

	fieldset {
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.75rem;
	}

	legend {
		font-size: 0.875rem;
		color: #aaa;
		padding: 0 0.25rem;
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}

	.stat-grid input {
		width: 100%;
		box-sizing: border-box;
	}

	input, select {
		background: #16213e;
		color: #e0e0e0;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.5rem;
		font-size: 0.875rem;
	}

	input:focus, select:focus {
		outline: none;
		border-color: #c4a7e7;
	}

	.validation-error {
		color: #f77;
		font-size: 0.875rem;
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
		align-self: flex-start;
	}

	button:hover {
		background: #d4b7f7;
	}
</style>
