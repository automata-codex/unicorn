<div class="select-wrapper">
  {#if label}
    <label class="select-label" for={selectId}>{label}</label>
  {/if}
  <div class="select-container">
    <select
      class="select"
      id={selectId}
      disabled={disabled}
      onchange={onchange}
    >
      {#if placeholder}
        <option value="" disabled selected={!value}>{placeholder}</option>
      {/if}
      {#each options as opt}
        <option value={opt.value} selected={value === opt.value}>{opt.label}</option>
      {/each}
    </select>
    <span class="chevron">▾</span>
  </div>
</div>

<script lang="ts">
  const selectId = crypto.randomUUID();

  let {
    value = undefined,
    options,
    placeholder = undefined,
    label = undefined,
    disabled = false,
    onchange = undefined,
  }: {
    value?: string;
    options: Array<{ value: string; label: string }>;
    placeholder?: string;
    label?: string;
    disabled?: boolean;
    onchange?: (e: Event) => void;
  } = $props();
</script>

<style>
  .select-wrapper {
    display: flex;
    flex-direction: column;
  }

  .select-label {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    margin-bottom: var(--space-2);
  }

  .select-container {
    position: relative;
    display: flex;
    align-items: center;
  }

  .select {
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--input-text);
    border-radius: var(--input-radius);
    padding: var(--input-padding);
    outline: none;
    appearance: none;
    width: 100%;
    cursor: pointer;
  }

  .select:focus {
    border-color: var(--color-accent-border);
  }

  .select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chevron {
    position: absolute;
    right: var(--space-3);
    color: var(--color-text-ghost);
    pointer-events: none;
    font-size: var(--font-size-base);
  }
</style>
