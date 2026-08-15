<script lang="ts">
  import {
    deriveMothershipCharacterResourcePools,
    executeDiceRoll,
  } from '@uv/game-systems';
  import { push } from 'svelte-spa-router';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import Input from '../lib/components/Input.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';
  import Select from '../lib/components/Select.svelte';

  import type {
    MothershipCharacterSheet,
    MothershipClass,
    MothershipCreationRolls,
    MothershipStat,
  } from '@uv/game-systems';

  let { params }: { params: { campaignId: string } } = $props();
  const campaignId = $derived(params.campaignId);

  // Identity
  let name = $state('');
  let charClass = $state<MothershipClass>('teamster');
  let pronouns = $state('');
  let entityId = $state('');
  let entityIdManuallyEdited = $state(false);

  /**
   * Creation rolls, held as the dice themselves rather than as sums (§1.1).
   *
   * They start rolled rather than blank: a form that opens on zeros invites
   * the player to type a number they liked, and the pre-M7.6 defaults are what
   * that produces — `maxHp = 20` was the *maximum possible* `1d10+10`, and
   * `maxStress = 3` had no referent in the book at all.
   *
   * Manual entry is still permitted, and the field records what the player
   * entered. The point is a record of the starting position, not proof that
   * dice were used.
   */
  const ROLL_SPECS = [
    { key: 'strength', label: 'STRENGTH', notation: '2d10' },
    { key: 'speed', label: 'SPEED', notation: '2d10' },
    { key: 'intellect', label: 'INTELLECT', notation: '2d10' },
    { key: 'combat', label: 'COMBAT', notation: '2d10' },
    { key: 'sanity', label: 'SANITY', notation: '2d10' },
    { key: 'fear', label: 'FEAR', notation: '2d10' },
    { key: 'body', label: 'BODY', notation: '2d10' },
    { key: 'maxHp', label: 'MAX HEALTH', notation: '1d10' },
    { key: 'credits', label: 'CREDITS', notation: '2d10' },
    { key: 'trinket', label: 'TRINKET', notation: '1d100' },
    { key: 'patch', label: 'PATCH', notation: '1d100' },
  ] as const satisfies ReadonlyArray<{
    key: keyof MothershipCreationRolls;
    label: string;
    notation: string;
  }>;

  function rollAll(): MothershipCreationRolls {
    const rolled = {} as MothershipCreationRolls;
    for (const spec of ROLL_SPECS) {
      rolled[spec.key] = executeDiceRoll(spec.notation).results;
    }
    return rolled;
  }

  let creationRolls = $state<MothershipCreationRolls>(rollAll());

  function rerollAll() {
    creationRolls = rollAll();
  }

  function rerollOne(key: keyof MothershipCreationRolls, notation: string) {
    creationRolls = {
      ...creationRolls,
      [key]: executeDiceRoll(notation).results,
    };
  }

  function setDie(
    key: keyof MothershipCreationRolls,
    index: number,
    value: number,
  ) {
    creationRolls = {
      ...creationRolls,
      [key]: creationRolls[key].map((die, i) => (i === index ? value : die)),
    };
  }

  /**
   * The Android's −10 and the Scientist's +5 land on a Stat the player picks,
   * and the schema rejects a sheet from either class that does not record
   * which. Without it, the rolls-plus-class-arithmetic reconciliation the
   * milestone is built around cannot be computed at all.
   */
  const CLASSES_CHOOSING_A_STAT: MothershipClass[] = ['android', 'scientist'];
  const choosesStat = $derived(CLASSES_CHOOSING_A_STAT.includes(charClass));
  let adjustedStat = $state<MothershipStat>('strength');

  const statOptions = [
    { value: 'strength', label: 'Strength' },
    { value: 'speed', label: 'Speed' },
    { value: 'intellect', label: 'Intellect' },
    { value: 'combat', label: 'Combat' },
  ];

  const CLASS_ADJUSTMENT_SUMMARY: Record<MothershipClass, string> = {
    marine: '+10 COMBAT, +10 BODY, +20 FEAR, +1 MAX WOUNDS',
    android: '+20 INTELLECT, −10 TO ONE STAT, +60 FEAR, +1 MAX WOUNDS',
    scientist: '+10 INTELLECT, +5 TO ONE STAT, +30 SANITY',
    teamster: '+5 ALL STATS, +10 ALL SAVES',
  };

  /** Trade the starting loadout for cash: 2d10x100 instead of 2d10x10 (§6.1). */
  let forgoLoadout = $state(false);

  let trinket = $state('');
  let patch = $state('');
  let traumaResponse = $state('');
  let notes = $state('');

  const sheet = $derived<MothershipCharacterSheet>({
    entityId: entityId || 'unnamed',
    name: name || 'Unnamed',
    class: charClass,
    creationRolls,
    ...(choosesStat ? { creationChoices: { adjustedStat } } : {}),
  });

  /**
   * Live preview of what creation will actually seed, from the same pure
   * function the backend uses. Not a second copy of the class table — that is
   * exactly the duplication this milestone removed everywhere else.
   */
  const preview = $derived(
    deriveMothershipCharacterResourcePools(sheet, { forgoLoadout })[
      sheet.entityId
    ],
  );

  const PREVIEW_ORDER: Array<[string, string]> = [
    ['hp', 'HEALTH'],
    ['wounds', 'MAX WOUNDS'],
    ['stress', 'STRESS'],
    ['strength', 'STRENGTH'],
    ['speed', 'SPEED'],
    ['intellect', 'INTELLECT'],
    ['combat', 'COMBAT'],
    ['sanity', 'SANITY'],
    ['fear', 'FEAR'],
    ['body', 'BODY'],
    ['credits', 'CREDITS'],
  ];

  let submitting = $state(false);
  let error = $state('');

  // Auto-derive entityId from name
  $effect(() => {
    if (!entityIdManuallyEdited) {
      entityId = name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');
    }
  });

  const classOptions = [
    { value: 'teamster', label: 'Teamster' },
    { value: 'marine', label: 'Marine' },
    { value: 'scientist', label: 'Scientist' },
    { value: 'android', label: 'Android' },
  ];

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitting = true;
    error = '';

    const payload: MothershipCharacterSheet = {
      ...sheet,
      entityId: entityId || name.toLowerCase().replace(/\s+/g, '_'),
      name,
      pronouns: pronouns || undefined,
      trinket: trinket || undefined,
      patch: patch || undefined,
      traumaResponse: traumaResponse || undefined,
      notes: notes || undefined,
    };

    const res = await api(`/api/v1/campaigns/${campaignId}/characters`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      push(`/campaigns/${campaignId}`);
    } else if (res.status === 409) {
      error = 'This campaign already has a character.';
    } else {
      error = 'Something went wrong. Please try again.';
    }

    submitting = false;
  }
