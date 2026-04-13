<div class="section-label">
  {@render children()}
</div>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<style>
  .section-label {
    font-family: var(--font-primary);
    font-size: var(--label-size);
    color: var(--label-text);
    letter-spacing: var(--label-tracking);
    text-transform: uppercase;
  }
</style>
