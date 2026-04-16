<script lang="ts">
  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import Input from '../lib/components/Input.svelte';
  import PageLayout from '../lib/components/PageLayout.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';
  import Select from '../lib/components/Select.svelte';
  import { navigate } from '../lib/router.svelte';

  const { campaignId }: { campaignId: string } = $props();

  // Identity
  let name = $state('');
  let charClass = $state('teamster');
  let pronouns = $state('');
  let entityId = $state('');
  let entityIdManuallyEdited = $state(false);

  // Stats
  let strength = $state(30);
  let speed = $state(30);
  let intellect = $state(30);
  let combat = $state(30);
  let instinct = $state(30);
  let sanity = $state(30);

  // Saves
  let fear = $state(30);
  let body = $state(30);
  let armor = $state(30);
  let armorMax = $state(30);

  // HP & Stress
  let maxHp = $state(20);
  let maxStress = $state(3);

  // Dynamic lists
  let skills = $state<string[]>([]);
  let equipment = $state<string[]>([]);

  // Notes
  let notes = $state('');

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

  function addSkill() {
    skills = [...skills, ''];
  }

  function removeSkill(index: number) {
    skills = skills.filter((_, i) => i !== index);
  }

  function updateSkill(index: number, value: string) {
    skills = skills.map((s, i) => (i === index ? value : s));
  }

  function addEquipment() {
    equipment = [...equipment, ''];
  }

  function removeEquipment(index: number) {
    equipment = equipment.filter((_, i) => i !== index);
  }

  function updateEquipment(index: number, value: string) {
    equipment = equipment.map((s, i) => (i === index ? value : s));
  }

  function parseNum(e: Event): number {
    return Number((e.target as HTMLInputElement).value) || 0;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitting = true;
    error = '';

    const payload = {
      entityId: entityId || name.toLowerCase().replace(/\s+/g, '_'),
      name,
      pronouns: pronouns || undefined,
      class: charClass,
      stats: { strength, speed, intellect, combat, instinct, sanity },
      saves: { fear, body, armor, armorMax },
      maxHp,
      maxStress,
      skills: skills.filter((s) => s.trim() !== ''),
      equipment: equipment.filter((s) => s.trim() !== ''),
      notes: notes || undefined,
    };

    const res = await api(`/api/v1/campaigns/${campaignId}/characters`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      navigate(`/campaigns/${campaignId}`);
    } else if (res.status === 409) {
      error = 'This campaign already has a character.';
    } else {
      error = 'Something went wrong. Please try again.';
    }

    submitting = false;
  }
</script>

<PageLayout>
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
            onchange={(e) => { charClass = (e.target as HTMLSelectElement).value; }}
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

    <!-- STATS -->
    <Card>
      <SectionLabel>STATS</SectionLabel>
      <div class="section-content">
        <div class="stats-grid">
          <Input label="STRENGTH" type="number" value={strength} oninput={(e) => { strength = parseNum(e); }} />
          <Input label="SPEED" type="number" value={speed} oninput={(e) => { speed = parseNum(e); }} />
          <Input label="INTELLECT" type="number" value={intellect} oninput={(e) => { intellect = parseNum(e); }} />
          <Input label="COMBAT" type="number" value={combat} oninput={(e) => { combat = parseNum(e); }} />
          <Input label="INSTINCT" type="number" value={instinct} oninput={(e) => { instinct = parseNum(e); }} />
          <Input label="SANITY" type="number" value={sanity} oninput={(e) => { sanity = parseNum(e); }} />
        </div>
      </div>
    </Card>

    <!-- SAVES -->
    <Card>
      <SectionLabel>SAVES</SectionLabel>
      <div class="section-content">
        <div class="stats-grid">
          <Input label="FEAR" type="number" value={fear} oninput={(e) => { fear = parseNum(e); }} />
          <Input label="BODY" type="number" value={body} oninput={(e) => { body = parseNum(e); }} />
          <Input label="ARMOR" type="number" value={armor} oninput={(e) => { armor = parseNum(e); }} />
          <Input label="ARMOR MAX" type="number" value={armorMax} oninput={(e) => { armorMax = parseNum(e); }} />
        </div>
      </div>
    </Card>

    <!-- HP & STRESS -->
    <Card>
      <SectionLabel>HP &amp; STRESS</SectionLabel>
      <div class="section-content">
        <div class="stats-grid">
          <Input label="MAX HP" type="number" value={maxHp} oninput={(e) => { maxHp = parseNum(e); }} />
          <Input label="MAX STRESS" type="number" value={maxStress} oninput={(e) => { maxStress = parseNum(e); }} />
        </div>
      </div>
    </Card>

    <!-- SKILLS -->
    <Card>
      <SectionLabel>SKILLS</SectionLabel>
      <div class="section-content">
        <div class="dynamic-list">
          {#each skills as skill, i (i)}
            <div class="dynamic-row">
              <Input
                placeholder="Skill name"
                value={skill}
                oninput={(e) => { updateSkill(i, (e.target as HTMLInputElement).value); }}
              />
              <button
                type="button"
                class="remove-btn"
                onclick={() => removeSkill(i)}
              >×</button>
            </div>
          {/each}
        </div>
        <Button variant="ghost" type="button" onclick={addSkill}>+ ADD SKILL</Button>
      </div>
    </Card>

    <!-- LOADOUT -->
    <Card>
      <SectionLabel>LOADOUT</SectionLabel>
      <div class="section-content">
        <div class="dynamic-list">
          {#each equipment as item, i (i)}
            <div class="dynamic-row">
              <Input
                placeholder="Item name"
                value={item}
                oninput={(e) => { updateEquipment(i, (e.target as HTMLInputElement).value); }}
              />
              <button
                type="button"
                class="remove-btn"
                onclick={() => removeEquipment(i)}
              >×</button>
            </div>
          {/each}
        </div>
        <Button variant="ghost" type="button" onclick={addEquipment}>+ ADD ITEM</Button>
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

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .dynamic-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .dynamic-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
  }

  .dynamic-row :global(.input-wrapper) {
    flex: 1;
  }

  .remove-btn {
    all: unset;
    font-family: var(--font-primary);
    font-size: var(--font-size-lg);
    color: var(--color-text-ghost);
    cursor: pointer;
    padding: var(--space-2);
    line-height: 1;
  }

  .remove-btn:hover {
    color: var(--color-danger);
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
