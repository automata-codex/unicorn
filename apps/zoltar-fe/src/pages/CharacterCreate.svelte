<script lang="ts">
  import PageLayout from '../lib/components/PageLayout.svelte';

  const { campaignId }: { campaignId: string } = $props();
</script>

<PageLayout>
  <h1 class="type-screen-label">CHARACTER CREATION</h1>
  <p class="type-meta">Placeholder — implementation in Phase 6</p>
  <p class="type-meta">Campaign: {campaignId}</p>
</PageLayout>
