<div class="input-wrapper">
  {#if label}
    <label class="input-label" for={id}>{label}</label>
  {/if}
  <input
    class="input"
    type={type}
    value={value}
    placeholder={placeholder}
    disabled={disabled}
    id={id}
    oninput={oninput}
    onchange={onchange}
  />
  {#if hint}
    <span class="input-hint">{hint}</span>
  {/if}
</div>

<script lang="ts">
  let {
    type = 'text',
    value = undefined,
    placeholder = undefined,
    label = undefined,
    hint = undefined,
    disabled = false,
    id = undefined,
    oninput = undefined,
    onchange = undefined,
  }: {
    type?: 'text' | 'number' | 'password';
    value?: string | number;
    placeholder?: string;
    label?: string;
    hint?: string;
    disabled?: boolean;
    id?: string;
    oninput?: (e: Event) => void;
    onchange?: (e: Event) => void;
  } = $props();
</script>

<style>
  .input-wrapper {
    display: flex;
    flex-direction: column;
  }

  .input-label {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    margin-bottom: var(--space-2);
  }

  .input {
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--input-text);
    border-radius: var(--input-radius);
    padding: var(--input-padding);
    outline: none;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .input::placeholder {
    color: var(--input-placeholder);
  }

  .input:focus {
    border-color: var(--color-accent-border);
  }

  .input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input-hint {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-text-ghost);
    margin-top: var(--space-1);
  }
</style>
