<script lang="ts">
  import { onMount } from 'svelte';

  import { api } from '../lib/api';
  import { navigate } from '../lib/router.svelte';

  type Adventure = {
    id: string;
    campaignId: string;
    status: string;
    mode: string;
    callerId: string;
    createdAt: string;
    completedAt: string | null;
  };

  type Campaign = {
    id: string;
    name: string;
  };

  interface Props {
    campaignId: string;
  }

  let { campaignId }: Props = $props();

  let campaign = $state<Campaign | null>(null);
  let adventures = $state<Adventure[]>([]);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    const [campRes, advRes] = await Promise.all([
      api(`/api/v1/campaigns/${campaignId}`),
      api(`/api/v1/campaigns/${campaignId}/adventures`),
    ]);

    if (campRes.ok) {
      campaign = await campRes.json();
    } else if (campRes.status === 403) {
      error = 'You are not a member of this campaign.';
    } else {
      error = 'Campaign not found.';
    }

    if (advRes.ok) {
      adventures = await advRes.json();
    }

    loading = false;
  });

  const statusColors: Record<string, string> = {
    synthesizing: '#f59e0b',
    ready: '#10b981',
    completed: '#6b7280',
    failed: '#ef4444',
  };
</script>

<main>
	<a
		href="/campaigns"
		onclick={(e) => {
			e.preventDefault();
			navigate('/campaigns');
		}}>&larr; Campaigns</a
	>

	{#if loading}
		<p>Loading...</p>
	{:else if error}
		<p style="color: red">{error}</p>
	{:else if campaign}
		<h1>{campaign.name}</h1>

		<h2>Adventures</h2>

		{#if adventures.length === 0}
			<p>No adventures yet.</p>
		{:else}
			<ul>
				{#each adventures as adventure (adventure.id)}
					<li>
						<span
							style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; color: white; background: {statusColors[
								adventure.status
							] ?? '#6b7280'}"
						>
							{adventure.status}
						</span>
						{adventure.id.slice(0, 8)}...
						<small>{new Date(adventure.createdAt).toLocaleDateString()}</small>
					</li>
				{/each}
			</ul>
		{/if}

		<button disabled title="Oracle table selection coming soon"> New Adventure </button>
	{/if}
</main>
