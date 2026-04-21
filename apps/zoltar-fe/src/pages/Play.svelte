<script lang="ts">
  import PageLayout from '../lib/components/PageLayout.svelte';

  let { params }: { params: { campaignId: string; adventureId: string } } =
    $props();
  const campaignId = $derived(params.campaignId);
  const adventureId = $derived(params.adventureId);
</script>

<PageLayout>
  <h1>Play view — coming next part</h1>
  <p>Campaign: {campaignId}</p>
  <p>Adventure: {adventureId}</p>
</PageLayout>
