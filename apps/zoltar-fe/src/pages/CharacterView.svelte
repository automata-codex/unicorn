<script lang="ts">
  import { deriveMothershipCharacterResourcePools } from '@uv/game-systems';
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';

  import type { MothershipCreationRolls } from '@uv/game-systems';
  import type { Adventure, CharacterSheet } from '../lib/types';

  let { params }: { params: { campaignId: string } } = $props();
  const campaignId = $derived(params.campaignId);

  let character = $state<CharacterSheet | null>(null);
  let loading = $state(true);
  let error = $state('');
  let confirmingDelete = $state(false);
  let deleting = $state(false);

  /**
   * The creation rolls, rendered as the dice fell. Labelled and ordered by
   * hand rather than by `Object.entries`, which is what the pre-M7.6 view did
   * — convenient while fields were being dropped, wrong the moment one is
   * added, since a new key would appear with its raw name as a label.
   */
  const ROLL_LABELS: Array<[keyof MothershipCreationRolls, string]> = [
    ['strength', 'STRENGTH'],
    ['speed', 'SPEED'],
    ['intellect', 'INTELLECT'],
    ['combat', 'COMBAT'],
    ['sanity', 'SANITY'],
    ['fear', 'FEAR'],
    ['body', 'BODY'],
    ['maxHp', 'MAX HEALTH'],
    ['credits', 'CREDITS'],
    ['trinket', 'TRINKET'],
    ['patch', 'PATCH'],
  ];

  const rollEntries = $derived.by(() => {
    const sheet = character;
    if (!sheet) return [];
    return ROLL_LABELS.map(([key, label]) => ({
      key,
      label,
      dice: sheet.data.creationRolls[key].join(' + '),
    }));
  });

  /**
   * Starting values, derived from the rolls plus the class adjustments — the
   * same pure function the backend seeds pools with, so what is shown here
   * reconciles against the rolls above by construction rather than by a second
   * copy of the class table.
   *
   * These are the values the character *started* with. Current values live in
   * campaign state and are shown on the play screen; rendering them here would
   * mean fetching the adventure, and showing a stale number next to a label
   * that does not say "starting" is how a player reads a wound as a bad roll.
   */
  const STARTING_LABELS: Array<[string, string]> = [
    ['hp', 'HEALTH'],
    ['wounds', 'MAX WOUNDS'],
    ['strength', 'STRENGTH'],
    ['speed', 'SPEED'],
    ['intellect', 'INTELLECT'],
    ['combat', 'COMBAT'],
    ['sanity', 'SANITY'],
    ['fear', 'FEAR'],
    ['body', 'BODY'],
    ['credits', 'CREDITS'],
  ];

  const startingValues = $derived.by(() => {
    const sheet = character;
    if (!sheet) return [];
    const pools = deriveMothershipCharacterResourcePools(sheet.data)[
      sheet.data.entityId
    ];
    return STARTING_LABELS.map(([key, label]) => ({
      label,
      value: key === 'wounds' ? pools[key].max : pools[key].current,
    }));
  });

  const activeStatuses = ['synthesizing', 'ready', 'in_progress'];
  let hasActiveAdventure = $state(false);

  onMount(async () => {
    const [charRes, advRes] = await Promise.all([
      api(`/api/v1/campaigns/${campaignId}/characters`),
      api(`/api/v1/campaigns/${campaignId}/adventures`),
    ]);

    if (charRes.ok) {
      character = await charRes.json();
    } else if (charRes.status === 404) {
      error = 'No character found.';
    } else {
      error = 'Something went wrong.';
    }

    if (advRes.ok) {
      const adventures: Adventure[] = await advRes.json();
      hasActiveAdventure = adventures.some((a) =>
        activeStatuses.includes(a.status),
      );
    }

    loading = false;
  });

  async function handleDelete() {
    deleting = true;
    const res = await api(`/api/v1/campaigns/${campaignId}/characters`, {
      method: 'DELETE',
    });

    if (res.ok || res.status === 204) {
      push(`/campaigns/${campaignId}`);
    } else if (res.status === 409) {
      error = 'Cannot delete while an adventure is active.';
      confirmingDelete = false;
    } else {
      error = 'Something went wrong.';
      confirmingDelete = false;
    }
    deleting = false;
  }
</script>

