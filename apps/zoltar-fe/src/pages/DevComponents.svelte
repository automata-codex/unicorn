<div class="dev-page">
  <h1 class="type-screen-title">Component Preview</h1>

  <!-- Buttons -->
  <section>
    <h2 class="type-label">Button</h2>
    <div class="row">
      <Button>Primary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button disabled>Primary Disabled</Button>
      <Button variant="ghost" disabled>Ghost Disabled</Button>
    </div>
    <div class="row">
      <Button fullWidth>Full Width Primary</Button>
    </div>
  </section>

  <!-- Inputs -->
  <section>
    <h2 class="type-label">Input</h2>
    <div class="grid">
      <Input placeholder="Enter text..." />
      <Input label="Name" placeholder="Character name" />
      <Input label="With hint" placeholder="Type here" hint="This is a hint" />
      <Input value="Pre-filled value" />
      <Input label="Disabled" value="Cannot edit" disabled />
    </div>
  </section>

  <!-- Select -->
  <section>
    <h2 class="type-label">Select</h2>
    <div class="grid">
      <Select placeholder="Choose one..." options={sampleOptions} />
      <Select label="Class" value="marine" options={sampleOptions} />
      <Select label="Disabled" options={sampleOptions} disabled />
    </div>
  </section>

  <!-- Card + SectionLabel -->
  <section>
    <h2 class="type-label">Card + SectionLabel</h2>
    <div class="grid">
      <Card>
        <SectionLabel>IDENTITY</SectionLabel>
        <p class="type-body">Sample card content with a section label. Cards are simple wrappers with token-based styling.</p>
      </Card>
      <Card padding={false}>
        <div style="padding: var(--card-padding);">
          <SectionLabel>NO PADDING PROP</SectionLabel>
          <p class="type-body">This card has padding=false. Inner padding is manual.</p>
        </div>
      </Card>
    </div>
  </section>

  <!-- ResourceBar -->
  <section>
    <h2 class="type-label">ResourceBar</h2>
    <div class="grid">
      <ResourceBar label="HP" current={20} max={20} />
      <ResourceBar label="HP" current={13} max={20} />
      <ResourceBar label="HP" current={4} max={20} />
      <ResourceBar label="STRESS" current={3} max={7} color="stress" />
    </div>
  </section>

  <!-- StatusDot -->
  <section>
    <h2 class="type-label">StatusDot</h2>
    <div class="row" style="align-items: center;">
      <span class="type-body"><StatusDot /> Online</span>
      <span class="type-body"><StatusDot status="offline" /> Offline</span>
    </div>
  </section>

  <!-- Typography -->
  <section>
    <h2 class="type-label">Typography Scale</h2>
    <div class="stack">
      <span class="type-screen-label">type-screen-label — NEW ADVENTURE</span>
      <span class="type-screen-title">type-screen-title — Campaign Setup</span>
      <span class="type-campaign-name">type-campaign-name — Dead Planet</span>
      <span class="type-body">type-body — The airlock hisses open. You step into darkness.</span>
      <span class="type-label">type-label — SURVIVORS</span>
      <span class="type-meta">type-meta — LAST UPDATED 03:22</span>
      <span class="type-stat-value">type-stat-value — 42</span>
    </div>
  </section>
</div>

<script lang="ts">
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import Input from '../lib/components/Input.svelte';
  import ResourceBar from '../lib/components/ResourceBar.svelte';
  import SectionLabel from '../lib/components/SectionLabel.svelte';
  import Select from '../lib/components/Select.svelte';
  import StatusDot from '../lib/components/StatusDot.svelte';

  const sampleOptions = [
    { value: 'marine', label: 'Marine' },
    { value: 'teamster', label: 'Teamster' },
    { value: 'android', label: 'Android' },
    { value: 'scientist', label: 'Scientist' },
  ];
</script>

<style>
  .dev-page {
    background: var(--color-bg);
    min-height: 100vh;
    padding: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-9);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 320px;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
