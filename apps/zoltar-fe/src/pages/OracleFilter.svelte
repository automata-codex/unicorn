<script lang="ts">
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';
  import type { OracleCategory } from '../lib/data/oracle/types';
  import {
    activeCount,
    canBegin,
    createOracleFilterState,
    deselectAll,
    selectAll,
    toggleEntry,
  } from '../lib/oracle/state.svelte';

  let { categories }: { categories: OracleCategory[] } = $props();

  let filterState = $state(createOracleFilterState(categories));
  let expanded = $state<Record<string, boolean>>(
    Object.fromEntries(categories.map((c) => [c.id, true])),
  );
  let submitted = $state(false);

  let beginEnabled = $derived(canBegin(filterState));

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

  function handleBegin() {
    const selections: Record<string, string[]> = {};
    for (const cat of categories) {
      selections[cat.id] = [...(filterState.active[cat.id] ?? [])];
    }
    console.log('Oracle filter selections:', selections);
    submitted = true;
  }
</script>

<PageLayout>
  {#if submitted}
    <div class="confirmation">
      <h1 class="type-screen-label">ORACLE FILTER</h1>
      <p class="type-meta confirmation-text">SELECTIONS CONFIRMED — READY FOR SYNTHESIS</p>
    </div>
  {:else}
    <h1 class="type-screen-label page-title">ORACLE FILTER</h1>
    <p class="type-meta instruction">
      CONFIGURE ORACLE POOL — ONE ENTRY WILL BE DRAWN PER CATEGORY
    </p>

    <div class="category-grid">
      {#each categories as category (category.id)}
        {@const count = activeCount(filterState, category.id)}
        {@const total = category.entries.length}
        {@const isExpanded = expanded[category.id]}

        <Card>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
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
      <Button fullWidth disabled={!beginEnabled} onclick={handleBegin}>BEGIN</Button>
      {#if !beginEnabled}
        <p class="type-meta gate-caption">
          ALL CATEGORIES MUST HAVE ≥1 ACTIVE ENTRY
        </p>
      {/if}
    </div>
  {/if}
</PageLayout>

<style>
  .page-title {
    margin-bottom: var(--space-3);
  }

  .instruction {
    margin-bottom: var(--space-7);
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

  .count-ok {
    color: var(--color-success);
  }

  .count-empty {
    color: var(--color-danger);
  }

  .bulk-btn {
    all: unset;
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--btn-ghost-text);
    letter-spacing: var(--tracking-wide);
    cursor: pointer;
    text-transform: uppercase;
  }

  .bulk-btn:hover {
    color: var(--btn-ghost-text-active);
  }

  .chevron {
    font-size: var(--font-size-xs);
    color: var(--color-text-ghost);
    display: inline-block;
    transition: transform 0.15s ease;
  }

  .chevron-expanded {
    transform: rotate(90deg);
  }

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

  .entry-row:last-child {
    border-bottom: none;
  }

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

  .entry-active .toggle-indicator {
    color: var(--color-success);
  }

  .submit-area {
    margin-top: var(--space-5);
  }

  .gate-caption {
    text-align: center;
    margin-top: var(--space-3);
  }

  .confirmation {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding-top: var(--space-10);
  }

  .confirmation-text {
    color: var(--color-success);
  }
</style>
