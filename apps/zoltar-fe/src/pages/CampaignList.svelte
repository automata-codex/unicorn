<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../lib/api';
	import { navigate } from '../lib/router.svelte';

	type Campaign = {
		id: string;
		name: string;
		visibility: string;
		diceMode: string;
		createdAt: string;
	};

	let campaigns = $state<Campaign[]>([]);
	let loading = $state(true);
	let showForm = $state(false);
	let newName = $state('');
	let creating = $state(false);

	onMount(async () => {
		const res = await api('/api/v1/campaigns');
		if (res.ok) {
			campaigns = await res.json();
		}
		loading = false;
	});

	async function handleCreate(e: Event) {
		e.preventDefault();
		creating = true;

		const res = await api('/api/v1/campaigns', {
			method: 'POST',
			body: JSON.stringify({ name: newName }),
		});

		if (res.ok) {
			const campaign = await res.json();
			navigate(`/campaigns/${campaign.id}`);
		}

		creating = false;
	}
</script>

<main>
	<h1>Campaigns</h1>

	{#if loading}
		<p>Loading...</p>
	{:else}
		{#if campaigns.length === 0}
			<p>No campaigns yet.</p>
		{:else}
			<ul>
				{#each campaigns as campaign (campaign.id)}
					<li>
						<a
							href="/campaigns/{campaign.id}"
							onclick={(e) => {
								e.preventDefault();
								navigate(`/campaigns/${campaign.id}`);
							}}
						>
							{campaign.name}
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		{#if showForm}
			<form onsubmit={handleCreate}>
				<label>
					Campaign name
					<input type="text" bind:value={newName} required maxlength="120" />
				</label>
				<button type="submit" disabled={creating}>
					{creating ? 'Creating...' : 'Create'}
				</button>
				<button
					type="button"
					onclick={() => {
						showForm = false;
					}}>Cancel</button
				>
			</form>
		{:else}
			<button
				onclick={() => {
					showForm = true;
				}}>New Campaign</button
			>
		{/if}
	{/if}
</main>
