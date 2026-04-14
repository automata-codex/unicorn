<script lang="ts">
  import { onMount } from 'svelte';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import Input from '../lib/components/Input.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import { navigate } from '../lib/router.svelte';

  import type { Campaign } from '../lib/types';

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

<PageLayout>
  <h1 class="type-screen-label page-title">CAMPAIGNS</h1>

  {#if loading}
    <p class="type-meta">LOADING...</p>
  {:else}
    {#if campaigns.length === 0}
      <p class="type-meta empty-state">NO CAMPAIGNS — CREATE ONE BELOW</p>
    {:else}
      <div class="campaign-grid">
        {#each campaigns as campaign (campaign.id)}
          <button
            class="campaign-card-button"
            onclick={() => navigate(`/campaigns/${campaign.id}`)}
          >
            <Card>
              <span class="type-campaign-name">{campaign.name}</span>
            </Card>
          </button>
        {/each}
      </div>
    {/if}

    <div class="new-campaign">
      {#if showForm}
        <form onsubmit={handleCreate}>
          <div class="form-field">
            <Input
              label="NAME"
              value={newName}
              oninput={(e) => { newName = (e.target as HTMLInputElement).value; }}
            />
          </div>
          <div class="form-actions">
            <Button type="submit" disabled={creating}>
              {creating ? 'CREATING...' : 'CREATE'}
            </Button>
            <Button variant="ghost" onclick={() => { showForm = false; }}>CANCEL</Button>
          </div>
        </form>
      {:else}
        <Button variant="ghost" onclick={() => { showForm = true; }}>+ NEW CAMPAIGN</Button>
      {/if}
    </div>
  {/if}
</PageLayout>

<style>
  .page-title {
    margin-bottom: var(--space-7);
  }

  .empty-state {
    text-align: center;
    margin-bottom: var(--space-7);
  }

  .campaign-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-bottom: var(--space-7);
  }

  @media (min-width: 768px) {
    .campaign-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-5);
    }
  }

  .campaign-card-button {
    all: unset;
    cursor: pointer;
    display: block;
    width: 100%;
    box-sizing: border-box;
  }

  .campaign-card-button :global(.card) {
    border-color: var(--color-border);
    transition: border-color 0.15s ease;
  }

  .campaign-card-button:hover :global(.card) {
    border-color: var(--color-accent-border);
  }

  .new-campaign {
    margin-top: var(--space-5);
  }

  .form-field {
    margin-bottom: var(--space-5);
  }

  .form-actions {
    display: flex;
    gap: var(--space-4);
  }
</style>
