<script lang="ts">
  import { push } from 'svelte-spa-router';

  import Button from '../lib/components/Button.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
</script>

<PageLayout>
  <div class="not-found">
    <h1 class="type-screen-title">NOT FOUND</h1>
    <p class="type-meta">THAT PATH DOES NOT EXIST</p>
    <Button onclick={() => push('/')}>HOME</Button>
  </div>
</PageLayout>

<style>
  .not-found {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-9) var(--space-5);
    text-align: center;
  }
</style>
