<script lang="ts">
  import ResourceBar from '../ResourceBar.svelte';

  import type { CharacterStatus } from './play-helpers';

  let {
    name,
    status,
    onviewsheet,
  }: {
    name: string;
    status: CharacterStatus;
    onviewsheet?: () => void;
  } = $props();
</script>

<div class="strip">
  <div class="name-row">
    <span class="name">{name}</span>
    <div class="name-row-end">
      {#if status.conditions}
        <span class="conditions">{status.conditions}</span>
      {/if}
      <button type="button" class="sheet-link" onclick={onviewsheet}>Sheet</button>
    </div>
  </div>
  <div class="bars">
    <ResourceBar label="HEALTH" current={status.hp.current} max={status.hp.max} color="hp" />
    <ResourceBar label="WOUNDS" current={status.wounds.current} max={status.wounds.max} color="hp" />
    <ResourceBar label="STRESS" current={status.stress.current} max={null} color="stress" />
  </div>
</div>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-bar-track);
    background: var(--color-bg);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .name-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
  }

  .name-row-end {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .sheet-link {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    background: transparent;
    color: var(--btn-ghost-text);
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .sheet-link:hover {
    color: var(--btn-ghost-text-active);
  }

  .name {
    font-family: var(--font-primary);
    font-size: var(--font-size-lg);
    color: var(--color-text-primary);
    letter-spacing: var(--tracking-base);
    text-transform: uppercase;
  }

  .conditions {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-text-tertiary);
    text-align: right;
    font-style: italic;
  }

  .bars {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-4);
  }
</style>
