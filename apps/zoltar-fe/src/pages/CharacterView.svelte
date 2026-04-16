<script lang="ts">
  import { onMount } from 'svelte';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';
  import { navigate } from '../lib/router.svelte';

  import type { Adventure, CharacterSheet } from '../lib/types';

  const { campaignId }: { campaignId: string } = $props();

  let character = $state<CharacterSheet | null>(null);
  let loading = $state(true);
  let error = $state('');
  let confirmingDelete = $state(false);
  let deleting = $state(false);

  const activeStatuses = ['synthesizing', 'ready', 'in_progress'];
  let hasActiveAdventure = $state(false);

  onMount(async () => {
    const [charRes, advRes] = await Promise.all([
      api(`/api/v1/campaigns/${campaignId}/characters`),
      api(`/api/v1/campaigns/${campaignId}/adventures`),
    ]);

    if (charRes.ok) {
      character = await charRes.json();
    } else if (charRes.status === 404) {
      error = 'No character found.';
    } else {
      error = 'Something went wrong.';
    }

    if (advRes.ok) {
      const adventures: Adventure[] = await advRes.json();
      hasActiveAdventure = adventures.some((a) => activeStatuses.includes(a.status));
    }

    loading = false;
  });

  async function handleDelete() {
    deleting = true;
    const res = await api(`/api/v1/campaigns/${campaignId}/characters`, {
      method: 'DELETE',
    });

    if (res.ok || res.status === 204) {
      navigate(`/campaigns/${campaignId}`);
    } else if (res.status === 409) {
      error = 'Cannot delete while an adventure is active.';
      confirmingDelete = false;
    } else {
      error = 'Something went wrong.';
      confirmingDelete = false;
    }
    deleting = false;
  }
</script>

<PageLayout>
  <div class="header">
    <Button variant="ghost" onclick={() => navigate(`/campaigns/${campaignId}`)}>← CAMPAIGN</Button>
  </div>

  {#if loading}
    <p class="type-meta">LOADING...</p>
  {:else if error}
    <p class="error-text">{error}</p>
  {:else if character}
    <h1 class="type-campaign-name character-name">{character.data.name}</h1>

    <!-- Identity -->
    <Card>
      <SectionLabel>IDENTITY</SectionLabel>
      <div class="section-content">
        <div class="detail-row">
          <span class="type-label">CLASS</span>
          <span class="type-body">{character.data.class}</span>
        </div>
        {#if character.data.pronouns}
          <div class="detail-row">
            <span class="type-label">PRONOUNS</span>
            <span class="type-body">{character.data.pronouns}</span>
          </div>
        {/if}
        <div class="detail-row">
          <span class="type-label">ENTITY ID</span>
          <span class="detail-value-ghost">{character.data.entityId}</span>
        </div>
      </div>
    </Card>

    <!-- Stats -->
    <Card>
      <SectionLabel>STATS</SectionLabel>
      <div class="section-content">
        <div class="stat-grid">
          {#each Object.entries(character.data.stats) as [label, value] (label)}
            <div class="stat-item">
              <span class="type-stat-value">{value}</span>
              <span class="type-label">{label.toUpperCase()}</span>
            </div>
          {/each}
        </div>
      </div>
    </Card>

    <!-- Saves -->
    <Card>
      <SectionLabel>SAVES</SectionLabel>
      <div class="section-content">
        <div class="stat-grid">
          {#each Object.entries(character.data.saves) as [label, value] (label)}
            <div class="stat-item">
              <span class="type-stat-value">{value}</span>
              <span class="type-label">{label.toUpperCase()}</span>
            </div>
          {/each}
        </div>
      </div>
    </Card>

    <!-- HP & Stress -->
    <Card>
      <SectionLabel>HP &amp; STRESS</SectionLabel>
      <div class="section-content">
        <div class="stat-grid">
          <div class="stat-item">
            <span class="type-stat-value">{character.data.maxHp}</span>
            <span class="type-label">MAX HP</span>
          </div>
          <div class="stat-item">
            <span class="type-stat-value">{character.data.maxStress}</span>
            <span class="type-label">MAX STRESS</span>
          </div>
        </div>
      </div>
    </Card>

    <!-- Skills -->
    {#if character.data.skills.length > 0}
      <Card>
        <SectionLabel>SKILLS</SectionLabel>
        <div class="section-content">
          <ul class="item-list">
            {#each character.data.skills as skill}
              <li class="type-body">{skill}</li>
            {/each}
          </ul>
        </div>
      </Card>
    {/if}

    <!-- Equipment -->
    {#if character.data.equipment.length > 0}
      <Card>
        <SectionLabel>LOADOUT</SectionLabel>
        <div class="section-content">
          <ul class="item-list">
            {#each character.data.equipment as item}
              <li class="type-body">{item}</li>
            {/each}
          </ul>
        </div>
      </Card>
    {/if}

    <!-- Notes -->
    {#if character.data.notes}
      <Card>
        <SectionLabel>NOTES</SectionLabel>
        <div class="section-content">
          <p class="type-body">{character.data.notes}</p>
        </div>
      </Card>
    {/if}

    <!-- Actions -->
    <div class="actions">
      <Button
        fullWidth
        disabled={hasActiveAdventure}
        onclick={() => navigate(`/campaigns/${campaignId}/characters/edit`)}
      >
        EDIT CHARACTER
      </Button>

      {#if confirmingDelete}
        <div class="delete-confirm">
          <p class="type-meta delete-warning">THIS CANNOT BE UNDONE</p>
          <div class="delete-confirm-buttons">
            <Button fullWidth variant="ghost" onclick={() => { confirmingDelete = false; }}>
              CANCEL
            </Button>
            <Button fullWidth disabled={deleting} onclick={handleDelete}>
              {deleting ? 'DELETING...' : 'CONFIRM DELETE'}
            </Button>
          </div>
        </div>
      {:else}
        <Button
          fullWidth
          variant="ghost"
          disabled={hasActiveAdventure}
          onclick={() => { confirmingDelete = true; }}
        >
          DELETE CHARACTER
        </Button>
      {/if}

      {#if hasActiveAdventure}
        <p class="type-meta disabled-caption">ADVENTURE IN PROGRESS</p>
      {/if}
    </div>
  {/if}
</PageLayout>

<style>
  .header {
    margin-bottom: var(--space-4);
  }

  .header :global(.btn) {
    padding-left: 0;
  }

  .character-name {
    margin-bottom: var(--space-7);
  }

  .error-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-danger);
  }

  :global(.card) + :global(.card) {
    margin-top: var(--space-5);
  }

  .section-content {
    margin-top: var(--space-5);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: var(--space-2) 0;
  }

  .detail-value-ghost {
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    color: var(--color-text-ghost);
  }

  .stat-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .item-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .item-list li::before {
    content: "— ";
    color: var(--color-text-tertiary);
  }

  .actions {
    margin-top: var(--space-7);
    margin-bottom: var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .delete-confirm {
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

  .disabled-caption {
    text-align: center;
  }
</style>
