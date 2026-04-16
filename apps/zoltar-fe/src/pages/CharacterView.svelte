<script lang="ts">
  import { onMount } from 'svelte';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';
  import { navigate } from '../lib/router.svelte';

  import type { CharacterSheet } from '../lib/types';

  const { campaignId }: { campaignId: string } = $props();

  let character = $state<CharacterSheet | null>(null);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    const res = await api(`/api/v1/campaigns/${campaignId}/characters`);
    if (res.ok) {
      character = await res.json();
    } else if (res.status === 404) {
      error = 'No character found.';
    } else {
      error = 'Something went wrong.';
    }
    loading = false;
  });
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
</style>