</script>

<PageLayout>
  <div class="header">
    <Button variant="ghost" onclick={() => push(`/campaigns/${campaignId}`)}>← CAMPAIGN</Button>
  </div>
  <h1 class="type-screen-label page-title">CHARACTER CREATION</h1>

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
          <Select
            label="CLASS"
            value={charClass}
            options={classOptions}
            onchange={(e) => {
              charClass = (e.target as HTMLSelectElement).value as MothershipClass;
            }}
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
        <div class="field entity-id-field">
          <Input
            label="ENTITY ID"
            value={entityId}
            oninput={(e) => {
              entityId = (e.target as HTMLInputElement).value;
              entityIdManuallyEdited = true;
            }}
            hint="DERIVED FROM NAME — USED INTERNALLY"
          />
        </div>
      </div>
    </Card>

    <!-- CLASS ADJUSTMENT -->
    <Card>
      <SectionLabel>CLASS</SectionLabel>
      <div class="section-content">
        <p class="type-meta hint-note">
          {CLASS_ADJUSTMENT_SUMMARY[charClass]}
        </p>
        {#if choosesStat}
          <div class="field">
            <Select
              label="ADJUSTED STAT"
              value={adjustedStat}
              options={statOptions}
              onchange={(e) => {
                adjustedStat = (e.target as HTMLSelectElement).value as MothershipStat;
              }}
            />
          </div>
        {/if}
      </div>
    </Card>

    <!-- CREATION ROLLS -->
    <Card>
      <SectionLabel>CREATION ROLLS</SectionLabel>
      <div class="section-content">
        <p class="type-meta hint-note">
          THE DICE AS THEY FALL. EDIT A DIE TO ENTER A ROLL MADE AT THE TABLE —
          THIS RECORDS THE STARTING POSITION, NOT PROOF THAT DICE WERE USED.
        </p>
        <div class="roll-list">
          {#each ROLL_SPECS as spec (spec.key)}
            <div class="roll-row">
              <span class="type-label roll-label">{spec.label}</span>
              <span class="type-meta roll-notation">{spec.notation}</span>
              <div class="roll-dice">
                {#each creationRolls[spec.key] as die, i (i)}
                  <Input
                    type="number"
                    value={die}
                    oninput={(e) => {
                      setDie(spec.key, i, Number((e.target as HTMLInputElement).value) || 1);
                    }}
                  />
                {/each}
              </div>
              <button
                type="button"
                class="reroll-btn"
                onclick={() => rerollOne(spec.key, spec.notation)}
              >REROLL</button>
            </div>
          {/each}
        </div>
        <Button variant="ghost" type="button" onclick={rerollAll}>
          REROLL EVERYTHING
        </Button>
      </div>
    </Card>

    <!-- STARTING VALUES -->
    <Card>
      <SectionLabel>STARTING VALUES</SectionLabel>
      <div class="section-content">
        <p class="type-meta hint-note">
          THE ROLLS ABOVE PLUS THE CLASS ADJUSTMENTS. THIS IS WHAT CREATION
          WILL WRITE.
        </p>
        <div class="stat-grid">
          {#each PREVIEW_ORDER as [key, label] (key)}
            <div class="stat-item">
              <span class="type-stat-value">
                {key === 'wounds' ? preview[key].max : preview[key].current}
              </span>
              <span class="type-label">{label}</span>
            </div>
          {/each}
        </div>
        <label class="loadout-toggle">
          <input
            type="checkbox"
            checked={forgoLoadout}
            onchange={(e) => {
              forgoLoadout = (e.target as HTMLInputElement).checked;
            }}
          />
          <span class="type-body">
            FORGO THE STARTING LOADOUT FOR CASH (2d10 x100 INSTEAD OF x10)
          </span>
        </label>
      </div>
    </Card>

    <!-- TRINKET, PATCH, TRAUMA -->
    <Card>
      <SectionLabel>TRINKET &amp; PATCH</SectionLabel>
      <div class="section-content">
        <p class="type-meta hint-note">
          LOOK THE TRINKET AND PATCH ROLLS UP ON THEIR TABLES AND RECORD WHAT
          THEY SAY.
        </p>
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
        {submitting ? 'SUBMITTING...' : 'CONFIRM CREW'}
      </Button>
    </div>
  </form>
</PageLayout>

<style>
  .header :global(.btn) {
    padding-left: 0;
  }

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

  .hint-note {
    color: var(--color-text-ghost);
    margin-bottom: var(--space-4);
  }

  .roll-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .roll-row {
    display: grid;
    grid-template-columns: 1fr auto minmax(0, 12rem) auto;
    align-items: center;
    gap: var(--space-3);
  }

  .roll-notation {
    color: var(--color-text-ghost);
  }

  .roll-dice {
    display: flex;
    gap: var(--space-2);
  }

  .reroll-btn {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    letter-spacing: var(--tracking-wide);
    background: transparent;
    color: var(--btn-ghost-text);
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .reroll-btn:hover {
    color: var(--btn-ghost-text-active);
  }

  .stat-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    margin-bottom: var(--space-4);
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .loadout-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    cursor: pointer;
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

  .entity-id-field :global(.input) {
    font-size: var(--font-size-xs);
    color: var(--color-text-ghost);
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
  }
</style>
