<script lang="ts">
  import { push } from 'svelte-spa-router';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';
  import { builtInOracleCategories } from '../lib/data/oracle';
  import {
    activeCount,
    canBegin,
    createOracleFilterState,
    deselectAll,
    selectAll,
    toggleEntry,
  } from '../lib/oracle/state.svelte';

  import type { OracleEntry } from '../lib/data/oracle/types';
  import type { CoherenceConflict } from '../lib/types';

  const categoryToSelectionKey: Record<string, string> = {
    survivors: 'survivor',
    threats: 'threat',
    secrets: 'secret',
    vessel_type: 'vessel_type',
    tone: 'tone',
  };

  let { params }: { params: { campaignId: string } } = $props();
  const campaignId = $derived(params.campaignId);
  const categories = builtInOracleCategories;

  // svelte-ignore state_referenced_locally
  let filterState = $state(createOracleFilterState(categories));
  // svelte-ignore state_referenced_locally
  let expanded = $state<Record<string, boolean>>(
    Object.fromEntries(categories.map((c) => [c.id, true])),
  );
  let submitting = $state(false);
  let error = $state('');
  let coherenceConflicts = $state<CoherenceConflict[]>([]);

  let beginEnabled = $derived(canBegin(filterState) && !submitting);

  function handleToggle(categoryId: string, entryId: string) {
    toggleEntry(filterState, categoryId, entryId);
  }

  function handleSelectAll(categoryId: string) {
    selectAll(filterState, categoryId, categories);
  }

  function handleDeselectAll(categoryId: string) {
    deselectAll(filterState, categoryId);
  }

  function handleToggleExpand(categoryId: string) {
    expanded[categoryId] = !expanded[categoryId];
  }

  function drawRandomSelections(): Record<string, OracleEntry> {
    const selections: Record<string, OracleEntry> = {};
    for (const cat of categories) {
      const activeIds = filterState.active[cat.id];
      if (!activeIds || activeIds.size === 0) continue;
      const pool = cat.entries.filter((e) => activeIds.has(e.id));
      const drawn = pool[Math.floor(Math.random() * pool.length)];
      const selectionKey = categoryToSelectionKey[cat.id] ?? cat.id;
      selections[selectionKey] = drawn;
    }
    return selections;
  }

  async function handleBegin() {
    submitting = true;
    error = '';
    coherenceConflicts = [];

    try {
      const oracleSelections = drawRandomSelections();

      const advRes = await api(`/api/v1/campaigns/${campaignId}/adventures`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!advRes.ok) {
        error = 'Failed to create adventure.';
        submitting = false;
        return;
      }
      const adventure = await advRes.json();
      const adventureId = adventure.id;

      const synthRes = await api(
        `/api/v1/campaigns/${campaignId}/adventures/${adventureId}/synthesize`,
        {
          method: 'POST',
          body: JSON.stringify({ oracleSelections }),
        },
      );

      if (synthRes.status === 202) {
        push(`/campaigns/${campaignId}/adventures/${adventureId}`);
        return;
      }

      if (synthRes.status === 409) {
        const body = await synthRes.json();
        if (body.error === 'coherence_conflict') {
          coherenceConflicts = body.conflicts ?? [];
          submitting = false;
          return;
        }
        error = body.message ?? 'Synthesis precondition failed.';
        submitting = false;
        return;
      }

      if (synthRes.status === 422) {
        const body = await synthRes.json();
        error = body.message ?? 'Oracle selections are invalid.';
        submitting = false;
        return;
      }

      error = `Unexpected response: ${synthRes.status}`;
    } catch {
      error = 'Network error. Please try again.';
    }
    submitting = false;
  }
</script>

