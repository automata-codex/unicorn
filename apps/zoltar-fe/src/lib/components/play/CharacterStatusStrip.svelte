<script lang="ts">
  import ResourceBar from '../ResourceBar.svelte';

  import type { CharacterStatus } from './play-helpers';

  let {
    name,
    status,
  }: {
    name: string;
    status: CharacterStatus;
  } = $props();
</script>

<div class="strip">
  <div class="name-row">
    <span class="name">{name}</span>
    {#if status.conditions}
      <span class="conditions">{status.conditions}</span>
    {/if}
  </div>
  <div class="bars">
    <ResourceBar label="HP" current={status.hp.current} max={status.hp.max} color="hp" />
    <ResourceBar label="STRESS" current={status.stress.current} max={status.stress.max} color="stress" />
  </div>
</div>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-bar-track);
  }

  .name-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-4);
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
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }
</style>
