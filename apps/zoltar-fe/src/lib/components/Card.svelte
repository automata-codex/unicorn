<div class="card" class:no-padding={!padding}>
  {@render children()}
</div>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    padding = true,
    children,
  }: {
    padding?: boolean;
    children: Snippet;
  } = $props();
</script>

<style>
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--card-padding);
  }

  .card.no-padding {
    padding: 0;
  }
</style>
