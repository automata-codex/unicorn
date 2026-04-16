<script lang="ts">
  import { onMount } from 'svelte';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';
  import { navigate } from '../lib/router.svelte';

  import type { Adventure, Campaign, CharacterSheet } from '../lib/types';

  interface Props {
    campaignId: string;
  }

  let { campaignId }: Props = $props();

  let campaign = $state<Campaign | null>(null);
  let adventures = $state<Adventure[]>([]);
  let character = $state<CharacterSheet | null>(null);
  let loading = $state(true);
  let error = $state('');
  let showCompleted = $state(false);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let editingName = $state(false);
  let nameInput = $state('');

  const activeStatuses = ['synthesizing', 'ready', 'in_progress'];

  let activeAdventures = $derived(
    adventures.filter((a) => !['completed'].includes(a.status)),
  );
  let completedAdventures = $derived(
    adventures.filter((a) => a.status === 'completed'),
  );
  let visibleAdventures = $derived(
    showCompleted ? adventures : activeAdventures,
  );

  let hasActiveAdventure = $derived(
    adventures.some((a) => activeStatuses.includes(a.status)),
  );

  let newAdventureDisabledReason = $derived.by(() => {
    if (!character) return 'ASSIGN CREW FIRST';
    if (hasActiveAdventure) return 'ADVENTURE IN PROGRESS';
    return null;
  });

  onMount(async () => {
    const [campRes, advRes, charRes] = await Promise.all([
      api(`/api/v1/campaigns/${campaignId}`),
      api(`/api/v1/campaigns/${campaignId}/adventures`),
      api(`/api/v1/campaigns/${campaignId}/characters`),
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

    if (charRes.ok) {
      character = await charRes.json();
    }

    loading = false;
  });

  function startEditingName() {
    nameInput = campaign?.name ?? '';
    editingName = true;
  }

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === campaign?.name) {
      editingName = false;
      return;
    }

    const res = await api(`/api/v1/campaigns/${campaignId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: trimmed }),
    });

    if (res.ok && campaign) {
      const updated = await res.json();
      campaign = { ...campaign, name: updated.name };
    }
    editingName = false;
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveName();
    } else if (e.key === 'Escape') {
      editingName = false;
    }
  }

  async function handleDeleteCampaign() {
    deleting = true;
    const res = await api(`/api/v1/campaigns/${campaignId}`, {
      method: 'DELETE',
    });

    if (res.ok || res.status === 204) {
      navigate('/campaigns');
    } else if (res.status === 409) {
      error = 'Cannot delete while an adventure is active.';
      confirmingDelete = false;
    } else {
      error = 'Something went wrong.';
      confirmingDelete = false;
    }
    deleting = false;
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'synthesizing':
      case 'ready':
        return 'var(--color-success)';
      case 'in_progress':
        return 'var(--color-success)';
      case 'failed':
        return 'var(--color-danger)';
      case 'completed':
      default:
        return 'var(--color-text-ghost)';
    }
  }

  function statusLabel(status: string): string {
    return status.toUpperCase().replace('_', ' ');
  }
</script>

<PageLayout>
  {#if loading}
    <p class="type-meta">LOADING...</p>
  {:else if error}
    <p class="error-text">{error}</p>
  {:else if campaign}
    <div class="header">
      <Button variant="ghost" onclick={() => navigate('/campaigns')}>← CAMPAIGNS</Button>
      {#if editingName}
        <div class="name-edit-row">
          <input
            class="type-campaign-name name-input"
            bind:value={nameInput}
            onkeydown={handleNameKeydown}
            autofocus
          />
          <Button variant="ghost" onclick={saveName}>SAVE</Button>
          <Button variant="ghost" onclick={() => { editingName = false; }}>CANCEL</Button>
        </div>
      {:else}
        <div class="name-display-row">
          <h1 class="type-campaign-name">{campaign.name}</h1>
          <Button variant="ghost" onclick={startEditingName}>RENAME</Button>
        </div>
      {/if}
    </div>

    <!-- Character section -->
    <Card>
      <SectionLabel>CHARACTER</SectionLabel>

      {#if character}
        <button class="character-link" onclick={() => navigate(`/campaigns/${campaignId}/characters`)}>
          <div class="character-info">
            <span class="type-screen-title">{character.data.name}</span>
            <span class="type-label character-meta">{character.data.class}</span>
            <div class="stat-row">
              {#each Object.entries(character.data.stats) as [label, value] (label)}
                <div class="stat-item">
                  <span class="type-stat-value">{value}</span>
                  <span class="type-label">{label.toUpperCase()}</span>
                </div>
              {/each}
            </div>
          </div>
        </button>
      {:else}
        <p class="type-meta empty-character">NO CREW ASSIGNED</p>
        <Button onclick={() => navigate(`/campaigns/${campaignId}/characters/new`)}>
          CREATE CHARACTER
        </Button>
      {/if}
    </Card>

    <!-- Adventures section -->
    <Card>
      <SectionLabel>ADVENTURES</SectionLabel>

      <div class="new-adventure">
        <Button
          fullWidth
          disabled={newAdventureDisabledReason != null}
          onclick={() => navigate(`/campaigns/${campaignId}/oracle`)}
        >
          NEW ADVENTURE
        </Button>
        {#if newAdventureDisabledReason}
          <p class="type-meta disabled-caption">{newAdventureDisabledReason}</p>
        {/if}
      </div>

      {#if visibleAdventures.length > 0}
        <div class="adventure-list">
          {#each visibleAdventures as adventure (adventure.id)}
            <button
              class="adventure-row"
              class:adventure-row-clickable={activeStatuses.includes(adventure.status)}
              onclick={() => {
                if (activeStatuses.includes(adventure.status)) {
                  navigate(`/campaigns/${campaignId}/adventures/${adventure.id}`);
                }
              }}
            >
              <span class="status-badge" style="color: {statusColor(adventure.status)}">
                ● {statusLabel(adventure.status)}
              </span>
              <span class="type-meta">{new Date(adventure.createdAt).toLocaleDateString()}</span>
            </button>
          {/each}
        </div>
      {:else if adventures.length === 0}
        <p class="type-meta empty-adventures">NO ADVENTURES YET</p>
      {/if}

      {#if completedAdventures.length > 0}
        <Button
          variant="ghost"
          onclick={() => { showCompleted = !showCompleted; }}
        >
          {showCompleted ? 'HIDE COMPLETED' : `SHOW COMPLETED (${completedAdventures.length})`}
        </Button>
      {/if}
    </Card>

    <!-- Danger zone -->
    <div class="danger-zone">
      {#if confirmingDelete}
        <p class="type-meta delete-warning">THIS WILL DELETE THE CAMPAIGN AND ALL ITS DATA</p>
        <div class="delete-confirm-buttons">
          <Button fullWidth variant="ghost" onclick={() => { confirmingDelete = false; }}>
            CANCEL
          </Button>
          <Button fullWidth disabled={deleting} onclick={handleDeleteCampaign}>
            {deleting ? 'DELETING...' : 'CONFIRM DELETE'}
          </Button>
        </div>
      {:else}
        <Button
          fullWidth
          variant="ghost"
          disabled={hasActiveAdventure}
          onclick={() => { confirmingDelete = true; }}
        >
          DELETE CAMPAIGN
        </Button>
        {#if hasActiveAdventure}
          <p class="type-meta disabled-caption">ADVENTURE IN PROGRESS</p>
        {/if}
      {/if}
    </div>
  {/if}
</PageLayout>

<style>
  .header {
    margin-bottom: var(--space-7);
  }

  .header :global(.btn) {
    margin-bottom: var(--space-4);
    padding-left: 0;
  }

  .name-display-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
  }

  .name-edit-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
  }

  .name-input {
    all: unset;
    flex: 1;
    font-family: var(--font-primary);
    font-size: var(--font-size-2xl);
    color: var(--color-text-primary);
    letter-spacing: var(--tracking-tight);
    border-bottom: 1px solid var(--color-accent);
    box-sizing: border-box;
  }

  .error-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-danger);
  }

  :global(.card) + :global(.card) {
    margin-top: var(--space-5);
  }

  .character-link {
    all: unset;
    display: block;
    width: 100%;
    cursor: pointer;
    box-sizing: border-box;
  }

  .character-info {
    margin-top: var(--space-4);
  }

  .character-meta {
    display: block;
    margin-top: var(--space-2);
    color: var(--color-text-tertiary);
  }

  .stat-row {
    display: flex;
    gap: var(--space-5);
    margin-top: var(--space-4);
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .empty-character {
    margin: var(--space-4) 0;
  }

  .new-adventure {
    margin: var(--space-5) 0;
  }

  .disabled-caption {
    margin-top: var(--space-2);
    text-align: center;
  }

  .adventure-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }

  .adventure-row {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border-subtle);
    box-sizing: border-box;
  }

  .adventure-row-clickable {
    cursor: pointer;
  }

  .adventure-row-clickable:hover .status-badge {
    text-decoration: underline;
  }

  .status-badge {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .empty-adventures {
    margin: var(--space-4) 0;
  }

  .danger-zone {
    margin-top: var(--space-9);
    margin-bottom: var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .delete-warning {
    text-align: center;
    color: var(--color-danger);
  }

  .delete-confirm-buttons {
    display: flex;
    gap: var(--space-3);
  }
</style>
