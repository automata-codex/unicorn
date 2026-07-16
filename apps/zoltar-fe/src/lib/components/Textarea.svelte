<div class="textarea-wrapper">
  {#if label}
    <label class="textarea-label" for={id}>{label}</label>
  {/if}
  <textarea
    class="textarea"
    value={value}
    placeholder={placeholder}
    disabled={disabled}
    id={id}
    rows={rows}
    oninput={oninput}
    onchange={onchange}
  ></textarea>
  {#if hint}
    <span class="textarea-hint">{hint}</span>
  {/if}
</div>

<script lang="ts">
  let {
    value = undefined,
    placeholder = undefined,
    label = undefined,
    hint = undefined,
    disabled = false,
    id = undefined,
    rows = 3,
    oninput = undefined,
    onchange = undefined,
  }: {
    value?: string;
    placeholder?: string;
    label?: string;
    hint?: string;
    disabled?: boolean;
    id?: string;
    rows?: number;
    oninput?: (e: Event) => void;
    onchange?: (e: Event) => void;
  } = $props();
</script>

<style>
  .textarea-wrapper {
    display: flex;
    flex-direction: column;
  }

  .textarea-label {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    margin-bottom: var(--space-2);
  }

  .textarea {
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
    resize: vertical;
  }

  .textarea::placeholder {
    color: var(--input-placeholder);
  }

  .textarea:focus {
    border-color: var(--color-accent-border);
  }

  .textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .textarea-hint {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-text-ghost);
    margin-top: var(--space-1);
  }
</style>
