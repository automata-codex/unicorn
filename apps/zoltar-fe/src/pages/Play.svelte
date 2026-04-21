<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';

  import { api } from '../lib/api';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import CharacterStatusStrip from '../lib/components/play/CharacterStatusStrip.svelte';
  import MessageInput from '../lib/components/play/MessageInput.svelte';
  import MessageLog from '../lib/components/play/MessageLog.svelte';
  import {
    applyStatusDelta,
    type CampaignStateData,
    type CharacterStatus,
    classifySendError,
    deriveCharacterStatus,
    type ThresholdCrossing,
  } from '../lib/components/play/play-helpers';
  import ThresholdBanner from '../lib/components/play/ThresholdBanner.svelte';

  import type { Adventure, CharacterSheet } from '../lib/types';

  interface LogMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

  let { params }: { params: { campaignId: string; adventureId: string } } =
    $props();
  const campaignId = $derived(params.campaignId);
  const adventureId = $derived(params.adventureId);

  let loading = $state(true);
  let error = $state('');
  let messages = $state<LogMessage[]>([]);
  let status = $state<CharacterStatus | null>(null);
  let characterName = $state('');
  let playerEntityId = $state('');
  let thresholds = $state<ThresholdCrossing[]>([]);
  let sending = $state(false);
  let retryAvailable = $state(false);

  onMount(async () => {
    try {
      const [advRes, charRes, msgRes, stateRes] = await Promise.all([
        api(`/api/v1/campaigns/${campaignId}/adventures/${adventureId}`),
        api(`/api/v1/campaigns/${campaignId}/characters`),
        api(
          `/api/v1/campaigns/${campaignId}/adventures/${adventureId}/messages`,
        ),
        api(`/api/v1/campaigns/${campaignId}/state`),
      ]);

      if (!advRes.ok || !charRes.ok || !msgRes.ok || !stateRes.ok) {
        error = 'Failed to load adventure.';
        loading = false;
        return;
      }

      const adventure: Adventure = await advRes.json();
      const character: CharacterSheet = await charRes.json();
      const messagesBody: { messages: LogMessage[] } = await msgRes.json();
      const stateBody: { data: CampaignStateData } = await stateRes.json();

      if (adventure.status !== 'ready' && adventure.status !== 'in_progress') {
        error = `Adventure is ${adventure.status}, not ready for play.`;
        loading = false;
        setTimeout(() => push(`/campaigns/${campaignId}`), 1500);
        return;
      }

      playerEntityId = character.data.entityId;
      characterName = character.data.name;
      status = deriveCharacterStatus({
        state: stateBody.data,
        playerEntityId: character.data.entityId,
        fallbackMaxHp: character.data.maxHp,
        fallbackMaxStress: character.data.maxStress,
      });

      if (messagesBody.messages.length === 0 && adventure.openingNarration) {
        messages = [
          {
            id: 'opening',
            role: 'assistant',
            content: adventure.openingNarration,
          },
        ];
      } else {
        messages = messagesBody.messages;
      }
    } catch {
      error = 'Failed to load adventure.';
    } finally {
      loading = false;
    }
  });

  async function handleSend(content: string) {
    if (sending) return;
    sending = true;
    retryAvailable = false;

    const optimisticId = `local-${Date.now()}`;
    messages = [...messages, { id: optimisticId, role: 'user', content }];

    try {
      const res = await api(
        `/api/v1/campaigns/${campaignId}/adventures/${adventureId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content }),
        },
      );

      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      const errCode = classifySendError({
        status: res.status,
        body: body as { error?: string } | null,
      });
      if (errCode === null) {
        const ok = body as {
          message: { id: string; role: 'assistant'; content: string };
          applied: {
            resourcePools?: Record<
              string,
              { current: number; max: number | null }
            >;
            entities?: Record<
              string,
              { visible: boolean; status: string; npcState?: string }
            >;
          };
          thresholds: ThresholdCrossing[];
        };
        messages = [
          ...messages,
          {
            id: ok.message.id,
            role: ok.message.role,
            content: ok.message.content,
          },
        ];
        if (status) {
          status = applyStatusDelta({
            previous: status,
            playerEntityId,
            applied: ok.applied,
          });
        }
        thresholds = ok.thresholds ?? [];
      } else if (errCode === 'precondition') {
        error = 'This adventure is no longer playable.';
        setTimeout(() => push(`/campaigns/${campaignId}`), 1500);
      } else {
        error =
          errCode === 'gm_correction_failed'
            ? 'GM re-narration was rejected. Try sending your action again.'
            : 'GM service is unavailable. Try again in a moment.';
        retryAvailable = true;
      }
    } catch {
      error = 'Network error. Try again.';
      retryAvailable = true;
    } finally {
      sending = false;
    }
  }

  function clearError() {
    error = '';
    retryAvailable = false;
  }
</script>

<PageLayout>
  {#if loading}
    <p class="type-meta">LOADING...</p>
  {:else if error && !retryAvailable}
    <p class="error-text">{error}</p>
  {:else}
    {#if status}
      <CharacterStatusStrip name={characterName} {status} />
    {/if}
    <ThresholdBanner {thresholds} />
    <MessageLog {messages} typing={sending} />
    {#if error && retryAvailable}
      <div class="retry-row">
        <p class="error-text">{error}</p>
        <button type="button" class="retry" onclick={clearError}>DISMISS</button>
      </div>
    {/if}
    <MessageInput disabled={sending} onsend={handleSend} />
  {/if}
</PageLayout>

<style>
  .error-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-sm);
    color: var(--color-text-tertiary);
  }

  .retry-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) 0;
  }

  .retry {
    font-family: var(--font-primary);
    font-size: var(--font-size-sm);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    background: transparent;
    color: var(--btn-ghost-text);
    border: 1px solid var(--color-bar-track);
    border-radius: var(--btn-primary-radius);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
  }
</style>
