<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';

  import { api } from '../lib/api';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import CharacterStatusStrip from '../lib/components/play/CharacterStatusStrip.svelte';
  import DicePrompt, {
    type DiceSubmission,
  } from '../lib/components/play/DicePrompt.svelte';
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
  import {
    type DiceRollWire,
    type MessageWire,
    mergeTimeline,
    type TimelineEntry,
  } from '../lib/components/play/timeline';

  import type { DicePromptRequest } from '../lib/components/play/dice-prompt-helpers';
  import type { Adventure, CharacterSheet } from '../lib/types';

  interface TurnAppliedState {
    resourcePools?: Record<string, { current: number; max: number | null }>;
    entities?: Record<
      string,
      { visible: boolean; status: string; npcState?: string }
    >;
  }

  interface TurnPayload {
    message: {
      id: string;
      role: 'assistant';
      content: string;
      createdAt: string;
    };
    applied: TurnAppliedState;
    thresholds: ThresholdCrossing[];
    diceRequests: DicePromptRequest[];
  }

  let { params }: { params: { campaignId: string; adventureId: string } } =
    $props();
  const campaignId = $derived(params.campaignId);
  const adventureId = $derived(params.adventureId);

  let loading = $state(true);
  let error = $state('');
  let messages = $state<MessageWire[]>([]);
  let diceRolls = $state<DiceRollWire[]>([]);
  let pendingDiceRequests = $state<DicePromptRequest[]>([]);
  let status = $state<CharacterStatus | null>(null);
  let characterName = $state('');
  let playerEntityId = $state('');
  let thresholds = $state<ThresholdCrossing[]>([]);
  let sending = $state(false);
  let retryAvailable = $state(false);
  let diceMode = $state<'soft_accountability' | 'commitment'>(
    'soft_accountability',
  );
  // Lifted up from MessageInput so handleDiceSubmit can read it — if the
  // player typed narrative alongside their rolls, the dice batch autoAdvance
  // is suppressed and the narrative goes through POST /messages instead.
  let narrativeDraft = $state('');

  let timeline = $derived<TimelineEntry[]>(mergeTimeline(messages, diceRolls));
  let dicePending = $derived(pendingDiceRequests.length > 0);

  onMount(async () => {
    try {
      const [advRes, charRes, msgRes, stateRes, campRes] = await Promise.all([
        api(`/api/v1/campaigns/${campaignId}/adventures/${adventureId}`),
        api(`/api/v1/campaigns/${campaignId}/characters`),
        api(
          `/api/v1/campaigns/${campaignId}/adventures/${adventureId}/messages`,
        ),
        api(`/api/v1/campaigns/${campaignId}/state`),
        api(`/api/v1/campaigns/${campaignId}`),
      ]);

      if (
        !advRes.ok ||
        !charRes.ok ||
        !msgRes.ok ||
        !stateRes.ok ||
        !campRes.ok
      ) {
        error = 'Failed to load adventure.';
        loading = false;
        return;
      }

      const adventure: Adventure = await advRes.json();
      const character: CharacterSheet = await charRes.json();
      const bootstrap: {
        messages: MessageWire[];
        diceRolls: DiceRollWire[];
        pendingDiceRequests: DicePromptRequest[];
      } = await msgRes.json();
      const stateBody: { data: CampaignStateData } = await stateRes.json();
      const campaign: { diceMode?: 'soft_accountability' | 'commitment' } =
        await campRes.json();

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
      diceMode = campaign.diceMode ?? 'soft_accountability';

      if (bootstrap.messages.length === 0 && adventure.openingNarration) {
        messages = [
          {
            id: 'opening',
            role: 'assistant',
            content: adventure.openingNarration,
            createdAt: new Date(0).toISOString(),
          },
        ];
      } else {
        messages = bootstrap.messages;
      }
      diceRolls = bootstrap.diceRolls;
      pendingDiceRequests = bootstrap.pendingDiceRequests;
    } catch {
      error = 'Failed to load adventure.';
    } finally {
      loading = false;
    }
  });

  /**
   * Apply a successful turn response to local state. Used both by the
   * narrative POST /messages path and by the auto-advance branch of
   * POST /dice-results (whose body nests the turn under `turn`).
   */
  function applyTurn(turn: TurnPayload): void {
    messages = [
      ...messages,
      {
        id: turn.message.id,
        role: turn.message.role,
        content: turn.message.content,
        createdAt: turn.message.createdAt,
      },
    ];
    if (status) {
      status = applyStatusDelta({
        previous: status,
        playerEntityId,
        applied: turn.applied,
      });
    }
    thresholds = turn.thresholds ?? [];
    pendingDiceRequests = turn.diceRequests ?? [];
  }

  /**
   * Core narrative POST. Used by the SEND button directly (when no dice
   * are pending) and by handleDiceSubmit when the player typed narrative
   * alongside their rolls.
   */
  async function postNarrative(content: string): Promise<boolean> {
    const optimisticId = `local-${Date.now()}`;
    const now = new Date().toISOString();
    messages = [
      ...messages,
      { id: optimisticId, role: 'user', content, createdAt: now },
    ];

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
      applyTurn(body as TurnPayload);
      return true;
    }
    if (errCode === 'precondition') {
      error = 'This adventure is no longer playable.';
      setTimeout(() => push(`/campaigns/${campaignId}`), 1500);
      return false;
    }
    error =
      errCode === 'gm_correction_failed'
        ? 'GM re-narration was rejected. Try sending your action again.'
        : 'GM service is unavailable. Try again in a moment.';
    retryAvailable = true;
    return false;
  }

  async function handleSend(content: string) {
    if (sending || dicePending) return;
    sending = true;
    retryAvailable = false;
    try {
      await postNarrative(content);
    } catch {
      error = 'Network error. Try again.';
      retryAvailable = true;
    } finally {
      sending = false;
    }
  }

  /**
   * Submit all rolls from DicePrompt. Each dice_result submission is its
   * own HTTP request — the backend resolves them one at a time.
   *
   * Two advancement paths, chosen by the narrative-field content at submit:
   * 1. Empty narrative: the last dice submission sets `autoAdvance: true`,
   *    the server runs a fresh Claude turn with the `[Dice results]` block
   *    as the implicit input, response body nests the new turn under
   *    `turn`. No follow-up HTTP request.
   * 2. Non-empty narrative: every dice submission uses
   *    `autoAdvance: false`, then we POST /messages with the narrative.
   *    The server sees the resolved rolls via `playerDiceRollsSinceLastGmResponse`
   *    and renders them into the `[Dice results]` block ahead of the
   *    narrative input.
   *
   * Optimistic UI: DicePrompt clears on submit. Restored if any submission
   * fails.
   */
  async function handleDiceSubmit(results: DiceSubmission[]) {
    if (sending || results.length === 0) return;
    sending = true;
    retryAvailable = false;

    const savedPending = pendingDiceRequests;
    const narrative = narrativeDraft.trim();
    const hasNarrative = narrative.length > 0;
    pendingDiceRequests = [];

    try {
      for (let i = 0; i < results.length; i++) {
        const isLast = i === results.length - 1;
        const submission = results[i];
        const autoAdvance = isLast && !hasNarrative;
        const res = await api(
          `/api/v1/campaigns/${campaignId}/adventures/${adventureId}/dice-results`,
          {
            method: 'POST',
            body: JSON.stringify({ ...submission, autoAdvance }),
          },
        );

        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }

        if (!res.ok) {
          pendingDiceRequests = savedPending;
          const errCode = classifySendError({
            status: res.status,
            body: body as { error?: string } | null,
          });
          error =
            errCode === 'gm_correction_failed'
              ? 'GM re-narration was rejected. Try sending your action again.'
              : errCode === 'gm_unavailable'
                ? 'GM service is unavailable. Try again in a moment.'
                : 'Dice submission failed. Try again.';
          retryAvailable = true;
          return;
        }

        const ok = body as {
          pendingRequestIds: string[];
          turn?: TurnPayload;
        };

        if (ok.turn) {
          // autoAdvance fired on the server and returned the new turn.
          applyTurn(ok.turn);
        } else {
          // No turn in the response — intermediate submission or
          // narrative-path batch. Track remaining pending.
          pendingDiceRequests = savedPending.filter((r) =>
            ok.pendingRequestIds.includes(r.id),
          );
        }
      }

      if (hasNarrative) {
        narrativeDraft = '';
        const ok = await postNarrative(narrative);
        if (!ok) {
          // postNarrative already set error/retry state; dice rolls
          // already resolved on the server, so the player can retype
          // their narrative to drive the turn forward.
          return;
        }
      }

      // Refresh dice events from the server so the player-entered rolls
      // (and any system-generated rolls from the advanced turn) appear
      // in the message log.
      await refreshDiceRolls();
    } catch {
      pendingDiceRequests = savedPending;
      error = 'Network error. Try again.';
      retryAvailable = true;
    } finally {
      sending = false;
    }
  }

  async function refreshDiceRolls() {
    try {
      const res = await api(
        `/api/v1/campaigns/${campaignId}/adventures/${adventureId}/messages`,
      );
      if (!res.ok) return;
      const body: { diceRolls: DiceRollWire[] } = await res.json();
      diceRolls = body.diceRolls;
    } catch {
      // Non-fatal — the timeline just misses the refreshed dice rows until
      // the next mount. Errors here shouldn't block the turn.
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
    <MessageLog {timeline} typing={sending} />
    {#if error && retryAvailable}
      <div class="retry-row">
        <p class="error-text">{error}</p>
        <button type="button" class="retry" onclick={clearError}>DISMISS</button>
      </div>
    {/if}
    {#if dicePending}
      <DicePrompt
        requests={pendingDiceRequests}
        {diceMode}
        onsubmit={handleDiceSubmit}
      />
    {/if}
    <MessageInput
      bind:value={narrativeDraft}
      sendDisabled={sending || dicePending}
      onsend={handleSend}
    />
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
