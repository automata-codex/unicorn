<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import Input from '../lib/components/Input.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';

  import type { MothershipCharacterSheet } from '@uv/game-systems';
  import type { CharacterSheet } from '../lib/types';

  let { params }: { params: { campaignId: string } } = $props();
  const campaignId = $derived(params.campaignId);

  let loading = $state(true);
  let submitting = $state(false);
  let error = $state('');

  /**
   * **Only the narrative fields are editable.** The sheet holds immutable
   * creation data since M7.6: Stats and Saves are pools in campaign state,
   * `maxHp` and `maxStress` were duplicates of pool ceilings, and skills and
   * equipment moved to campaign state too.
   *
   * `class`, `entityId` and `creationRolls` are shown but not editable, and
   * that is a correctness matter rather than a simplification.
   * `mergePlayerResourcePools` preserves on conflict, so re-deriving pools
   * from an edited sheet is a **no-op for every pool that already exists** —
   * which after creation is all of them. A class picker here would appear to
   * re-roll the character and silently change nothing (M7.6 §1.4).
   */
  let name = $state('');
  let pronouns = $state('');
  let trinket = $state('');
  let patch = $state('');
  let traumaResponse = $state('');
  let notes = $state('');

  /** Carried through the round-trip verbatim; never edited here. */
  let immutable = $state<MothershipCharacterSheet | null>(null);

  onMount(async () => {
    const res = await api(`/api/v1/campaigns/${campaignId}/characters`);
    if (res.ok) {
      const character: CharacterSheet = await res.json();
      const d = character.data;
      immutable = d;
      name = d.name;
      pronouns = d.pronouns ?? '';
      trinket = d.trinket ?? '';
      patch = d.patch ?? '';
      traumaResponse = d.traumaResponse ?? '';
      notes = d.notes ?? '';
    } else {
      error = 'Could not load character.';
    }
    loading = false;
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitting = true;
    error = '';

    if (!immutable) return;

    // Spread the loaded sheet first so `creationRolls`, `creationChoices`,
    // `class` and `entityId` round-trip byte-for-byte. A payload rebuilt from
    // the form fields alone would drop them, and the backend would reject the
    // write — or worse, accept a sheet whose creation rolls no longer explain
    // the character's pools.
    const payload: MothershipCharacterSheet = {
      ...immutable,
      name,
      pronouns: pronouns || undefined,
      trinket: trinket || undefined,
      patch: patch || undefined,
      traumaResponse: traumaResponse || undefined,
      notes: notes || undefined,
    };

    const res = await api(`/api/v1/campaigns/${campaignId}/characters`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      push(`/campaigns/${campaignId}/characters`);
    } else if (res.status === 409) {
      error = 'Cannot edit while an adventure is active.';
    } else {
      error = 'Something went wrong. Please try again.';
    }

    submitting = false;
  }
</script>

<PageLayout>
  {#if loading}
    <p class="type-meta">LOADING...</p>
  {:else}
    <h1 class="type-screen-label page-title">EDIT CHARACTER</h1>

    {#if error}
      <p class="error-text">{error}</p>
    {/if}

    <form onsubmit={handleSubmit}>
      <!-- IDENTITY -->
      <Card>
        <SectionLabel>IDENTITY</SectionLabel>
        <div class="section-content">
          <div class="field">
            <Input
              label="NAME"
              value={name}
              oninput={(e) => { name = (e.target as HTMLInputElement).value; }}
            />
          </div>
          <div class="field">
            <Input
              label="PRONOUNS"
              value={pronouns}
              placeholder="they/them"
              oninput={(e) => { pronouns = (e.target as HTMLInputElement).value; }}
            />
          </div>
        </div>
      </Card>

      <!-- FIXED AT CREATION -->
      <Card>
        <SectionLabel>FIXED AT CREATION</SectionLabel>
        <div class="section-content">
          <p class="type-meta fixed-note">
            CLASS, ENTITY ID AND THE CREATION ROLLS CANNOT BE EDITED. THEY
            DETERMINE THE POOLS THIS CHARACTER ALREADY HAS, AND CHANGING THEM
            HERE WOULD NOT CHANGE THOSE.
          </p>
          <div class="fixed-row">
            <span class="type-label">CLASS</span>
            <span class="type-body">{immutable?.class.toUpperCase()}</span>
          </div>
          <div class="fixed-row">
            <span class="type-label">ENTITY ID</span>
            <span class="type-body">{immutable?.entityId}</span>
          </div>
        </div>
      </Card>

      <!-- TRINKET, PATCH, TRAUMA -->
      <Card>
        <SectionLabel>TRINKET &amp; PATCH</SectionLabel>
        <div class="section-content">
          <div class="field">
            <Input
              label="TRINKET"
              value={trinket}
              oninput={(e) => { trinket = (e.target as HTMLInputElement).value; }}
            />
          </div>
          <div class="field">
            <Input
              label="PATCH"
              value={patch}
              oninput={(e) => { patch = (e.target as HTMLInputElement).value; }}
            />
          </div>
          <div class="field">
            <Input
              label="TRAUMA RESPONSE"
              value={traumaResponse}
              hint="MILITARY TRAINING GRANTS THE MARINE'S TO ANY CLASS"
              oninput={(e) => { traumaResponse = (e.target as HTMLInputElement).value; }}
            />
          </div>
        </div>
      </Card>

      <!-- NOTES -->
      <Card>
        <SectionLabel>NOTES</SectionLabel>
        <div class="section-content">
          <textarea
            class="notes-textarea"
            value={notes}
            oninput={(e) => { notes = (e.target as HTMLTextAreaElement).value; }}
          ></textarea>
        </div>
      </Card>

      <div class="submit-area">
        <Button fullWidth type="submit" disabled={submitting}>
          {submitting ? 'SAVING...' : 'SAVE CHANGES'}
        </Button>
        <Button variant="ghost" fullWidth type="button" onclick={() => push(`/campaigns/${campaignId}/characters`)}>
          CANCEL
        </Button>
      </div>
    </form>
  {/if}
</PageLayout>

<style>
  .page-title {
    margin-bottom: var(--space-7);
  }

  .error-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-danger);
    margin-bottom: var(--space-4);
  }

  form :global(.card) {
    margin-bottom: var(--space-5);
  }

  .fixed-note {
    color: var(--color-text-ghost);
    margin-bottom: var(--space-4);
  }

  .fixed-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: var(--space-2) 0;
  }

  .section-content {
    margin-top: var(--space-5);
  }

  .field {
    margin-bottom: var(--space-4);
  }

  .field:last-child {
    margin-bottom: 0;
  }








  .notes-textarea {
    width: 100%;
    min-height: 80px;
    resize: vertical;
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--input-text);
    border-radius: var(--input-radius);
    padding: var(--input-padding);
    outline: none;
    box-sizing: border-box;
  }

  .notes-textarea:focus {
    border-color: var(--color-accent-border);
  }

  .submit-area {
    margin-top: var(--space-5);
    margin-bottom: var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