<PageLayout>
  <div class="back-nav">
    <Button variant="ghost" onclick={() => push(`/campaigns/${campaignId}`)}>← CAMPAIGN</Button>
  </div>
  <h1 class="type-screen-label page-title">ORACLE FILTER</h1>
  <p class="type-meta instruction">
    CONFIGURE ORACLE POOL — ONE ENTRY WILL BE DRAWN PER CATEGORY
  </p>

  {#if coherenceConflicts.length > 0}
    <Card>
      <SectionLabel>CONFLICT</SectionLabel>
      <p class="type-meta conflict-intro">
        These selections conflict and couldn't be automatically resolved. Adjust your filters and try again.
      </p>
      {#each coherenceConflicts as conflict (conflict.category)}
        <div class="conflict-item">
          <span class="conflict-category">{conflict.category.toUpperCase()}</span>
          <p class="type-meta conflict-description">{conflict.description}</p>
        </div>
      {/each}
    </Card>
  {/if}

  {#if error}
    <p class="error-text">{error}</p>
  {/if}

  <div class="category-grid">
    {#each categories as category (category.id)}
      {@const count = activeCount(filterState, category.id)}
      {@const total = category.entries.length}
      {@const isExpanded = expanded[category.id]}

      <Card>
        <div
          class="category-header"
          role="button"
          tabindex="0"
          onclick={() => handleToggleExpand(category.id)}
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggleExpand(category.id); } }}
        >
          <div class="header-left">
            <SectionLabel>{category.label}</SectionLabel>
            <span
              class="count-indicator"
              class:count-ok={count > 0}
              class:count-empty={count === 0}
            >
              {count}/{total}
            </span>
          </div>
          <div class="header-right">
            <button
              class="bulk-btn"
              onclick={(e: MouseEvent) => { e.stopPropagation(); handleSelectAll(category.id); }}
            >
              ALL
            </button>
            <button
              class="bulk-btn"
              onclick={(e: MouseEvent) => { e.stopPropagation(); handleDeselectAll(category.id); }}
            >
              NONE
            </button>
            <span class="chevron" class:chevron-expanded={isExpanded}>▸</span>
          </div>
        </div>

        {#if isExpanded}
          <div class="entry-list">
            {#each category.entries as entry (entry.id)}
              {@const isActive = filterState.active[category.id]?.has(entry.id) ?? false}
              <button
                class="entry-row"
                class:entry-active={isActive}
                class:entry-inactive={!isActive}
                onclick={() => handleToggle(category.id, entry.id)}
              >
                <span class="entry-text">{entry.player_text}</span>
                <span class="toggle-indicator">{isActive ? '✓' : '○'}</span>
              </button>
            {/each}
          </div>
        {/if}
      </Card>
    {/each}
  </div>

  <div class="submit-area">
    <Button fullWidth disabled={!beginEnabled} onclick={handleBegin}>
      {submitting ? 'SYNTHESIZING...' : 'BEGIN'}
    </Button>
    {#if !canBegin(filterState)}
      <p class="type-meta gate-caption">
        ALL CATEGORIES MUST HAVE ≥1 ACTIVE ENTRY
      </p>
    {/if}
  </div>
</PageLayout>

<style>
  .back-nav {
    margin-bottom: var(--space-3);
  }

  .back-nav :global(.btn) {
    padding-left: 0;
  }

  .page-title {
    margin-bottom: var(--space-3);
  }

  .instruction {
    margin-bottom: var(--space-7);
  }

  .error-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-danger);
    margin-bottom: var(--space-5);
  }

  .conflict-intro {
    margin: var(--space-3) 0;
    color: var(--color-danger);
  }

  .conflict-item {
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .conflict-item:last-child {
    border-bottom: none;
  }

  .conflict-category {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    letter-spacing: var(--tracking-widest);
    color: var(--color-accent);
  }

  .conflict-description {
    margin-top: var(--space-2);
  }

  .category-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    margin-bottom: var(--space-7);
  }

  @media (min-width: 768px) {
    .category-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-5);
    }
  }

  .category-header {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    cursor: pointer;
    box-sizing: border-box;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .count-indicator {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    letter-spacing: var(--tracking-wide);
  }

  .count-ok { color: var(--color-success); }
  .count-empty { color: var(--color-danger); }

  .bulk-btn {
    all: unset;
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--btn-ghost-text);
    letter-spacing: var(--tracking-wide);
    cursor: pointer;
    text-transform: uppercase;
  }

  .bulk-btn:hover { color: var(--btn-ghost-text-active); }

  .chevron {
    font-size: var(--font-size-xs);
    color: var(--color-text-ghost);
    display: inline-block;
    transition: transform 0.15s ease;
  }

  .chevron-expanded { transform: rotate(90deg); }

  .entry-list {
    margin-top: var(--space-4);
    max-height: 168px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .entry-row {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-3) 0;
    cursor: pointer;
    border-bottom: 1px solid var(--color-border-subtle);
    box-sizing: border-box;
  }

  .entry-row:last-child { border-bottom: none; }

  .entry-active .entry-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    color: var(--color-text-primary);
  }

  .entry-inactive .entry-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    color: var(--color-text-ghost);
  }

  .toggle-indicator {
    font-family: var(--font-primary);
    font-size: var(--font-size-sm);
    color: var(--color-text-ghost);
  }

  .entry-active .toggle-indicator { color: var(--color-success); }

  .submit-area { margin-top: var(--space-5); }

  .gate-caption {
    text-align: center;
    margin-top: var(--space-3);
  }
</style>