<PageLayout>
  <div class="header">
    <Button variant="ghost" onclick={() => push(`/campaigns/${campaignId}`)}>← CAMPAIGN</Button>
  </div>

  {#if loading}
    <p class="type-meta">LOADING...</p>
  {:else if error}
    <p class="error-text">{error}</p>
  {:else if character}
    <h1 class="type-campaign-name character-name">{character.data.name}</h1>

    <!-- Identity -->
    <Card>
      <SectionLabel>IDENTITY</SectionLabel>
      <div class="section-content">
        <div class="detail-row">
          <span class="type-label">CLASS</span>
          <span class="type-body">{character.data.class}</span>
        </div>
        {#if character.data.pronouns}
          <div class="detail-row">
            <span class="type-label">PRONOUNS</span>
            <span class="type-body">{character.data.pronouns}</span>
          </div>
        {/if}
        <div class="detail-row">
          <span class="type-label">ENTITY ID</span>
          <span class="detail-value-ghost">{character.data.entityId}</span>
        </div>
      </div>
    </Card>

    <!-- Creation rolls -->
    <Card>
      <SectionLabel>CREATION ROLLS</SectionLabel>
      <div class="section-content">
        <p class="type-meta roll-note">
          THE DICE AS THEY FELL. A RECORD OF THE STARTING POSITION — NOT
          CURRENT VALUES, WHICH CHANGE IN PLAY.
        </p>
        <div class="stat-grid">
          {#each rollEntries as entry (entry.key)}
            <div class="stat-item">
              <span class="type-stat-value">{entry.dice}</span>
              <span class="type-label">{entry.label}</span>
            </div>
          {/each}
        </div>
      </div>
    </Card>

    <!-- Starting values -->
    <Card>
      <SectionLabel>STARTING VALUES</SectionLabel>
      <div class="section-content">
        <p class="type-meta roll-note">
          THE ROLLS ABOVE PLUS THE {character.data.class.toUpperCase()} CLASS
          ADJUSTMENTS. CURRENT VALUES LIVE IN THE ADVENTURE, NOT HERE.
        </p>
        <div class="stat-grid">
          {#each startingValues as entry (entry.label)}
            <div class="stat-item">
              <span class="type-stat-value">{entry.value}</span>
              <span class="type-label">{entry.label}</span>
            </div>
          {/each}
        </div>
      </div>
    </Card>

    <!-- Trinket, patch, trauma response -->
    {#if character.data.trinket || character.data.patch || character.data.traumaResponse}
      <Card>
        <SectionLabel>LOADOUT &amp; TRAUMA</SectionLabel>
        <div class="section-content">
          {#if character.data.trinket}
            <div class="detail-row">
              <span class="type-label">TRINKET</span>
              <span class="type-body">{character.data.trinket}</span>
            </div>
          {/if}
          {#if character.data.patch}
            <div class="detail-row">
              <span class="type-label">PATCH</span>
              <span class="type-body">{character.data.patch}</span>
            </div>
          {/if}
          {#if character.data.traumaResponse}
            <div class="detail-row">
              <span class="type-label">TRAUMA RESPONSE</span>
              <span class="type-body">{character.data.traumaResponse}</span>
            </div>
          {/if}
        </div>
      </Card>
    {/if}

    <!-- Notes -->
    {#if character.data.notes}
      <Card>
        <SectionLabel>NOTES</SectionLabel>
        <div class="section-content">
          <p class="type-body">{character.data.notes}</p>
        </div>
      </Card>
    {/if}

    <!-- Actions -->
    <div class="actions">
      <Button
        fullWidth
        disabled={hasActiveAdventure}
        onclick={() => push(`/campaigns/${campaignId}/characters/edit`)}
      >
        EDIT CHARACTER
      </Button>

      {#if confirmingDelete}
        <div class="delete-confirm">
          <p class="type-meta delete-warning">THIS CANNOT BE UNDONE</p>
          <div class="delete-confirm-buttons">
            <Button fullWidth variant="ghost" onclick={() => { confirmingDelete = false; }}>
              CANCEL
            </Button>
            <Button fullWidth disabled={deleting} onclick={handleDelete}>
              {deleting ? 'DELETING...' : 'CONFIRM DELETE'}
            </Button>
          </div>
        </div>
      {:else}
        <Button
          fullWidth
          variant="ghost"
          disabled={hasActiveAdventure}
          onclick={() => { confirmingDelete = true; }}
        >
          DELETE CHARACTER
        </Button>
      {/if}

      {#if hasActiveAdventure}
        <p class="type-meta disabled-caption">ADVENTURE IN PROGRESS</p>
      {/if}
    </div>
  {/if}
</PageLayout>

<style>
  .header {
    margin-bottom: var(--space-4);
  }

  .header :global(.btn) {
    padding-left: 0;
  }

  .character-name {
    margin-bottom: var(--space-7);
  }

  .error-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-danger);
  }

  :global(.card) + :global(.card) {
    margin-top: var(--space-5);
  }

  .section-content {
    margin-top: var(--space-5);
  }

  .roll-note {
    color: var(--color-text-ghost);
    margin-bottom: var(--space-4);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: var(--space-2) 0;
  }

  .detail-value-ghost {
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    color: var(--color-text-ghost);
  }

  .stat-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
  }



  .actions {
    margin-top: var(--space-7);
    margin-bottom: var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .delete-confirm {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .delete-warning {
    text-align: center;
    color: var(--color-danger);
  }

  .delete-confirm-buttons {
    display: flex;
    gap: var(--space-3);
  }

  .disabled-caption {
    text-align: center;
  }
</style>
