<script lang="ts">
  import {
    deriveMothershipCharacterResourcePools,
    executeDiceRoll,
    explainMothershipCharacterPools,
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
    MothershipCharacterPoolName,
    MothershipCharacterSheet,
    MothershipClass,
    MothershipCreationRolls,
    MothershipEquipmentEntry,
    MothershipSkillEntry,
    MothershipStat,
    MothershipWornArmor,
    PoolTerm,
    PoolTermKind,
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
    { key: 'loadout', label: 'LOADOUT', notation: '1d10' },
    { key: 'trinket', label: 'TRINKET', notation: '1d100' },
    { key: 'patch', label: 'PATCH', notation: '1d100' },
  ] as const satisfies ReadonlyArray<{
    key: keyof MothershipCreationRolls;
    label: string;
    notation: string;
  }>;

  /**
   * The form always rolls every entry in `ROLL_SPECS`, so its working copy has
   * no optional members. `loadout` is optional on the *schema* only because
   * sheets written before it existed cannot acquire a roll nobody made — a
   * character created here always has one.
   */
  type FormRolls = Required<MothershipCreationRolls>;

  function rollAll(): FormRolls {
    const rolled = {} as FormRolls;
    for (const spec of ROLL_SPECS) {
      rolled[spec.key] = executeDiceRoll(spec.notation).results;
    }
    return rolled;
  }

  let creationRolls = $state<FormRolls>(rollAll());

  function rerollAll() {
    creationRolls = rollAll();
  }

  function rerollOne(key: keyof FormRolls, notation: string) {
    creationRolls = {
      ...creationRolls,
      [key]: executeDiceRoll(notation).results,
    };
  }

  function setDie(key: keyof FormRolls, index: number, value: number) {
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

  /**
   * Starting skills. Free text plus a tier, because the skill list and its
   * prerequisite graph are TKG content and do not ship — the player reads them
   * from their own book, exactly as they do the loadout tables.
   */
  const TIER_OPTIONS = [
    { value: 'trained', label: 'Trained (+10)' },
    { value: 'expert', label: 'Expert (+15)' },
    { value: 'master', label: 'Master (+20)' },
  ];

  let startingSkills = $state<MothershipSkillEntry[]>([]);

  function addSkill() {
    startingSkills = [...startingSkills, { skill: '', tier: 'trained' }];
  }

  function removeSkill(index: number) {
    startingSkills = startingSkills.filter((_, i) => i !== index);
  }

  function setSkill(index: number, patch: Partial<MothershipSkillEntry>) {
    startingSkills = startingSkills.map((entry, i) =>
      i === index ? { ...entry, ...patch } : entry,
    );
  }

  /** Named skills only — a blank row is an unfinished edit, not a skill. */
  const skillsForSubmit = $derived(
    startingSkills
      .map((entry) => ({ ...entry, skill: entry.skill.trim() }))
      .filter((entry) => entry.skill.length > 0),
  );

  /*
   * Plain array scan rather than a Set: `svelte/prefer-svelte-reactivity`
   * rejects a mutable built-in Set inside reactive code, and a skill list is
   * short enough that the quadratic scan is free.
   */
  const duplicateSkill = $derived.by(() => {
    const keys = skillsForSubmit.map((entry) => entry.skill.toLowerCase());
    const index = keys.findIndex((key, i) => keys.indexOf(key) !== i);
    return index === -1 ? null : skillsForSubmit[index].skill;
  });

  /**
   * The loadout: carried items and worn armor, transcribed from the player's
   * own book. The tables are PSG content and do not ship, and the creation form
   * has no Warden in it, so there is nothing to look them up against.
   */
  let equipment = $state<MothershipEquipmentEntry[]>([]);

  function addItem() {
    equipment = [...equipment, { item: '' }];
  }

  function removeItem(index: number) {
    equipment = equipment.filter((_, i) => i !== index);
  }

  function setItem(index: number, patch: Partial<MothershipEquipmentEntry>) {
    equipment = equipment.map((entry, i) =>
      i === index ? { ...entry, ...patch } : entry,
    );
  }

  const equipmentForSubmit = $derived(
    equipment
      .map((entry) => ({ ...entry, item: entry.item.trim() }))
      .filter((entry) => entry.item.length > 0),
  );

  let wearsArmor = $state(false);
  let armorItem = $state('');
  let armorAp = $state(0);
  let armorDr = $state(0);
  let armorO2 = $state<number | null>(null);

  const wornArmor = $derived<MothershipWornArmor | null>(
    wearsArmor && armorItem.trim()
      ? {
          item: armorItem.trim(),
          apBase: armorAp,
          apCurrent: armorAp,
          destroyed: false,
          dr: armorDr,
          o2Remaining: armorO2,
          features: [],
        }
      : null,
  );

  /** Credits spent on gear beyond the loadout. An input to the derivation. */
  let gearSpend = $state(0);

  let trinket = $state('');
  let patch = $state('');
  let traumaResponse = $state('');
  let notes = $state('');

  const sheet = $derived<MothershipCharacterSheet>({
    entityId: entityId || 'unnamed',
    name: name || 'Unnamed',
    class: charClass,
    creationRolls,
    creationChoices: {
      ...(choosesStat ? { adjustedStat } : {}),
      forgoLoadout,
      gearSpend,
    },
  });

  /**
   * Live preview of what creation will actually seed, from the same pure
   * function the backend uses. Not a second copy of the class table — that is
   * exactly the duplication this milestone removed everywhere else.
   *
   * Derived from `sheet`, which is also what gets POSTed, so the preview cannot
   * be computed from inputs the payload does not carry. It could before:
   * `forgoLoadout` was passed here as an option and left out of the payload, so
   * the box showed ×100 credits and seeded ×10.
   */
  const preview = $derived(
    deriveMothershipCharacterResourcePools(sheet)[sheet.entityId],
  );

  /**
   * The terms behind each total, from the same function that computes them.
   *
   * Without this the screen asserted a number and showed none of its
   * arithmetic — so a *correct* Scientist Sanity of `2d10+10+30` was
   * indistinguishable from a broken one, and got reported as a bug by the
   * person who wrote the class table.
   */
  const breakdowns = $derived(explainMothershipCharacterPools(sheet));

  /*
   * Mirrors the sheet schema's own guard so the failure lands next to the
   * decision rather than on submit. The preview already shows the subtraction
   * as a term, so this only has to say why the button is off.
   */
  const overspent = $derived(preview.credits.current < 0);

  const TERM_LABELS: Record<PoolTermKind, string> = {
    dice: 'ROLL',
    base: 'BASE',
    class: 'CLASS',
    choice: 'CHOICE',
    seed: 'START',
    multiplier: 'RATE',
    spend: 'GEAR',
  };

  /** `+7`, `−10`, `x100` — signed so the arithmetic reads left to right. */
  function formatTerm(term: PoolTerm): string {
    if (term.op === 'multiply') return `x${term.value}`;
    return term.value < 0 ? `\u2212${Math.abs(term.value)}` : `+${term.value}`;
  }

  const PREVIEW_ORDER: Array<[MothershipCharacterPoolName, string]> = [
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
      body: JSON.stringify({
        sheet: payload,
        startingSkills: skillsForSubmit,
        startingEquipment: equipmentForSubmit,
        wornArmor,
      }),
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

    <!-- SKILLS -->
    <Card>
      <SectionLabel>SKILLS</SectionLabel>
      <div class="section-content">
        <p class="type-meta hint-note">
          FROM YOUR OWN COPY OF THE RULES — THE SKILL LIST AND ITS PREREQUISITE
          CHAIN ARE NOT SHIPPED WITH ZOLTAR. A HIGHER TIER IMPLIES THE ONES
          BELOW IT.
        </p>
        {#each startingSkills as entry, i (i)}
          <div class="skill-row">
            <Input
              label="SKILL"
              value={entry.skill}
              placeholder="Zero-G"
              oninput={(e) => {
                setSkill(i, { skill: (e.target as HTMLInputElement).value });
              }}
            />
            <Select
              label="TIER"
              value={entry.tier}
              options={TIER_OPTIONS}
              onchange={(e) => {
                setSkill(i, {
                  tier: (e.target as HTMLSelectElement)
                    .value as MothershipSkillEntry['tier'],
                });
              }}
            />
            <button
              type="button"
              class="reroll-btn"
              onclick={() => removeSkill(i)}>REMOVE</button
            >
          </div>
        {/each}
        {#if duplicateSkill}
          <p class="error-text">
            "{duplicateSkill}" IS LISTED TWICE. A SKILL IS HELD AT ONE TIER.
          </p>
        {/if}
        <Button variant="ghost" type="button" onclick={addSkill}>
          ADD A SKILL
        </Button>
      </div>
    </Card>

    <!-- LOADOUT -->
    <Card>
      <SectionLabel>LOADOUT &amp; GEAR</SectionLabel>
      <div class="section-content">
        <p class="type-meta hint-note">
          ROLL {creationRolls.loadout[0]} ON YOUR CLASS LOADOUT TABLE — ROW
          {String(creationRolls.loadout[0] - 1).padStart(2, '0')}. THE TABLES ARE
          NOT SHIPPED WITH ZOLTAR; TRANSCRIBE FROM YOUR OWN COPY.
        </p>

        {#if forgoLoadout}
          <p class="type-meta hint-note">
            YOU TRADED THE LOADOUT FOR CASH. CARRY ONLY WHAT YOU BUY.
          </p>
        {/if}

        <label class="loadout-toggle">
          <input
            type="checkbox"
            checked={wearsArmor}
            onchange={(e) => {
              wearsArmor = (e.target as HTMLInputElement).checked;
            }}
          />
          <span class="type-body">WEARING ARMOR</span>
        </label>

        {#if wearsArmor}
          <div class="armor-row">
            <Input
              label="ARMOR"
              value={armorItem}
              placeholder="Vaccsuit"
              oninput={(e) => { armorItem = (e.target as HTMLInputElement).value; }}
            />
            <Input
              label="AP"
              type="number"
              value={armorAp}
              oninput={(e) => {
                armorAp = Number((e.target as HTMLInputElement).value) || 0;
              }}
            />
            <Input
              label="DR"
              type="number"
              value={armorDr}
              oninput={(e) => {
                armorDr = Number((e.target as HTMLInputElement).value) || 0;
              }}
            />
            <Input
              label="O2 (MIN)"
              type="number"
              value={armorO2 ?? ''}
              hint="BLANK IF UNSEALED"
              oninput={(e) => {
                const raw = (e.target as HTMLInputElement).value;
                armorO2 = raw === '' ? null : Number(raw) || 0;
              }}
            />
          </div>
        {/if}

        {#each equipment as entry, i (i)}
          <div class="item-row">
            <Input
              label="ITEM"
              value={entry.item}
              placeholder="Patch Kit"
              oninput={(e) => {
                setItem(i, { item: (e.target as HTMLInputElement).value });
              }}
            />
            <Input
              label="QTY"
              type="number"
              value={entry.quantity ?? ''}
              oninput={(e) => {
                const raw = (e.target as HTMLInputElement).value;
                setItem(i, { quantity: raw === '' ? undefined : Number(raw) });
              }}
            />
            <Input
              label="CHARGES"
              type="number"
              value={entry.charges ?? ''}
              oninput={(e) => {
                const raw = (e.target as HTMLInputElement).value;
                setItem(i, { charges: raw === '' ? undefined : Number(raw) });
              }}
            />
            <button
              type="button"
              class="reroll-btn"
              onclick={() => removeItem(i)}>REMOVE</button
            >
          </div>
        {/each}

        <Button variant="ghost" type="button" onclick={addItem}>ADD AN ITEM</Button>

        <div class="field">
          <Input
            label="CREDITS SPENT ON GEAR"
            type="number"
            value={gearSpend}
            hint="SUBTRACTED FROM STARTING CREDITS"
            oninput={(e) => {
              gearSpend = Number((e.target as HTMLInputElement).value) || 0;
            }}
          />
        </div>
        {#if overspent}
          <p class="error-text">
            GEAR COSTS MORE THAN YOU HAVE. A CHARACTER CANNOT START IN DEBT.
          </p>
        {/if}
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
              <span class="type-meta stat-terms">
                {#each breakdowns[key].terms as term, i (i)}<span
                    class="stat-term"
                    >{i === 0 && term.op === 'add'
                      ? term.value
                      : formatTerm(term)}<span class="stat-term-kind"
                      >{TERM_LABELS[term.kind]}</span
                    ></span
                  >{/each}
              </span>
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
      <Button fullWidth type="submit" disabled={submitting || !!duplicateSkill || overspent}>
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

  /*
   * The arithmetic behind each total. Tertiary rather than secondary — it is
   * an audit trail, and it must not compete with the value it explains.
   */
  .stat-terms {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
  }

  .stat-term {
    display: inline-flex;
    align-items: baseline;
    gap: 0.25em;
    white-space: nowrap;
  }

  .stat-term-kind {
    color: var(--color-text-ghost);
    letter-spacing: var(--tracking-wide);
  }

  .armor-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: var(--space-3);
    align-items: end;
  }

  .item-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr auto;
    gap: var(--space-3);
    align-items: end;
  }

  .skill-row {
    display: grid;
    grid-template-columns: 2fr 1fr auto;
    gap: var(--space-3);
    align-items: end;
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
