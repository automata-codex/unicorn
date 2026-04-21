<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';

  import type { Adventure } from '../lib/types';

  let { params }: { params: { campaignId: string; adventureId: string } } =
    $props();
  const campaignId = $derived(params.campaignId);
  const adventureId = $derived(params.adventureId);

  let adventure = $state<Adventure | null>(null);
  let loading = $state(true);
  let error = $state('');
  let timedOut = $state(false);

  const POLL_INTERVAL_MS = 2000;
  const POLL_TIMEOUT_MS = 60000;

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  async function fetchAdventure(): Promise<Adventure | null> {
    const res = await api(
      `/api/v1/campaigns/${campaignId}/adventures/${adventureId}`,
    );
    if (!res.ok) return null;
    return res.json();
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    pollTimer = null;
    timeoutTimer = null;
  }

  function startPolling() {
    timedOut = false;

    pollTimer = setInterval(async () => {
      const adv = await fetchAdventure();
      if (!adv) return;
      adventure = adv;
      if (adv.status !== 'synthesizing') {
        stopPolling();
      }
    }, POLL_INTERVAL_MS);

    timeoutTimer = setTimeout(() => {
      stopPolling();
      timedOut = true;
    }, POLL_TIMEOUT_MS);
  }

  onMount(() => {
    fetchAdventure().then((adv) => {
      if (!adv) {
        error = 'Adventure not found.';
        loading = false;
        return;
      }
      adventure = adv;
      loading = false;

      if (adv.status === 'synthesizing') {
        startPolling();
      }
    });

    return () => stopPolling();
  });

  async function handleRetry() {
    error = '';
    loading = true;

    const synthRes = await api(
      `/api/v1/campaigns/${campaignId}/adventures/${adventureId}/synthesize`,
      { method: 'POST', body: JSON.stringify({ oracleSelections: {} }) },
    );

    if (synthRes.status === 202) {
      adventure = { ...adventure!, status: 'synthesizing' };
      loading = false;
      startPolling();
    } else {
      error = 'Retry failed. Please go back and try again.';
      loading = false;
    }
  }
</script>

<PageLayout>
  <div class="back-nav">
    <Button variant="ghost" onclick={() => push(`/campaigns/${campaignId}`)}>← CAMPAIGN</Button>
  </div>

  {#if loading}
    <div class="status-screen">
      <p class="type-meta status-text">LOADING...</p>
    </div>
  {:else if error}
    <div class="status-screen">
      <p class="error-text">{error}</p>
      <Button variant="ghost" onclick={() => push(`/campaigns/${campaignId}`)}>BACK TO CAMPAIGN</Button>
    </div>
  {:else if adventure?.status === 'synthesizing'}
    <div class="status-screen">
      <h1 class="type-screen-label">SYNTHESIS</h1>
      {#if timedOut}
        <p class="type-meta timeout-text">
          Synthesis is taking longer than expected. You can continue waiting or try again later.
        </p>
        <Button variant="ghost" onclick={() => { startPolling(); }}>KEEP WAITING</Button>
      {:else}
        <p class="type-meta status-text">SYNTHESIZING ADVENTURE...</p>
        <div class="pulse-indicator"></div>
      {/if}
    </div>
  {:else if adventure?.status === 'failed'}
    <div class="status-screen">
      <h1 class="type-screen-label">SYNTHESIS FAILED</h1>
      <p class="type-meta error-detail">
        Something went wrong during synthesis. You can retry or go back and start over.
      </p>
      <div class="action-row">
        <Button onclick={handleRetry}>RETRY</Button>
        <Button variant="ghost" onclick={() => push(`/campaigns/${campaignId}/oracle`)}>NEW SELECTIONS</Button>
      </div>
    </div>
  {:else if adventure?.status === 'ready'}
    <div class="review-screen">
      <h1 class="type-screen-label">ADVENTURE READY</h1>

      {#if adventure.openingNarration}
        <Card>
          <SectionLabel>OPENING</SectionLabel>
          <p class="narration-text">{adventure.openingNarration}</p>
        </Card>
      {/if}

      <div class="begin-area">
        <Button
          fullWidth
          onclick={() =>
            push(`/campaigns/${campaignId}/adventures/${adventureId}/play`)}
        >
          BEGIN ADVENTURE
        </Button>
      </div>
    </div>
  {/if}
</PageLayout>

<style>
  .back-nav {
    margin-bottom: var(--space-3);
  }

  .back-nav :global(.btn) {
    padding-left: 0;
  }

  .status-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding-top: var(--space-10);
  }

  .status-text {
    color: var(--color-text-ghost);
    letter-spacing: var(--tracking-widest);
  }

  .timeout-text {
    color: var(--color-text-secondary);
    text-align: center;
    max-width: 320px;
  }

  .error-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-danger);
  }

  .error-detail {
    color: var(--color-text-secondary);
    text-align: center;
    max-width: 320px;
  }

  .action-row {
    display: flex;
    gap: var(--space-4);
  }

  .pulse-indicator {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-pill);
    background: var(--color-accent);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .review-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .narration-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    color: var(--color-text-primary);
    line-height: 1.6;
    margin-top: var(--space-3);
    white-space: pre-wrap;
  }

  .begin-area {
    margin-top: var(--space-5);
  }
</style>
