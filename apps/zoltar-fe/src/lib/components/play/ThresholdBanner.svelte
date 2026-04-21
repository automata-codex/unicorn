<script lang="ts">
  import { formatThresholdLine, type ThresholdCrossing } from './play-helpers';

  let { thresholds }: { thresholds: ThresholdCrossing[] } = $props();
</script>

{#if thresholds.length > 0}
  <div class="banner" role="status">
    {#each thresholds as t (t.pool + '-' + t.effect)}
      <p class="line">{formatThresholdLine(t)}</p>
    {/each}
  </div>
{/if}

<style>
  .banner {
    background: var(--color-accent-bg-subtle);
    border: 1px solid var(--color-accent-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .line {
    margin: 0;
    font-family: var(--font-primary);
    font-size: var(--font-size-sm);
    color: var(--color-accent);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .line + .line {
    margin-top: var(--space-2);
  }
</style>
